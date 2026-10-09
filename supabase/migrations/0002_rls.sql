-- 0002_rls.sql — Row Level Security and least-privilege grants.
--
-- Model:
-- - Users read the projects they are members of (project_members), and every
--   project-scoped row of those projects, sync runs included.
-- - `people` is ORGANIZATION-level, so it has no project column: a user reads
--   the people who share at least one project with them, through their team
--   memberships (D-056).
-- - LLM usage (llm_calls) is readable only by admins: users whose JWT carries
--   app_metadata.role = 'admin' (app_metadata is writable only server-side).
-- - All writes go through the service role (sync, forecasts, AI layer), which
--   bypasses RLS. The only user writes: owners and leads change an alert's
--   status (column privilege + policy + transition trigger) and create
--   reports as themselves (column privileges + policy).
-- - anon has no privileges at all; authenticated has SELECT plus the two
--   column-level grants above.

-- ---------------------------------------------------------------------------
-- Helpers (security definer: they read project_members and the JWT without
-- recursing into RLS; empty search_path, fully qualified names)
-- ---------------------------------------------------------------------------

create or replace function public.is_project_member(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = pid
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_project_role(pid uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members m
    where m.project_id = pid
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

-- `people` has no project column, so membership is resolved through the
-- person's team memberships. Security definer: it reads team_members, teams,
-- and project_members without recursing into their policies.
create or replace function public.shares_project_with_person(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.project_members pm on pm.project_id = t.project_id
    where tm.person_id = person
      and pm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- ---------------------------------------------------------------------------
-- Alert status transitions (users): open -> ack | resolved, ack -> open |
-- resolved; resolved is terminal. Service jobs (any other role) are exempt.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_alert_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and old.status is distinct from new.status then
    if not (
      (old.status = 'open' and new.status in ('ack', 'resolved'))
      or (old.status = 'ack' and new.status in ('open', 'resolved'))
    ) then
      raise exception 'alert status cannot change from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger alerts_enforce_status_transition
  before update of status on public.alerts
  for each row execute function public.enforce_alert_status_transition();

-- ---------------------------------------------------------------------------
-- Least-privilege grants
-- ---------------------------------------------------------------------------

-- anon: nothing. authenticated: SELECT only (RLS filters the rows; the column
-- grants below re-add the two user writes). `revoke all` also covers
-- TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN (Postgres 17+) without naming
-- version-specific privileges. Defaults cover tables created later.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public grant select on tables to authenticated;

revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function public.is_project_member(uuid) to authenticated, service_role;
grant execute on function public.has_project_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.shares_project_with_person(uuid) to authenticated, service_role;

-- User writes, column by column: ids and timestamps cannot be spoofed.
grant update (status) on public.alerts to authenticated;
grant insert (project_id, kind, period_start, period_end, content, markdown, created_by)
  on public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.teams enable row level security;
alter table public.people enable row level security;
alter table public.team_members enable row level security;
alter table public.statuses enable row level security;
alter table public.sprints enable row level security;
alter table public.issues enable row level security;
alter table public.issue_snapshots enable row level security;
alter table public.issue_events enable row level security;
alter table public.issue_comments enable row level security;
alter table public.worklogs enable row level security;
alter table public.pull_requests enable row level security;
alter table public.commits enable row level security;
alter table public.capacity enable row level security;
alter table public.docs enable row level security;
alter table public.forecasts enable row level security;
alter table public.alerts enable row level security;
alter table public.memory_items enable row level security;
alter table public.reports enable row level security;
alter table public.sync_runs enable row level security;
alter table public.llm_calls enable row level security;

-- ---------------------------------------------------------------------------
-- Read policies. Plain membership checks use an uncorrelated subquery that
-- Postgres evaluates once per statement, instead of a function call per row.
-- ---------------------------------------------------------------------------

create policy "Members read their projects" on public.projects
  for select to authenticated
  using (id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

-- Uses the helper: a subquery on project_members here would recurse.
create policy "Members read their project memberships" on public.project_members
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_project_member(project_id));

create policy "Members read teams" on public.teams
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read statuses" on public.statuses
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read team memberships of their projects" on public.team_members
  for select to authenticated
  using (team_id in (
    select t.id
    from public.teams t
    join public.project_members pm on pm.project_id = t.project_id
    where pm.user_id = (select auth.uid())
  ));

-- Org-level table: the helper, not a project column, decides visibility.
create policy "Members read people they share a project with" on public.people
  for select to authenticated
  using (public.shares_project_with_person(id));

create policy "Members read sprints" on public.sprints
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read issues" on public.issues
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read issue snapshots" on public.issue_snapshots
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read issue events" on public.issue_events
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read issue comments" on public.issue_comments
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read worklogs" on public.worklogs
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read pull requests" on public.pull_requests
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read commits" on public.commits
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read capacity" on public.capacity
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read docs" on public.docs
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read forecasts" on public.forecasts
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read alerts" on public.alerts
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read memory items" on public.memory_items
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read reports" on public.reports
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Members read their projects' sync runs" on public.sync_runs
  for select to authenticated
  using (project_id in (
    select pm.project_id from public.project_members pm
    where pm.user_id = (select auth.uid())
  ));

create policy "Admins read LLM usage" on public.llm_calls
  for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Write policies (owners and leads; viewers are read-only)
-- ---------------------------------------------------------------------------

create policy "Owners and leads update alert status" on public.alerts
  for update to authenticated
  using (public.has_project_role(project_id, array['owner', 'lead']))
  with check (public.has_project_role(project_id, array['owner', 'lead']));

create policy "Owners and leads create reports as themselves" on public.reports
  for insert to authenticated
  with check (
    public.has_project_role(project_id, array['owner', 'lead'])
    and created_by = (select auth.uid())
  );
