import {
  AlertSchema,
  CapacityEntrySchema,
  CommitSchema,
  DocRefSchema,
  EMBEDDING_DIMENSIONS,
  IssueCommentSchema,
  IssueEventSchema,
  IssueSchema,
  MemoryItemSchema,
  PersonSchema,
  ProjectSchema,
  PullRequestSchema,
  SYNC_SOURCES,
  SprintSchema,
  StatusSchema,
  TeamMemberSchema,
  TeamSchema,
  WorklogSchema,
  type Alert,
  type AlertKind,
  type AlertSubject,
  type Issue,
  type LlmUsageTotals,
  type Project,
  type Sprint,
  type Status,
  type SyncRun,
  type Team,
  type TeamMember,
} from "@/shared/domain";
import {
  AlertConflictError,
  MAX_MEMORY_SEARCH_RESULTS,
  RepositoryConstraintError,
  type MemorySearchHit,
  type RadarRepository,
} from "@/shared/ports";

import type { SupabaseServiceClient } from "./client";
import { unwrap } from "./errors";
import {
  fromAlertRow,
  fromCapacityRow,
  fromCommitRow,
  fromDocRow,
  fromForecastRow,
  fromIssueCommentRow,
  fromIssueEventRow,
  fromIssueRow,
  fromLlmCallRow,
  fromMemoryItemRow,
  fromPersonRow,
  fromProjectRow,
  fromPullRequestRow,
  fromReportRow,
  fromSprintRow,
  fromStatusRow,
  fromSyncRunRow,
  fromTeamMemberRow,
  fromTeamRow,
  fromWorklogRow,
  requireIssueId,
  toCapacityRow,
  toCommitRow,
  toDocRow,
  toForecastRow,
  toIssueCommentRow,
  toIssueEventRow,
  toIssueRow,
  toLlmCallRow,
  toMemoryItemRow,
  toPersonRow,
  toProjectRow,
  toPullRequestRow,
  toReportRow,
  toSprintRow,
  toStatusRow,
  toTeamMemberRow,
  toTeamRow,
  toVectorLiteral,
  toWorklogRow,
  type Row,
} from "./mappers";

/**
 * Supabase implementation of `RadarRepository` (live mode).
 *
 * It backs the SAME contract as the in-memory adapter (see the port and
 * decision D-032):
 * - every write is validated with the domain schemas before it leaves the
 *   process, and rejected batches never reach the database;
 * - `upsertMany` targets the natural key the migrations declare, and each
 *   batch is deduplicated by that key (last occurrence wins) — Postgres
 *   otherwise fails the whole statement with "ON CONFLICT DO UPDATE command
 *   cannot affect row a second time";
 * - large batches are chunked so one request stays within PostgREST limits;
 * - reads page through PostgREST's row cap and are ordered explicitly;
 * - integrity violations surface as `RepositoryConstraintError`.
 *
 * Runs with the service role, so RLS is bypassed: this repository must only
 * be constructed server-side (see `client.ts` and `docs/decisions.md`, D-030).
 */

/** PostgREST caps a response at 1000 rows by default; read in pages of that size. */
const PAGE_SIZE = 1000;
/** Rows per write request. Keeps the body well under the gateway's limit. */
const CHUNK_SIZE = 500;

type PageResult = { data: unknown[] | null; error: unknown };
type QueryPage = (from: number, to: number) => PromiseLike<PageResult>;

async function selectAll(table: string, page: QueryPage): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const batch = unwrap(table, "select", await page(offset, offset + PAGE_SIZE - 1));
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

