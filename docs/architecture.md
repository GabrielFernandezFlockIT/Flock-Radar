# Architecture

Flock-Radar is one Next.js app on Vercel, organized as a hexagon: pure domain modules in the middle, ports around them, and adapters (Jira, GitHub, Calendar, Flocktools, Anthropic, Supabase, demo fakes) on the outside. Deterministic math produces every number; the LLM only explains numbers it is given.

## Quick path

| If you want to... | Read |
|-------------------|------|
| See who uses Flock-Radar and what it talks to | [System context](#system-context) |
| Find where code runs | [Containers](#containers) |
| Follow a nightly sync end to end | [Sync, forecast, and alert](#sync-forecast-and-alert) |
| See how forecasts and alerts are computed | [Forecast engine](#forecast-engine) |
| Follow a chat question end to end | [Ask Flock-Radar](#ask-flock-radar) |
| See the tables and how they relate | [Data model](#data-model) |
| Know where new code goes | [Folder structure](#folder-structure) and [Layering rules](#layering-rules) |

## System context

```mermaid
C4Context
  title Flock-Radar — System Context
  Person(lead, "Engineering leader", "EM / tech lead / delivery manager")
  Person(client, "Client stakeholder", "Receives client reports")
  System(radar, "Flock-Radar", "Forecasts deviations, remembers evidence-backed work, unifies reports and Q&A")
  System_Ext(jira, "Jira Cloud", "Issues, sprints, changelog, worklogs")
  System_Ext(github, "GitHub", "PRs, reviews, commits")
  System_Ext(gcal, "Google Calendar", "PTO and meetings → capacity")
  System_Ext(flock, "Flocktools", "Docs and tech reads")
  System_Ext(claude, "Anthropic API", "claude-opus-5-5: explain, extract, report, chat")
  System_Ext(voyage, "Voyage AI", "Embeddings (optional)")
  SystemDb_Ext(supa, "Supabase", "Postgres + pgvector, Auth, RLS")
  Rel(lead, radar, "Reviews alerts, asks, generates reports", "HTTPS")
  Rel(radar, client, "Client report", "PDF / Markdown")
  Rel(radar, jira, "Reads", "REST")
  Rel(radar, github, "Reads", "REST")
  Rel(radar, gcal, "Reads", "REST")
  Rel(radar, flock, "Reads", "REST")
  Rel(radar, claude, "Explains computed numbers", "Messages API")
  Rel(radar, voyage, "Embeds memory items", "REST")
  Rel(radar, supa, "Persists, authenticates", "SQL / Auth")
```

## Containers

```mermaid
C4Container
  title Flock-Radar — Containers
  Person(lead, "Engineering leader")
  System_Ext(cron, "Vercel Cron", "Daily, within the 07:00 UTC hour")

  System_Boundary(vercel, "Next.js app on Vercel") {
    Container(ui, "UI routes", "React Server Components, shadcn/ui, Recharts", "Portfolio, project pages, Ask Flock-Radar, Admin")
    Container(api, "API routes", "Route Handlers", "/api/health, /api/chat, report generation, Sync now")
    Container(cronRoute, "Cron route", "Route Handler", "/api/cron/sync, Bearer CRON_SECRET")
    Container(root, "Composition root", "TypeScript", "Chooses demo or live adapters from DEMO_MODE")
    Container(domain, "Domain modules", "Pure TypeScript", "Forecast, Memory, Cockpit use cases behind ports")
    Container(adapters, "Adapters", "TypeScript", "Jira, GitHub, Calendar, Flocktools, LLM, Supabase, demo fakes")
  }

  SystemDb_Ext(supa, "Supabase", "Postgres + pgvector, Auth, RLS")
  System_Ext(sources, "Jira / GitHub / Calendar / Flocktools", "Source systems")
  System_Ext(claude, "Anthropic API", "claude-opus-5-5")
  System_Ext(voyage, "Voyage AI", "Embeddings")

  Rel(lead, ui, "Uses", "HTTPS")
  Rel(cron, cronRoute, "Triggers", "HTTPS GET")
  Rel(ui, root, "Resolves use cases")
  Rel(api, root, "Resolves use cases")
  Rel(cronRoute, root, "Resolves sync use case")
  Rel(root, domain, "Injects ports into")
  Rel(root, adapters, "Instantiates")
  Rel(adapters, supa, "SQL / Auth")
  Rel(adapters, sources, "REST")
  Rel(adapters, claude, "Messages API")
  Rel(adapters, voyage, "REST")
```

In demo mode the adapters box resolves to in-memory fakes, so no arrow leaves the app. On first access each UTC day the composition root builds the scenario for that day and runs it through the same sync use case the cron uses, into an in-memory repository ([D-019](./decisions.md#d-019--demo-boots-through-the-real-sync-pipeline), [D-033](./decisions.md#d-033--the-demo-container-is-rebuilt-per-utc-day)). In live mode (phase 9), user requests read through a request-scoped repository so RLS applies; the service-role repository serves only cron, sync, and admin jobs ([D-030](./decisions.md#d-030--live-reads-use-a-request-scoped-rls-repository)).

## Sync, forecast, and alert

The nightly path. Every number is computed before the LLM is involved, and the LLM output is checked against those numbers.

```mermaid
sequenceDiagram
  autonumber
  participant Cron as Vercel Cron
  participant Route as /api/cron/sync
  participant Src as Source adapters (Jira, GitHub, Calendar, Flocktools)
  participant Repo as Repositories
  participant Engine as Forecast engine (pure)
  participant Det as Detectors (pure)
  participant LLM as LLM adapter (Anthropic)
  participant Guard as Number-grounding check

  Cron->>Route: GET with Authorization: Bearer CRON_SECRET
  Route->>Route: Constant-time secret check (401 on mismatch)
  Route->>Src: Fetch issues, changelog, worklogs, PRs, commits, calendar
  Src-->>Route: Normalized domain records
  Route->>Repo: Upsert records and record sync_runs
  Route->>Engine: Run Monte Carlo, budget burn, scope creep
  Engine-->>Route: Forecast results (seeded, deterministic)
  Route->>Det: Evaluate forecasts and flow signals
  Det-->>Route: Triggered alerts with drivers and evidence
  Route->>Repo: Persist alerts
  loop Each triggered alert
    Route->>LLM: Explain drivers (structured output)
    LLM-->>Route: Headline, why, suggested actions
    Route->>Guard: Every number in text must appear in inputs
    alt Grounded
      Guard-->>Route: Accept
    else Ungrounded
      Route->>LLM: Regenerate once
      LLM-->>Route: Second attempt
      Route->>Guard: Check again
      Guard-->>Route: Accept, or use template fallback
    end
    Route->>Repo: Store explanation on the alert
  end
  Route-->>Cron: 202 with sync stats
```

## Forecast engine

`src/modules/forecast` turns synced data into forecasts and alerts. The math is pure and seeded; the use case only does IO through ports.

| Piece | Where | What it does |
|-------|-------|--------------|
| `evaluateProject` | `domain/engine.ts` | Runs every detector on a `ProjectSnapshot` (all records plus an injected `now`) |
| Sprint completion | `domain/sprint-completion.ts`, `monte-carlo.ts`, `throughput.ts`, `sprint-scope.ts` | Bootstrap Monte Carlo (10,000 runs, seed `projectId:day`) with capacity scaling; P, expected/P50/P85 dates, burn-up with cone ([D-037](./decisions.md#d-037--sprint-forecast-bootstraps-daily-throughput), [D-038](./decisions.md#d-038--capacity-scales-by-the-elapsed-day-baseline)) |
| Budget runway | `domain/budget.ts` | EWMA daily burn, exhaustion date, % over at the end date, spend series ([D-039](./decisions.md#d-039--budget-burn-is-an-ewma-with-alpha-03)) |
| Scope creep | `domain/scope-creep.ts` | Net scope added since the sprint start vs. commitment ([D-040](./decisions.md#d-040--scope-creep-is-net-growth-over-15-percent)) |
| Flow signals | `domain/flow.ts` | WIP over limit, stale reviews, stalled issues, reopen rate ([D-041](./decisions.md#d-041--flow-signal-thresholds-and-severity-mapping)) |
| `runForecasts` | `application/run-forecasts.ts` | Loads snapshots, stores `sprint_completion` / `budget_runway` forecasts, upserts triggered alerts, and auto-resolves cleared ones ([D-042](./decisions.md#d-042--alerts-auto-resolve-when-a-conclusive-detector-stops-firing)) |

Every detector returns a `DetectorResult`: drivers carry the exact numbers the LLM may cite, and evidence points at the issues, PRs, commits, worklog tabs, and sprint reports behind them. The demo calibration (`src/adapters/demo/forecast-pipeline.test.ts`) asserts the scripted story on every weekday anchor.

## Ask Flock-Radar

A question becomes read-only tool calls over the same repositories the cockpit uses, and the answer streams back with citations.

```mermaid
sequenceDiagram
  autonumber
  actor Lead as Engineering leader
  participant UI as Ask Flock-Radar UI
  participant Chat as /api/chat
  participant Runner as Tool Runner (Anthropic SDK)
  participant Tools as Read-only tools
  participant Repo as Repositories

  Lead->>UI: "Will we hit the sprint goal?"
  UI->>Chat: POST question and history
  Chat->>Runner: Cached system prompt and tool definitions
  loop Until the model stops calling tools
    Runner->>Tools: search_issues / get_forecast / search_memory / get_team_metrics / ...
    Tools->>Repo: Query
    Repo-->>Tools: Records with evidence (keys, PR numbers, SHAs, URLs)
    Tools-->>Runner: Tool results as delimited, untrusted data
  end
  Runner-->>Chat: Streamed answer referencing evidence ids
  Chat-->>UI: Stream text and citation metadata
  UI-->>Lead: Answer with clickable citation chips
```

## Data model

Postgres on Supabase (`supabase/migrations`). Every table synced from a source has a natural-key unique constraint (`issues (project_id, key)`, `pull_requests (project_id, number)`, `commits (project_id, sha)`, ...), so syncs are idempotent upserts. RLS is on for every table: members read their projects' rows, owners and leads make the two user writes, the service role does everything else, and anon gets nothing ([D-025](./decisions.md#d-025--sync-runs-are-per-project-with-sanitized-errors), [D-026](./decisions.md#d-026--llm-usage-is-admin-only), [D-028](./decisions.md#d-028--owners-and-leads-write-viewers-read)).

```mermaid
erDiagram
  projects ||--o{ project_members : "has"
  projects ||--o{ teams : "staffs"
  teams ||--o{ team_members : "roster"
  people ||--o{ team_members : "belongs to"
  teams ||--o{ statuses : "daily entries"
  people ||--o{ statuses : "about"
  projects ||--o{ statuses : "scoped to"
  teams |o--o{ alerts : "subject"
  people |o--o{ alerts : "subject"
  projects ||--o{ sprints : "plans"
  projects ||--o{ issues : "tracks"
  sprints |o--o{ issues : "contains"
  issues ||--o{ issue_events : "changelog"
  issues ||--o{ issue_comments : "discussion"
  issues ||--o{ worklogs : "time spent"
  issues ||--o{ issue_snapshots : "daily cache"
  projects ||--o{ pull_requests : "repo"
  projects ||--o{ commits : "repo"
  projects ||--o{ capacity : "per person per day"
  projects ||--o{ docs : "Flocktools"
  projects ||--o{ forecasts : "computed"
  projects ||--o{ alerts : "raised"
  projects ||--o{ memory_items : "remembered"
  projects ||--o{ reports : "generated"
  projects ||--o{ sync_runs : "freshness per source"

  projects {
    uuid id PK
    text jira_key UK
    text github_repo
    numeric budget_amount
    numeric hourly_rate
    date start_date
    date end_date
    text forecast_unit
    int wip_limit
  }
  sprints {
    uuid id PK
    uuid project_id FK
    text external_id
    timestamptz start_at
    timestamptz end_at
    text state
    numeric committed_points
  }
  issues {
    uuid id PK
    uuid project_id FK
    uuid sprint_id FK
    text key
    text status_category
    numeric points
    bool requires_code
  }
  issue_events {
    uuid issue_id FK
    text field
    text from_value
    text to_value
    timestamptz at
  }
  pull_requests {
    uuid project_id FK
    int number
    text state
    text_array linked_issue_keys
  }
  commits {
    uuid project_id FK
    text sha
    text_array linked_issue_keys
  }
  teams {
    uuid id PK
    uuid project_id FK
    text name UK
    bool active
  }
  people {
    uuid id PK
    text full_name
    text email UK
    bool active
  }
  team_members {
    uuid id PK
    uuid team_id FK
    uuid person_id FK
    text role
    date started_on
    date ended_on
  }
  statuses {
    uuid id PK
    uuid project_id FK
    uuid team_id FK
    uuid person_id FK
    date reported_on
    text summary
    text blockers
    text next_steps
    uuid author_person_id FK
    text source
  }
  alerts {
    uuid id PK
    uuid team_id FK
    uuid person_id FK
    text kind
    text severity
    numeric confidence
    date eta
    jsonb evidence
    text status
    text active_key UK
  }
  memory_items {
    uuid id PK
    text kind
    jsonb evidence
    vector embedding
  }
```

Not drawn: `llm_calls` (usage and cost, admin-only) has no project. `sync_runs` holds one row per project and source per sync, with a sanitized error reason. PRs and commits link to issues through `linked_issue_keys` (uppercase keys parsed from titles, branches, and messages), not foreign keys, because they can reference issues that were never synced.

Modeling choices worth knowing:

- **Rows stay inside their project.** Children reference parents with composite foreign keys (`(project_id, issue_id) -> issues (project_id, id)`), so RLS on `project_id` can never expose another project's record ([D-027](./decisions.md#d-027--composite-foreign-keys-keep-rows-inside-their-project)).
- **Evidence is JSON on the claim.** Alerts and memory items store `evidence jsonb` (at least one pointer, enforced by a check constraint), not a join table: evidence is immutable and always read with its claim.
- **Burn-up comes from events.** Scope and progress over time are rebuilt from `issues` + `issue_events`; `issue_snapshots` is only a live-mode cache ([D-018](./decisions.md#d-018--burn-up-is-derived-from-issues-and-events)).
- **One active alert per kind AND subject.** A generated `active_key` (`project_id:kind:team:person` while open or acknowledged, with `-` for a null subject) has a plain unique index that supabase-js can target with `onConflict`; resolved alerts drop out of it, so a re-detection opens a new alert ([D-029](./decisions.md#d-029--alerts-upsert-on-a-generated-active-key), [D-054](./decisions.md#d-054--the-active-alert-key-includes-the-subject)). `alerts.updated_at` is the DETECTION timestamp the repository supplies, not the write time ([D-055](./decisions.md#d-055--alertsupdated_at-belongs-to-the-writer)).
- **People are organization-level; the role is on the membership.** `people` has no project column, so one person can be a lead in one team and a developer in another; `team_members` carries the role, the start, and the end ([D-050](./decisions.md#d-050--people-are-organization-level), [D-051](./decisions.md#d-051--the-role-lives-on-the-membership)). RLS resolves `people` through the shared project ([D-056](./decisions.md#d-056--people-are-readable-through-a-shared-project)).
- **A daily status is a first-class record, not a memory item.** Memory items are derived and regenerated; a status is user-authored and is the source of truth the later passes read ([D-053](./decisions.md#d-053--a-status-is-a-first-class-entity)). Its `project_id` is denormalized so RLS filters it without a join, kept consistent by a composite foreign key to `teams (project_id, id)` ([D-052](./decisions.md#d-052--statuses-denormalize-project_id)). Evidence derived from a status carries an INTERNAL link ([D-057](./decisions.md#d-057--status-evidence-links-are-internal)).
- **Semantic search.** `memory_items.embedding extensions.vector(1024)` with an HNSW cosine index; `match_memory_items(project_id, embedding, k)` runs as the caller, so RLS still applies, and follows the same rules as the in-memory repository (k <= 0 returns nothing, at most 50 rows, zero vectors never match).

## Folder structure

Screaming structure: top-level folders name business capabilities, not technical layers. Every module, including each cockpit submodule, has the same three layers.

```
src/
  app/                       Next.js routes (thin: resolve use cases, render)
    api/health/              Liveness probe
    api/cron/sync/           Vercel Cron entry point
  composition-root.ts        The only place that picks demo or live adapters
  modules/
    ingestion/application/   syncProjects: sources -> repository, sync runs
    forecast/{domain,application,ui}/
    memory/{domain,application,ui}/
    cockpit/
      reports/{domain,application,ui}/
      metrics/{domain,application,ui}/
      chat/{domain,application,ui}/
  shared/
    domain/                  Evidence, Alert, Project, Sprint, Issue, Team, Person, Status, ... (Zod schemas + pure helpers)
    ports/                   Clock, RadarRepository, IssueTracker, CodeHost, CalendarSource, DocsSource
    config/                  Validated, server-only env
  adapters/
    demo/                    Scenario builder, demo sources, in-memory repository
      scenario/              spec + projects (structure), status-scripts (Spanish copy),
                             builder + team-statuses (records), expectations (signals)
    supabase/                Migration tests today; repository in phase 9
    unavailable/             Live-mode placeholders until phase 9
    shared/                  Helpers for adapters (stable UUIDs and SHAs)
    jira/ github/ calendar/ flocktools/ llm/
  components/                App shell and shadcn/ui primitives
  lib/                       Framework-level helpers (http auth, cn)
supabase/migrations/         SQL migrations (validated on PGlite in tests)
scripts/                     Operational scripts (seed)
test/                        Test helpers and stubs (not shipped)
```

## Layering rules

| Layer | Lives in | Must not import |
|-------|----------|-----------------|
| Domain | `src/modules/**/domain`, `src/shared/domain` | Adapters, composition root, `next`, `react`, `react-dom`, `@anthropic-ai/*`, `@supabase/*` |
| Application (use cases) | `src/modules/**/application` | Adapters, composition root, `next`, `@anthropic-ai/*`, `@supabase/*` |
| Ports | `src/shared/ports` | Adapters, composition root, `next`, `@anthropic-ai/*`, `@supabase/*` |
| Adapters | `src/adapters/**` | Routes (`src/app`), components, any `ui` layer, composition root |
| Composition root | `src/composition-root.ts` | No restrictions |
| Everything else | `src/app`, `src/modules/**/ui`, `src/components`, `src/lib`, `src/shared/config`, other `src/*` files | Adapters |

- **Only the composition root picks adapters.** `DEMO_MODE` decides demo or live wiring there and nowhere else.
- **The container carries no secrets.** It exposes the mode, model id, public app URL, and ports. API keys are consumed inside the composition root when adapters are built; the cron secret is read through `verifyCronSecret()`.
- **ESLint enforces the table.** `no-restricted-imports` blocks in `eslint.config.mjs` fail the lint step on a violation. "Adapters" covers `@/adapters`, `./adapters`, and `../adapters` paths; third-party paths that happen to contain `adapters` are allowed.
- **Time is a port.** Code that needs "now" takes a `Clock`, so the demo seed and forecasts are reproducible.

## Math computes, the LLM explains

- Forecasts (sprint completion probability, budget exhaustion date, scope creep) are pure functions with seeded randomness and unit tests.
- The LLM receives computed numbers and drivers and writes the headline, the why, and suggested actions. It never predicts.
- Any number in LLM text that is not in the inputs triggers one regeneration, then a deterministic template.
- Every claim carries `evidence[]`; claims without evidence are dropped server-side.

See [decisions.md](./decisions.md) for the reasoning behind these rules.