/** Keeps the LAST occurrence of each natural key, like `syncProjects` does. */
function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(keyOf(item), item);
  return [...byKey.values()];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function byString<T>(select: (item: T) => string) {
  return (a: T, b: T) => {
    const left = select(a);
    const right = select(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

function thenBy<T>(...comparators: Array<(a: T, b: T) => number>) {
  return (a: T, b: T) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

function issueNumber(key: string): number {
  return Number(key.slice(key.lastIndexOf("-") + 1));
}

/** Postgres cannot order `BCN-9` before `BCN-10`; the domain ordering can. */
const BY_ISSUE_KEY = thenBy<Issue>(
  byString((issue) => issue.projectId),
  (a, b) => issueNumber(a.key) - issueNumber(b.key),
  byString((issue) => issue.key),
);

function assertEmbedding(embedding: readonly number[]): void {
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    !embedding.every((value) => Number.isFinite(value))
  ) {
    throw new Error(
      `Embeddings must have ${EMBEDDING_DIMENSIONS} finite dimensions (got ${embedding.length}).`,
    );
  }
}

function norm(vector: readonly number[]): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

/** Alert fields the caller controls, validated exactly like the stored alert. */
const AlertDraftSchema = AlertSchema.omit({
  id: true,
  projectId: true,
  kind: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  lastDetectedAt: true,
});

export class SupabaseRadarRepository implements RadarRepository {
  readonly projects: RadarRepository["projects"];
  readonly sprints: RadarRepository["sprints"];
  readonly issues: RadarRepository["issues"];
  readonly issueEvents: RadarRepository["issueEvents"];
  readonly issueComments: RadarRepository["issueComments"];
  readonly worklogs: RadarRepository["worklogs"];
  readonly pullRequests: RadarRepository["pullRequests"];
  readonly commits: RadarRepository["commits"];
  readonly capacity: RadarRepository["capacity"];
  readonly docs: RadarRepository["docs"];
  readonly teams: RadarRepository["teams"];
  readonly people: RadarRepository["people"];
  readonly teamMembers: RadarRepository["teamMembers"];
  readonly statuses: RadarRepository["statuses"];
  readonly forecasts: RadarRepository["forecasts"];
  readonly alerts: RadarRepository["alerts"];
  readonly memory: RadarRepository["memory"];
  readonly reports: RadarRepository["reports"];
  readonly syncRuns: RadarRepository["syncRuns"];
  readonly llmCalls: RadarRepository["llmCalls"];

  constructor(client: SupabaseServiceClient) {
    const table = (name: string) => client.from(name);

    /** Writes a deduplicated, validated batch in chunks. */
    const upsertChunks = async (
      name: string,
      rows: readonly Row[],
      onConflict: string,
    ): Promise<void> => {
      for (const part of chunk(rows, CHUNK_SIZE)) {
        const { error } = await table(name).upsert(part, {
          onConflict,
          ignoreDuplicates: false,
        });
        if (error) unwrap(name, "upsert", { data: null, error });
      }
    };

    /** `(projectId, issueKey) -> issues.id` for every issue of those projects. */
    const issueIdsByKey = async (
      projectIds: readonly string[],
    ): Promise<Map<string, string>> => {
      const map = new Map<string, string>();
      if (projectIds.length === 0) return map;
      const rows = await selectAll("issues", (from, to) =>
        table("issues")
          .select("id, project_id, key")
          .in("project_id", [...projectIds])
          .order("key")
          .range(from, to),
      );
      for (const row of rows as Array<{
        id: string;
        project_id: string;
        key: string;
      }>) {
        map.set(`${row.project_id}:${row.key}`, row.id);
      }
      return map;
    };

    /** `issues.id -> key` for one project, to rebuild child rows on read. */
    const issueKeysById = async (projectId: string): Promise<Map<string, string>> => {
      const map = new Map<string, string>();
      const rows = await selectAll("issues", (from, to) =>
        table("issues")
          .select("id, key")
          .eq("project_id", projectId)
          .order("key")
          .range(from, to),
      );
      for (const row of rows as Array<{ id: string; key: string }>) {
        map.set(row.id, row.key);
      }
      return map;
    };

    // --- Projects ---------------------------------------------------------

    this.projects = {
      list: async () => {
        const rows = await selectAll("projects", (from, to) =>
          table("projects").select("*").order("name").order("id").range(from, to),
        );
        return rows.map(fromProjectRow);
      },
      get: async (id) => {
        const { data, error } = await table("projects")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) unwrap("projects", "select", { data: null, error });
        return data === null ? null : fromProjectRow(data);
      },
      upsert: async (project) => {
        const parsed: Project = ProjectSchema.parse(project);
        const result = await table("projects")
          .upsert(toProjectRow(parsed), { onConflict: "id" })
          .select()
          .single();
        return fromProjectRow(unwrap("projects", "upsert", result));
      },
    };

    // --- Sprints ----------------------------------------------------------

    const sprintsOfProject = async (projectId: string) => {
      const rows = await selectAll("sprints", (from, to) =>
        table("sprints")
          .select("*")
          .eq("project_id", projectId)
          .order("start_at")
          .order("id")
          .range(from, to),
      );
      return rows.map(fromSprintRow);
    };

    this.sprints = {
      byProject: sprintsOfProject,
      active: async (projectId, at) => {
        const time = at.getTime();
        const all = await sprintsOfProject(projectId);
        const contains = (sprint: Sprint) =>
          Date.parse(sprint.startAt) <= time && time <= Date.parse(sprint.endAt);
        return (
          all.find((sprint) => sprint.state === "active" && contains(sprint)) ??
          all.find((sprint) => sprint.state === "active") ??
          all.find(contains) ??
          null
        );
      },
      upsertMany: async (sprints) => {
        if (sprints.length === 0) return;
        const parsed: Sprint[] = sprints.map((sprint) => SprintSchema.parse(sprint));
        const batch = dedupeBy(parsed, (s) => `${s.projectId}:${s.externalId}`);

        const ids = new Set<string>();
        for (const sprint of batch) {
          if (ids.has(sprint.id)) {
            throw new RepositoryConstraintError(
              "sprints_pkey",
              `sprints: the batch uses id ${sprint.id} for more than one sprint.`,
            );
          }
          ids.add(sprint.id);
        }

        // `id` is assigned once and never overwritten by a sync (port contract),
        // so a known natural key carrying a different id is a rejection, not an
        // update — and an id already used by another sprint is one too.
        const projectIds = [...new Set(batch.map((sprint) => sprint.projectId))];
        const existing = (await selectAll("sprints", (from, to) =>
          table("sprints")
            .select("id, project_id, external_id")
            .in("project_id", projectIds)
            .order("id")
            .range(from, to),
        )) as Array<{ id: string; project_id: string; external_id: string }>;

        const idByNaturalKey = new Map<string, string>();
        const naturalKeyById = new Map<string, string>();
        for (const row of existing) {
          const key = `${row.project_id}:${row.external_id}`;
          idByNaturalKey.set(key, row.id);
          naturalKeyById.set(row.id, key);
        }

        for (const sprint of batch) {
          const key = `${sprint.projectId}:${sprint.externalId}`;
          const storedId = idByNaturalKey.get(key);
          if (storedId !== undefined && storedId !== sprint.id) {
            throw new RepositoryConstraintError(
              "sprints_project_external_key",
              `sprints: sprint ${sprint.externalId} already exists with id ${storedId}; ids are never overwritten.`,
            );
          }
          const storedKey = naturalKeyById.get(sprint.id);
          if (storedKey !== undefined && storedKey !== key) {
            throw new RepositoryConstraintError(
              "sprints_pkey",
              `sprints: id ${sprint.id} already belongs to another sprint.`,
            );
          }
        }

        await upsertChunks(
          "sprints",
          batch.map(toSprintRow),
          "project_id,external_id",
        );
      },
    };

    // --- Issues -----------------------------------------------------------

    this.issues = {
      byProject: async (projectId) => {
        const rows = await selectAll("issues", (from, to) =>
          table("issues")
            .select("*")
            .eq("project_id", projectId)
            .order("key")
            .range(from, to),
        );
        return rows.map(fromIssueRow).sort(BY_ISSUE_KEY);
      },
      bySprint: async (sprintId) => {
        const rows = await selectAll("issues", (from, to) =>
          table("issues")
            .select("*")
            .eq("sprint_id", sprintId)
            .order("key")
            .range(from, to),
        );
        return rows.map(fromIssueRow).sort(BY_ISSUE_KEY);
      },
      upsertMany: async (issues) => {
        if (issues.length === 0) return;
        const parsed = issues.map((issue) => IssueSchema.parse(issue));
        const batch = dedupeBy(parsed, (issue) => `${issue.projectId}:${issue.key}`);
        // `id` is omitted: `on conflict do update` must keep the stored uuid,
        // which issue_events, comments, and worklogs reference.
        await upsertChunks("issues", batch.map(toIssueRow), "project_id,key");
      },
    };

    // --- Issue children ---------------------------------------------------

    this.issueEvents = {
      byProject: async (projectId) => {
        const keys = await issueKeysById(projectId);
        const rows = await selectAll("issue_events", (from, to) =>
          table("issue_events")
            .select("*")
            .eq("project_id", projectId)
            .order("at")
            .order("external_id")
            .range(from, to),
        );
        return rows.map((row) => fromIssueEventRow(row, keys));
      },
      upsertMany: async (events) => {
        if (events.length === 0) return;
        const parsed = events.map((event) => IssueEventSchema.parse(event));
        const batch = dedupeBy(parsed, (e) => `${e.projectId}:${e.externalId}`);
        const issueIds = await issueIdsByKey([
          ...new Set(batch.map((event) => event.projectId)),
        ]);
        const rows = batch.map((event) =>
          toIssueEventRow(
            event,
            requireIssueId("issue_events", issueIds, event.projectId, event.issueKey),
          ),
        );
        await upsertChunks("issue_events", rows, "project_id,external_id");
      },
    };

    this.issueComments = {
      byProject: async (projectId) => {
        const keys = await issueKeysById(projectId);
        const rows = await selectAll("issue_comments", (from, to) =>
          table("issue_comments")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at")
            .order("external_id")
            .range(from, to),
        );
        return rows.map((row) => fromIssueCommentRow(row, keys));
      },
      upsertMany: async (comments) => {
        if (comments.length === 0) return;
        const parsed = comments.map((c) => IssueCommentSchema.parse(c));
        const batch = dedupeBy(parsed, (c) => `${c.projectId}:${c.id}`);
        const issueIds = await issueIdsByKey([
          ...new Set(batch.map((comment) => comment.projectId)),
        ]);
        const rows = batch.map((comment) =>
          toIssueCommentRow(
            comment,
            requireIssueId(
              "issue_comments",
              issueIds,
              comment.projectId,
              comment.issueKey,
            ),
          ),
        );
        await upsertChunks("issue_comments", rows, "project_id,external_id");
      },
    };

    this.worklogs = {
      byProject: async (projectId) => {
        const keys = await issueKeysById(projectId);
        const rows = await selectAll("worklogs", (from, to) =>
          table("worklogs")
            .select("*")
            .eq("project_id", projectId)
            .order("started_at")
            .order("external_id")
            .range(from, to),
        );
        return rows.map((row) => fromWorklogRow(row, keys));
      },
      upsertMany: async (worklogs) => {
        if (worklogs.length === 0) return;
        const parsed = worklogs.map((w) => WorklogSchema.parse(w));
        const batch = dedupeBy(parsed, (w) => `${w.projectId}:${w.id}`);
        const issueIds = await issueIdsByKey([
          ...new Set(batch.map((worklog) => worklog.projectId)),
        ]);
        const rows = batch.map((worklog) =>
          toWorklogRow(
            worklog,
            requireIssueId("worklogs", issueIds, worklog.projectId, worklog.issueKey),
          ),
        );
        await upsertChunks("worklogs", rows, "project_id,external_id");
      },
    };

    // --- Code host --------------------------------------------------------

    this.pullRequests = {
      byProject: async (projectId) => {
        const rows = await selectAll("pull_requests", (from, to) =>
          table("pull_requests")
            .select("*")
            .eq("project_id", projectId)
            .order("number")
            .range(from, to),
        );
        return rows.map(fromPullRequestRow);
      },
      upsertMany: async (pullRequests) => {
        if (pullRequests.length === 0) return;
        const parsed = pullRequests.map((pr) => PullRequestSchema.parse(pr));
        const batch = dedupeBy(parsed, (pr) => `${pr.projectId}:${pr.number}`);
        await upsertChunks(
          "pull_requests",
          batch.map(toPullRequestRow),
          "project_id,number",
        );
      },
    };

    this.commits = {
      byProject: async (projectId) => {
        const rows = await selectAll("commits", (from, to) =>
          table("commits")
            .select("*")
            .eq("project_id", projectId)
            .order("committed_at")
            .order("sha")
            .range(from, to),
        );
        return rows.map(fromCommitRow);
      },
      upsertMany: async (commits) => {
        if (commits.length === 0) return;
        const parsed = commits.map((commit) => CommitSchema.parse(commit));
        const batch = dedupeBy(parsed, (commit) => `${commit.projectId}:${commit.sha}`);
        await upsertChunks("commits", batch.map(toCommitRow), "project_id,sha");
      },
    };

    // --- Calendar and docs ------------------------------------------------

    this.capacity = {
      byProject: async (projectId, range) => {
        const rows = await selectAll("capacity", (from, to) => {
          let query = table("capacity").select("*").eq("project_id", projectId);
          if (range) query = query.gte("date", range.start).lte("date", range.end);
          return query.order("date").order("person").range(from, to);
        });
        return rows.map(fromCapacityRow);
      },
      upsertMany: async (entries) => {
        if (entries.length === 0) return;
        const parsed = entries.map((entry) => CapacityEntrySchema.parse(entry));
        const batch = dedupeBy(
          parsed,
          (entry) => `${entry.projectId}:${entry.person}:${entry.date}`,
        );
        await upsertChunks(
          "capacity",
          batch.map(toCapacityRow),
          "project_id,person,date",
        );
      },
    };

    this.docs = {
      byProject: async (projectId) => {
        const rows = await selectAll("docs", (from, to) =>
          table("docs")
            .select("*")
            .eq("project_id", projectId)
            .order("slug")
            .range(from, to),
        );
        return rows.map(fromDocRow);
      },
      upsertMany: async (docs) => {
        if (docs.length === 0) return;
        const parsed = docs.map((doc) => DocRefSchema.parse(doc));
        const batch = dedupeBy(parsed, (doc) => `${doc.projectId}:${doc.slug}`);
        await upsertChunks("docs", batch.map(toDocRow), "project_id,slug");
      },
    };

    // --- Teams, people, membership, daily statuses ------------------------

    /**
     * Rejects a batch whose natural key is already stored under a different
     * `id`, and a batch that reuses one `id` for two natural keys. Mirrors the
     * in-memory adapter and keeps `on conflict do update` from moving an id
     * other rows already reference (same rule as sprints).
     */
    const assertStableIds = <T>(
      constraint: { table: string; naturalKey: string; primaryKey: string },
      batch: readonly T[],
      idOf: (item: T) => string,
      keyOf: (item: T) => string,
      stored: ReadonlyArray<{ id: string; key: string }>,
    ): void => {
      const seen = new Set<string>();
      for (const item of batch) {
        const id = idOf(item);
        if (seen.has(id)) {
          throw new RepositoryConstraintError(
            constraint.primaryKey,
            `${constraint.table}: the batch uses id ${id} for more than one row.`,
          );
        }
        seen.add(id);
      }
      const idByKey = new Map(stored.map((row) => [row.key, row.id]));
      const keyById = new Map(stored.map((row) => [row.id, row.key]));
      for (const item of batch) {
        const key = keyOf(item);
        const storedId = idByKey.get(key);
        if (storedId !== undefined && storedId !== idOf(item)) {
          throw new RepositoryConstraintError(
            constraint.naturalKey,
            `${constraint.table}: that row already exists with id ${storedId}; ids are never overwritten.`,
          );
        }
        const storedKey = keyById.get(idOf(item));
        if (storedKey !== undefined && storedKey !== key) {
          throw new RepositoryConstraintError(
            constraint.primaryKey,
            `${constraint.table}: id ${idOf(item)} already belongs to another row.`,
          );
        }
      }
    };

    const dayRange = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(
      query: Q,
      range: { start: string; end: string } | undefined,
    ): Q =>
      range === undefined
        ? query
        : query.gte("reported_on", range.start).lte("reported_on", range.end);

    this.teams = {
      byProject: async (projectId, filter = {}) => {
        const rows = await selectAll("teams", (from, to) => {
          let query = table("teams").select("*").eq("project_id", projectId);
          if (filter.active !== undefined) query = query.eq("active", filter.active);
          return query.order("name").order("id").range(from, to);
        });
        return rows.map(fromTeamRow);
      },
      get: async (id) => {
        const { data, error } = await table("teams")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) unwrap("teams", "select", { data: null, error });
        return data === null ? null : fromTeamRow(data);
      },
      upsert: async (team) => {
        const parsed: Team = TeamSchema.parse(team);
        const result = await table("teams")
          .upsert(toTeamRow(parsed), { onConflict: "id" })
          .select()
          .single();
        return fromTeamRow(unwrap("teams", "upsert", result));
      },
      setActive: async (id, active) => {
        const { data, error } = await table("teams")
          .update({ active })
          .eq("id", id)
          .select();
        const rows = unwrap("teams", "update", { data, error });
        return rows.length === 0 ? null : fromTeamRow(rows[0]);
      },
    };

    this.people = {
      list: async (filter = {}) => {
        const rows = await selectAll("people", (from, to) => {
          let query = table("people").select("*");
          if (filter.active !== undefined) query = query.eq("active", filter.active);
          return query.order("full_name").order("id").range(from, to);
        });
        return rows.map(fromPersonRow);
      },
      get: async (id) => {
        const { data, error } = await table("people")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) unwrap("people", "select", { data: null, error });
        return data === null ? null : fromPersonRow(data);
      },
      upsertMany: async (items) => {
        if (items.length === 0) return;
        const parsed = items.map((person) => PersonSchema.parse(person));
        const batch = dedupeBy(parsed, (person) => person.id);
        await upsertChunks("people", batch.map(toPersonRow), "id");
      },
      search: async (name) => {
        const needle = name.trim();
        if (needle === "") return [];
        // `ilike` is case-insensitive; Postgres also folds the accents the
        // in-memory adapter strips only when the column's collation does, so
        // the match is re-applied in the domain below.
        const escaped = needle.replace(/[\\%_]/g, (char) => `\\${char}`);
        const rows = await selectAll("people", (from, to) =>
          table("people")
            .select("*")
            .ilike("full_name", `%${escaped}%`)
            .order("full_name")
            .order("id")
            .range(from, to),
        );
        return rows.map(fromPersonRow);
      },
    };

    this.teamMembers = {
      byTeam: async (teamId) => {
        const rows = await selectAll("team_members", (from, to) =>
          table("team_members")
            .select("*")
            .eq("team_id", teamId)
            .order("started_on")
            .order("person_id")
            .range(from, to),
        );
        return rows.map(fromTeamMemberRow);
      },
      byPerson: async (personId) => {
        const rows = await selectAll("team_members", (from, to) =>
          table("team_members")
            .select("*")
            .eq("person_id", personId)
            .order("started_on")
            .order("team_id")
            .range(from, to),
        );
        return rows.map(fromTeamMemberRow);
      },
      upsertMany: async (members) => {
        if (members.length === 0) return;
        const parsed: TeamMember[] = members.map((member) =>
          TeamMemberSchema.parse(member),
        );
        const keyOf = (member: TeamMember) =>
          `${member.teamId}:${member.personId}:${member.startedOn}`;
        const batch = dedupeBy(parsed, keyOf);
        const teamIds = [...new Set(batch.map((member) => member.teamId))];
        const stored = (await selectAll("team_members", (from, to) =>
          table("team_members")
            .select("id, team_id, person_id, started_on")
            .in("team_id", teamIds)
            .order("id")
            .range(from, to),
        )) as Array<{
          id: string;
          team_id: string;
          person_id: string;
          started_on: string;
        }>;
        assertStableIds(
          {
            table: "team_members",
            naturalKey: "team_members_team_person_start_key",
            primaryKey: "team_members_pkey",
          },
          batch,
          (member) => member.id,
          keyOf,
          stored.map((row) => ({
            id: row.id,
            key: `${row.team_id}:${row.person_id}:${row.started_on}`,
          })),
        );
        await upsertChunks(
          "team_members",
          batch.map(toTeamMemberRow),
          "team_id,person_id,started_on",
        );
      },
      remove: async (id) => {
        const { data, error } = await table("team_members")
          .delete()
          .eq("id", id)
          .select("id");
        const rows = unwrap("team_members", "delete", { data, error });
        return rows.length > 0;
      },
    };

    const statusKey = (status: Status) => `${status.personId}:${status.reportedOn}`;

    /** Validates, dedupes, and checks id stability for a status batch. */
    const statusBatch = async (items: readonly Status[]): Promise<Status[]> => {
      const parsed: Status[] = items.map((status) => StatusSchema.parse(status));
      const batch = dedupeBy(parsed, statusKey);
      const personIds = [...new Set(batch.map((status) => status.personId))];
      const stored: Array<{ id: string; person_id: string; reported_on: string }> = [];
      for (const ids of chunk(personIds, CHUNK_SIZE)) {
        const rows = (await selectAll("statuses", (from, to) =>
          table("statuses")
            .select("id, person_id, reported_on")
            .in("person_id", ids)
            .order("id")
            .range(from, to),
        )) as Array<{ id: string; person_id: string; reported_on: string }>;
        stored.push(...rows);
      }
      assertStableIds(
        {
          table: "statuses",
          naturalKey: "statuses_person_day_key",
          primaryKey: "statuses_pkey",
        },
        batch,
        (status) => status.id,
        statusKey,
        stored.map((row) => ({
          id: row.id,
          key: `${row.person_id}:${row.reported_on}`,
        })),
      );
      return batch;
    };

    this.statuses = {
      byTeam: async (teamId, range) => {
        const rows = await selectAll("statuses", (from, to) =>
          dayRange(table("statuses").select("*").eq("team_id", teamId), range)
            .order("reported_on")
            .order("person_id")
            .range(from, to),
        );
        return rows.map(fromStatusRow);
      },
      byPerson: async (personId, range) => {
        const rows = await selectAll("statuses", (from, to) =>
          dayRange(table("statuses").select("*").eq("person_id", personId), range)
            .order("reported_on")
            .order("id")
            .range(from, to),
        );
        return rows.map(fromStatusRow);
      },
      byProject: async (projectId, range) => {
        const rows = await selectAll("statuses", (from, to) =>
          dayRange(table("statuses").select("*").eq("project_id", projectId), range)
            .order("reported_on")
            .order("person_id")
            .range(from, to),
        );
        return rows.map(fromStatusRow);
      },
      upsert: async (status) => {
        const [parsed] = await statusBatch([status]);
        const result = await table("statuses")
          .upsert(toStatusRow(parsed), { onConflict: "person_id,reported_on" })
          .select()
          .single();
        return fromStatusRow(unwrap("statuses", "upsert", result));
      },
      upsertMany: async (items) => {
        if (items.length === 0) return;
        const batch = await statusBatch(items);
        await upsertChunks(
          "statuses",
          batch.map(toStatusRow),
          "person_id,reported_on",
        );
      },
      delete: async (id) => {
        const { data, error } = await table("statuses")
          .delete()
          .eq("id", id)
          .select("id");
        const rows = unwrap("statuses", "delete", { data, error });
        return rows.length > 0;
      },
    };

    // --- Forecasts --------------------------------------------------------

    this.forecasts = {
      latest: async (projectId, kind) => {
        const { data, error } = await table("forecasts")
          .select("*")
          .eq("project_id", projectId)
          .eq("kind", kind)
          .order("computed_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1);
        const rows = unwrap("forecasts", "select", { data, error });
        return rows.length === 0 ? null : fromForecastRow(rows[0]);
      },
      insert: async (input) => {
        const result = await table("forecasts")
          .insert(toForecastRow(input))
          .select()
          .single();
        return fromForecastRow(unwrap("forecasts", "insert", result));
      },
    };

    // --- Alerts -----------------------------------------------------------

    /**
     * The active alert holding the slot of (project, kind, team, person) —
     * the subject is part of the key, like the generated `active_key` column.
     */
    const activeAlert = async (
      projectId: string,
      kind: AlertKind,
      subject: AlertSubject,
    ): Promise<Alert | null> => {
      let query = table("alerts")
        .select("*")
        .eq("project_id", projectId)
        .eq("kind", kind)
        .in("status", ["open", "ack"]);
      query =
        subject.teamId === null
          ? query.is("team_id", null)
          : query.eq("team_id", subject.teamId);
      query =
        subject.personId === null
          ? query.is("person_id", null)
          : query.eq("person_id", subject.personId);
      const { data, error } = await query.limit(1);
      const rows = unwrap("alerts", "select", { data, error });
      return rows.length === 0 ? null : fromAlertRow(rows[0]);
    };

    this.alerts = {
      byProject: async (projectId, status) => {
        const rows = await selectAll("alerts", (from, to) => {
          let query = table("alerts").select("*").eq("project_id", projectId);
          if (status !== undefined) query = query.eq("status", status);
          return query.order("created_at").order("id").range(from, to);
        });
        return rows.map(fromAlertRow);
      },
      upsertForKind: async (projectId, kind, draft) => {
        const { detectedAt, ...fields } = draft;
        // Rejects drafts without evidence here, exactly like the in-memory
        // adapter, instead of relying on the table's check constraint.
        const validated = AlertDraftSchema.parse(fields);

        // `id`, `status`, and `created_at` are deliberately absent: on insert
        // Postgres defaults them (`open`, now()); on conflict with the active
        // alert of this kind they are simply not part of the update, so an
        // acknowledged alert stays acknowledged and keeps its first detection.
        const row: Row = {
          project_id: projectId,
          kind,
          // Part of the generated `active_key`, so they decide WHICH active
          // alert of this kind the upsert targets.
          team_id: validated.teamId,
          person_id: validated.personId,
          severity: validated.severity,
          confidence: validated.confidence,
          eta: validated.eta,
          title: validated.title,
          explanation: validated.explanation,
          explanation_source: validated.explanationSource,
          drivers: validated.drivers,
          evidence: validated.evidence,
          suggested_actions: validated.suggestedActions,
          updated_at: detectedAt,
          last_detected_at: detectedAt,
        };

        const result = await table("alerts")
          .upsert(row, { onConflict: "active_key" })
          .select()
          .single();
        return fromAlertRow(unwrap("alerts", "upsert", result));
      },
      setStatus: async (id, status) => {
        const current = await table("alerts").select("*").eq("id", id).maybeSingle();
        if (current.error) unwrap("alerts", "select", { data: null, error: current.error });
        if (current.data === null) return null;
        const alert = fromAlertRow(current.data);

        const { data, error } = await table("alerts")
          .update({ status })
          .eq("id", id)
          .select();

        if (error) {
          // The unique index on `active_key` is what stops a second active
          // alert of the same kind AND subject; name the one holding the slot.
          const blocking = await activeAlert(alert.projectId, alert.kind, alert);
          if (blocking && blocking.id !== id) {
            throw new AlertConflictError(alert.projectId, alert.kind, blocking.id);
          }
          unwrap("alerts", "update", { data: null, error });
        }

        const rows = data ?? [];
        return rows.length === 0 ? null : fromAlertRow(rows[0]);
      },
    };

    // --- Memory -----------------------------------------------------------

    const MEMORY_COLUMNS = "id, project_id, kind, summary, evidence, occurred_at, status";

    this.memory = {
      byProject: async (projectId, filter = {}) => {
        const rows = await selectAll("memory_items", (from, to) => {
          let query = table("memory_items")
            .select(MEMORY_COLUMNS)
            .eq("project_id", projectId);
          if (filter.kind !== undefined) query = query.eq("kind", filter.kind);
          if (filter.status !== undefined) query = query.eq("status", filter.status);
          return query.order("occurred_at").order("id").range(from, to);
        });
        return rows.map(fromMemoryItemRow);
      },
      upsertMany: async (items) => {
        if (items.length === 0) return;
        const parsed = items.map(({ embedding, ...item }) => {
          if (embedding) assertEmbedding(embedding);
          return { item: MemoryItemSchema.parse(item), embedding };
        });
        const batch = dedupeBy(parsed, (entry) => entry.item.id);

        // An omitted embedding keeps the stored vector only while the summary
        // is unchanged; a new summary without a new vector clears it, because
        // the old vector would match the old text. PostgREST fills columns a
        // row omits with NULL, so the kept vector must be sent back verbatim.
        const needsStored = batch.filter((entry) => entry.embedding === undefined);
        const stored = new Map<string, { summary: string; embedding: unknown }>();
        if (needsStored.length > 0) {
          for (const ids of chunk(
            needsStored.map((entry) => entry.item.id),
            CHUNK_SIZE,
          )) {
            const rows = (await selectAll("memory_items", (from, to) =>
              table("memory_items")
                .select("id, summary, embedding")
                .in("id", ids)
                .order("id")
                .range(from, to),
            )) as Array<{ id: string; summary: string; embedding: unknown }>;
            for (const row of rows) {
              stored.set(row.id, { summary: row.summary, embedding: row.embedding });
            }
          }
        }

        const rows = batch.map(({ item, embedding }) => {
          const previous = stored.get(item.id);
          const kept =
            previous && previous.summary === item.summary
              ? (previous.embedding ?? null)
              : null;
          return {
            ...toMemoryItemRow(item),
            embedding: embedding ? toVectorLiteral(embedding) : kept,
          };
        });
        await upsertChunks("memory_items", rows, "id");
      },
      search: async (projectId, queryEmbedding, k) => {
        assertEmbedding(queryEmbedding);
        const limit = Math.min(Math.floor(k), MAX_MEMORY_SEARCH_RESULTS);
        // Mirrors the in-memory rules and `match_memory_items`: no results for
        // k <= 0, and a zero query vector has no direction, so it never matches.
        if (limit <= 0 || norm(queryEmbedding) === 0) return [];

        const { data, error } = await client.rpc("match_memory_items", {
          p_project_id: projectId,
          query_embedding: toVectorLiteral(queryEmbedding),
          match_count: limit,
        });
        const rows = unwrap("memory_items", "search", { data, error }) as unknown[];

        return rows
          .map((row): MemorySearchHit => {
            const record = row as Record<string, unknown>;
            return {
              item: fromMemoryItemRow(record),
              similarity: Number(record.similarity),
            };
          })
          .sort(
            thenBy<MemorySearchHit>(
              (a, b) => b.similarity - a.similarity,
              byString((hit) => hit.item.id),
            ),
          )
          .slice(0, limit);
      },
    };

    // --- Reports ----------------------------------------------------------

    this.reports = {
      byProject: async (projectId) => {
        const rows = await selectAll("reports", (from, to) =>
          table("reports")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        );
        return rows.map(fromReportRow);
      },
      get: async (id) => {
        const { data, error } = await table("reports")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) unwrap("reports", "select", { data: null, error });
        return data === null ? null : fromReportRow(data);
      },
      insert: async (input) => {
        const result = await table("reports")
          .insert(toReportRow(input))
          .select()
          .single();
        return fromReportRow(unwrap("reports", "insert", result));
      },
    };

    // --- Operations -------------------------------------------------------

    this.syncRuns = {
      start: async ({ projectId, source, startedAt }) => {
        const result = await table("sync_runs")
          .insert({
            project_id: projectId,
            source,
            started_at: startedAt,
            finished_at: null,
            status: "running",
            stats: {},
            error: null,
          })
          .select()
          .single();
        return fromSyncRunRow(unwrap("sync_runs", "insert", result));
      },
      finish: async (id, outcome) => {
        const { data, error } = await table("sync_runs")
          .update({
            finished_at: outcome.finishedAt,
            status: outcome.status,
            stats: outcome.stats,
            error: outcome.error,
          })
          .eq("id", id)
          .select();
        const rows = unwrap("sync_runs", "update", { data, error });
        if (rows.length === 0) throw new Error(`Unknown sync run ${id}.`);
        return fromSyncRunRow(rows[0]);
      },
      latestBySource: async (projectId) => {
        const rows = await selectAll("sync_runs", (from, to) =>
          table("sync_runs")
            .select("*")
            .eq("project_id", projectId)
            .order("started_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to),
        );
        const latest = new Map<string, SyncRun>();
        for (const row of rows) {
          const run = fromSyncRunRow(row);
          if (!latest.has(run.source)) latest.set(run.source, run);
        }
        return SYNC_SOURCES.flatMap((source) => {
          const run = latest.get(source);
          return run ? [run] : [];
        });
      },
    };

    this.llmCalls = {
      insert: async (input) => {
        const result = await table("llm_calls")
          .insert(toLlmCallRow(input))
          .select()
          .single();
        return fromLlmCallRow(unwrap("llm_calls", "insert", result));
      },
      totals: async (): Promise<LlmUsageTotals> => {
        const rows = await selectAll("llm_calls", (from, to) =>
          table("llm_calls")
            .select("input_tokens, output_tokens, cache_read_tokens, cost_usd")
            .order("created_at")
            .range(from, to),
        );
        const totals = (
          rows as Array<{
            input_tokens: number;
            output_tokens: number;
            cache_read_tokens: number;
            cost_usd: number | string;
          }>
        ).reduce(
          (sum, row) => ({
            calls: sum.calls + 1,
            inputTokens: sum.inputTokens + Number(row.input_tokens),
            outputTokens: sum.outputTokens + Number(row.output_tokens),
            cacheReadTokens: sum.cacheReadTokens + Number(row.cache_read_tokens),
            costUsd: sum.costUsd + Number(row.cost_usd),
          }),
          { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
        );
        return { ...totals, costUsd: Math.round(totals.costUsd * 1e6) / 1e6 };
      },
    };
  }
}
