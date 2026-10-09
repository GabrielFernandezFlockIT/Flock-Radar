# Decisions

Lightweight decision log (ADR-lite). Each entry states the decision, why it was made, and what we give up. When a decision changes, add a new entry that supersedes the old one instead of rewriting history.

## Index

| ID | Decision | Area |
|----|----------|------|
| [D-001](#d-001--demo-mode-runs-on-in-memory-repositories) | Demo mode runs on in-memory repositories seeded relative to today | Runtime |
| [D-002](#d-002--npm-is-the-package-manager) | npm is the package manager | Tooling |
| [D-003](#d-003--embeddings-sit-behind-an-embedder-port) | Embeddings sit behind an `Embedder` port | AI |
| [D-004](#d-004--the-llm-is-never-on-the-critical-path) | The LLM is never on the critical path | AI |
| [D-005](#d-005--cloud-provisioning-is-owner-driven) | Cloud provisioning is owner-driven; demo needs none | Ops |
| [D-006](#d-006--auth-is-enforced-only-in-live-mode) | Auth is enforced only in live mode | Security |
| [D-007](#d-007--forecast-throughput-unit-is-configurable) | Forecast throughput unit is configurable per project | Forecast |
| [D-008](#d-008--single-nextjs-app) | Single Next.js app, no monorepo | Architecture |
| [D-009](#d-009--monte-carlo-uses-a-seeded-prng) | Monte Carlo uses a seeded PRNG | Forecast |
| [D-010](#d-010--daily-cron-plus-manual-sync) | Daily cron plus manual "Sync now" | Ops |
| [D-011](#d-011--rest-for-ingestion-tool-runner-for-chat) | REST for ingestion, Tool Runner for chat, remote MCP optional | Integrations |
| [D-012](#d-012--shadcnui-on-radix-with-os-driven-dark-mode) | shadcn/ui on Radix, OS-driven dark mode | UI |
| [D-013](#d-013--keep-nextjs-16-cache-components-enabled) | Keep Next.js 16 Cache Components enabled | Framework |
| [D-014](#d-014--supabase-client-factories-land-with-the-repositories) | Supabase client factories land with the repositories (superseded by D-020) | Data |
| [D-015](#d-015--one-repository-port-with-namespaced-groups) | One `RadarRepository` port with namespaced groups | Data |
| [D-016](#d-016--sync-lives-in-an-ingestion-module) | Sync lives in an `ingestion` module | Architecture |
| [D-017](#d-017--migrations-are-validated-on-pglite) | Migrations are validated on PGlite in Vitest | Data |
| [D-018](#d-018--burn-up-is-derived-from-issues-and-events) | Burn-up is derived from issues and events; snapshots are a cache | Forecast |
| [D-019](#d-019--demo-boots-through-the-real-sync-pipeline) | Demo boots through the real sync pipeline; async container (caching superseded by D-033) | Runtime |
| [D-020](#d-020--supabase-repository-and-seed-script-move-to-phase-9) | Supabase repository and seed script move to phase 9 | Data |
| [D-021](#d-021--demo-numbers-are-calibrated-to-a-reference-model) | Demo numbers are calibrated to a reference model | Demo |
| [D-022](#d-022--one-active-alert-per-project-and-kind) | One active (open or ack) alert per project and kind (mechanism superseded by D-029) | Alerts |
| [D-023](#d-023--sprints-store-instants-not-days) | Sprints store instants, not days | Data |
| [D-024](#d-024--operational-tables-are-readable-by-role) | Operational tables are readable by role (superseded by D-025, D-026, D-028) | Security |
| [D-025](#d-025--sync-runs-are-per-project-with-sanitized-errors) | Sync runs are per project and source, with sanitized errors | Ops |
| [D-026](#d-026--llm-usage-is-admin-only) | LLM usage is admin-only (`app_metadata.role`) | Security |
| [D-027](#d-027--composite-foreign-keys-keep-rows-inside-their-project) | Composite foreign keys keep rows inside their project | Data |
| [D-028](#d-028--owners-and-leads-write-viewers-read) | Owners and leads write, viewers read; least-privilege grants | Security |
| [D-029](#d-029--alerts-upsert-on-a-generated-active-key) | Alerts upsert on a generated `active_key` | Alerts |
| [D-030](#d-030--live-mode-runs-on-the-service-role-and-is-therefore-unauthenticated) | Live mode runs on the service role and is therefore unauthenticated | Security |
| [D-031](#d-031--pgvector-lives-in-extensions-with-aligned-search-rules) | pgvector lives in `extensions`, search rules aligned | Data |
| [D-032](#d-032--repositories-are-strict-sync-is-forgiving) | Repositories are strict, sync is forgiving | Data |
| [D-033](#d-033--the-demo-container-is-rebuilt-per-utc-day) | The demo container is rebuilt per UTC day, cached on `globalThis` | Runtime |
| [D-034](#d-034--stalled-means-five-working-days-without-commits) | Stalled means 5 working days without commits | Forecast |
| [D-035](#d-035--refined-schemas-export-a-plain-fields-variant) | Refined schemas export a plain Fields variant (Zod 4) | Domain |
| [D-036](#d-036--sources-are-normalized-at-the-adapter-boundary) | Sources are normalized at the adapter boundary | Integrations |
| [D-037](#d-037--sprint-forecast-bootstraps-daily-throughput) | Sprint forecast bootstraps daily throughput; the engine is the reference model | Forecast |
| [D-038](#d-038--capacity-scales-by-the-elapsed-day-baseline) | Capacity scales by the elapsed-day baseline, not team x 8 h | Forecast |
| [D-039](#d-039--budget-burn-is-an-ewma-with-alpha-03) | Budget burn is an EWMA with alpha 0.3 | Forecast |
| [D-040](#d-040--scope-creep-is-net-growth-over-15-percent) | Scope creep is net growth over 15% of the commitment | Forecast |
| [D-041](#d-041--flow-signal-thresholds-and-severity-mapping) | Flow signal thresholds and the severity/confidence mapping | Forecast |
| [D-042](#d-042--alerts-auto-resolve-when-a-conclusive-detector-stops-firing) | Alerts auto-resolve when a conclusive detector stops firing | Alerts |
| [D-043](#d-043--memory-item-ids-are-derived-not-generated) | Memory item ids are derived, not generated | Memory |
| [D-044](#d-044--memory-rules-are-deterministic-and-the-llm-is-a-seam) | Memory rules are deterministic and the LLM is a seam | Memory |
| [D-045](#d-045--the-pending-rule-lives-in-the-summary-prefix) | The pending rule lives in the summary prefix | Memory |
| [D-046](#d-046--memory-search-stays-unimplemented-until-the-embedder-port) | `memory.search` stays unimplemented until the Embedder port | Memory |
| [D-050](#d-050--people-are-organization-level) | People are organization-level, not per project | Data |
| [D-051](#d-051--the-role-lives-on-the-membership) | The role lives on the membership, never on the person | Data |
| [D-052](#d-052--statuses-denormalize-project_id) | Statuses denormalize `project_id`, kept honest by a composite FK | Data |
| [D-053](#d-053--a-status-is-a-first-class-entity) | A daily status is a first-class entity, not a memory item | Data |
| [D-054](#d-054--the-active-alert-key-includes-the-subject) | The active-alert key includes the subject (team, person) | Alerts |
| [D-055](#d-055--alertsupdated_at-belongs-to-the-writer) | `alerts.updated_at` belongs to the writer, not to `now()` | Alerts |
| [D-056](#d-056--people-are-readable-through-a-shared-project) | People are readable through a shared project | Security |
| [D-057](#d-057--status-evidence-links-are-internal) | Status evidence links are internal app paths | Evidence |

---

### D-001 — Demo mode runs on in-memory repositories

- **Decision:** `DEMO_MODE=true` (the default) wires in-memory repositories and fake adapters, seeded deterministically relative to today through the `Clock` port. No Supabase project or auth is needed.
- **Why:** the live demo must never depend on a third-party API being up, and the scenario must look "current" on any day it is shown.
- **Tradeoff:** writes (acknowledging an alert, generated reports) live in the memory of one serverless instance and are ephemeral. Acceptable for a demo; live mode persists to Supabase.

### D-002 — npm is the package manager

- **Decision:** use npm and commit `package-lock.json`.
- **Why:** pnpm is not available in the build environment; npm ships with Node and is supported by Vercel out of the box.
- **Tradeoff:** slower installs and a larger `node_modules` than pnpm.

### D-003 — Embeddings sit behind an `Embedder` port

- **Decision:** Anthropic has no embeddings API, so memory search depends on an `Embedder` port. The Voyage AI adapter is used when `VOYAGE_API_KEY` is set; otherwise a deterministic feature-hashing embedder (1024 dimensions) runs locally. The pgvector column is `vector(1024)`.
- **Why:** keeps semantic search working offline and in demo mode with zero keys, while allowing a real model in live mode.
- **Tradeoff:** feature-hashing captures lexical overlap, not meaning; demo search quality is lower than with Voyage. Both embedders must keep 1024 dimensions.

### D-004 — The LLM is never on the critical path

- **Decision:** every LLM output has a deterministic template fallback, used when the API key is missing, the call fails, the model refuses, or the text contains numbers not present in the inputs (after one regeneration). Explanations are cached by a hash of their inputs.
- **Why:** "math computes, the LLM explains" — alerts and forecasts must be correct and available even when the AI layer is not.
- **Tradeoff:** fallback text is plainer than model output; the grounding check can reject legitimate paraphrases of numbers (e.g. "two weeks" vs "14 days").

### D-005 — Cloud provisioning is owner-driven

- **Decision:** Vercel and Supabase provisioning require the owner's accounts and is done by hand. The app runs fully in demo mode without either. Deploy steps live in the README.
- **Why:** no CLI access or credentials for those platforms in the build environment.
- **Tradeoff:** the first deploy and the live database setup are manual steps.

### D-006 — Auth is enforced only in live mode

- **Decision:** Supabase magic-link auth and RLS apply only when `DEMO_MODE=false`. Demo mode shows a "Demo data" badge and needs no login.
- **Why:** frictionless demo; seeded data contains nothing sensitive.
- **Tradeoff:** demo deployments are public by URL. Never point a demo deployment at real data.
- **Status:** auth is planned for phase 2 onward. Until it lands, live mode has no login at all, so it must not be deployed with real data.

### D-007 — Forecast throughput unit is configurable

- **Decision:** each project chooses its throughput unit (`points` or `issues`). When story points are missing, the engine falls back to issue count.
- **Why:** many teams do not estimate consistently; issue count is a robust default for Monte Carlo forecasting.
- **Tradeoff:** issue count assumes similar issue sizes; mixing units across projects makes portfolio comparisons approximate.

### D-008 — Single Next.js app

- **Decision:** one Next.js app (UI, API routes, cron) with hexagonal modules inside `src/`. No monorepo.
- **Why:** one-day MVP, one deploy target; module boundaries are enforced by ESLint instead of package boundaries.
- **Tradeoff:** boundaries are lint rules, not compiler-enforced packages; extracting a service later needs work.

### D-009 — Monte Carlo uses a seeded PRNG

- **Decision:** simulations use `mulberry32` seeded with `hash(projectId + date)`.
- **Why:** the UI stays stable across refreshes within a day and tests are deterministic.
- **Tradeoff:** results do not reflect sampling variance between refreshes; a bad seed is "stuck" for the whole day.

### D-010 — Daily cron plus manual sync

- **Decision:** Vercel Cron calls `/api/cron/sync` once a day, within the 07:00 UTC hour (`0 7 * * *`; Hobby plans only guarantee hourly precision). A manual "Sync now" button covers intraday refreshes.
- **Why:** the Vercel Hobby plan only allows daily cron jobs.
- **Tradeoff:** data can be up to a day stale unless someone syncs manually; the UI shows freshness per source.

### D-011 — REST for ingestion, Tool Runner for chat

- **Decision:** ingestion uses REST adapters. Ask Flock-Radar uses the Anthropic SDK Tool Runner with read-only tools over the same adapters and repositories. A remote (HTTP) MCP connector is optional behind `REMOTE_MCP_ENABLED`.
- **Why:** stdio MCP servers cannot run inside Vercel functions; REST adapters are deterministic, testable, and cacheable.
- **Tradeoff:** we maintain our own tool definitions instead of reusing an MCP server's.

### D-012 — shadcn/ui on Radix, OS-driven dark mode

- **Decision:** shadcn/ui is initialized with the Radix primitives base (`radix-nova` style, neutral palette, Lucide icons). Dark mode follows `prefers-color-scheme` through a CSS media variant; there is no theme toggle.
- **Why:** the shadcn CLI default is now Base UI. Radix keeps the widely documented `asChild` composition model. A media-query variant needs no client JavaScript and cannot flash the wrong theme.
- **Tradeoff:** adding a manual theme toggle later means switching the `dark` variant back to a class strategy (for example with `next-themes`).

### D-013 — Keep Next.js 16 Cache Components enabled

- **Decision:** keep `cacheComponents: true` and `partialPrefetching: true` from the Next.js 16.4 scaffold. Route handlers do not use the `dynamic` segment config (it is not supported with Cache Components). Handlers that must run per request read request data or call `await connection()` from `next/server`.
- **Why:** it is the framework default going forward; static shells prerender and dynamic data streams in.
- **Tradeoff:** server components that read time, randomness, or uncached data must sit behind `connection()`, request APIs, or `<Suspense>`, or the build fails. Env-derived UI (the mode badge) is resolved at build time, so changing `DEMO_MODE` needs a redeploy (already true on Vercel).

### D-014 — Supabase client factories land with the repositories

- **Decision:** `@supabase/supabase-js` and `@supabase/ssr` are installed in phase 1, but the server, browser, and service-role client factories are written in phase 2, inside `src/adapters/supabase`, together with the repositories and migrations that use them.
- **Why:** a client factory with no caller is untested code; building it with its first repository keeps the adapter, its schema, and its tests in one reviewable unit.
- **Tradeoff:** phase 1 cannot talk to Supabase at all, so live mode is configuration-only until phase 2.
- **Status:** superseded by [D-020](#d-020--supabase-repository-and-seed-script-move-to-phase-9).

### D-015 — One repository port with namespaced groups

- **Decision:** persistence is a single `RadarRepository` port (`src/shared/ports/radar-repository.ts`) with one group per aggregate (`projects`, `sprints`, `issues`, ..., `alerts`, `memory`, `syncRuns`, `llmCalls`). The in-memory adapter (demo, tests) and the Supabase adapter (phase 9) implement the same interface. Shared contract: `upsertMany` is idempotent on each entity's natural key, reads return copies, list order is deterministic, invalid writes are rejected. The repository assigns ids for append-only rows (forecasts, reports, sync runs, LLM calls).
- **Why:** the composition root swaps persistence as one unit, use cases receive one dependency, and both adapters can be checked against the same behavior.
- **Tradeoff:** one wide interface instead of small per-use-case ports; a use case can technically reach groups it does not need. Methods stay minimal and grow with the phases that need them.

### D-016 — Sync lives in an ingestion module

- **Decision:** the sync use case is `src/modules/ingestion/application/sync-projects.ts`, a new screaming module next to forecast, memory, and cockpit.
- **Why:** pulling sources into the spine is its own capability (it feeds all three modules), and living under `src/modules/**/application` puts it under the ESLint layering rule for use cases automatically. `src/shared/application` would have needed a new lint block; `cockpit` would have hidden it inside one consumer.
- **Tradeoff:** use-case tests may not import adapters, so the end-to-end sync tests (demo sources, in-memory repository, idempotency, outages) live in `src/adapters/demo/demo-pipeline.test.ts`.

### D-017 — Migrations are validated on PGlite

- **Decision:** `src/adapters/supabase/migrations.test.ts` applies `supabase/migrations/*.sql` in order to PGlite (Postgres 18 compiled to WASM, `@electric-sql/pglite`) with pgvector (`@electric-sql/pglite-pgvector`, a separate package since PGlite 0.5). A small stub recreates what Supabase provides: `auth.users`, `auth.uid()` reading the `request.jwt.claim.sub` setting, the `anon` / `authenticated` / `service_role` roles, and Supabase's default privileges on `public`. The test checks tables, RLS on every table, idempotent upserts, the one-active-alert index, member-only reads, alert status updates, report inserts, and `match_memory_items`, switching roles with `set role`.
- **Why:** no Docker or Supabase CLI in the build environment, yet migrations and RLS must be proven before live mode exists.
- **Tradeoff:** the stub is not Supabase. PGlite supported everything the migrations need (roles, `set role`, RLS, HNSW), so nothing was skipped, but Supabase-specific behavior (JWT parsing, PostgREST, `extensions` schema placement) is only exercised against a real project.

### D-018 — Burn-up is derived from issues and events

- **Decision:** sprint scope and burn-up history are reconstructed from current issue state plus `issue_events` (status, sprint, points, resolution changes). `issue_snapshots` exists in the schema only as a live-mode cache for long histories; demo mode never writes it.
- **Why:** the Jira changelog already records every change with a timestamp, so daily snapshots add no information, and the demo would otherwise need fabricated snapshots that could drift from its events.
- **Tradeoff:** reconstruction costs more per request than reading snapshots; the cache can be filled later without changing the model.

### D-019 — Demo boots through the real sync pipeline

- **Decision:** in demo mode the composition root builds the scenario for today (`buildDemoDataset(clock.now())`), stores its projects, and runs `syncProjects` over demo source adapters into an `InMemoryRadarRepository`. `getContainer()` is now async and memoized as a promise (a failed boot is not cached). `getAppConfig()` returns mode, model, and URL synchronously for code that only needs configuration, such as the header in the static shell.
- **Why:** the demo exercises the same ingestion code as live mode, so demo data can never diverge from what sync produces. Keeping the header on `getAppConfig()` avoids reading the clock during prerendering (Cache Components, D-013).
- **Tradeoff:** the first request on a cold instance pays for building and syncing the scenario (about 100 ms measured locally). The data stays anchored to the day the instance booted; a long-running server crossing midnight keeps yesterday's anchor until restart.
- **Status:** caching superseded by [D-033](#d-033--the-demo-container-is-rebuilt-per-utc-day); the boot-through-sync rule stands.

### D-020 — Supabase repository and seed script move to phase 9

- **Decision:** phase 2 delivers the schema, RLS, and their validation (D-017), but the Supabase client factories, the Supabase `RadarRepository`, and `scripts/seed-supabase.ts` land in phase 9 with the live adapters. Until then live mode wires placeholder ports (`src/adapters/unavailable`) whose every call rejects with a "lands in phase 9" error.
- **Why:** nothing reads from Supabase before the live adapters exist, and demo mode needs no database (D-001). Building the repository with its first real caller keeps it tested.
- **Tradeoff:** `DEMO_MODE=false` boots but serves no data until phase 9; `npm run seed:supabase` still exits with an error.
- **Status:** delivered. `src/adapters/supabase/` now holds the service-role client, the row mappers, and the full `RadarRepository`; `scripts/seed-supabase.ts` pushes the demo scenario into a live project. The REST source adapters (Jira, GitHub, Calendar, Flocktools) are still `src/adapters/unavailable`, so live mode reads what the database already holds and never syncs on boot.

### D-021 — Demo numbers are calibrated to a reference model

- **Decision:** the demo scenario (`src/adapters/demo/scenario`) is deterministic (seeded PRNG, name-based UUIDs and SHAs) and anchored to the UTC day: today is always working day 6 of a 10-working-day sprint. Its intended signals are exported as `DEMO_SCENARIO_EXPECTATIONS` and asserted by tests on every weekday. Beacon's numbers differ from the original brief: history is 35 to 39 points per sprint (not 26 to 30), 27 points were committed at start and 13 were added after it (40 in scope), so a straightforward Monte Carlo (documented in `expectations.ts`) lands at P ≈ 0.38. Cobalt's budget runs out about 14 days before its end date under an EWMA of hours per working day.
- **Why:** with a 26-30 velocity, any scope of 40 points has a near-zero completion probability under any sane model, so the brief's 38% target was unreachable. The new story is coherent: the team planned below its velocity for known PTO, then scope creep consumed the slack.
- **Tradeoff:** the 38% depends on the reference model; phase 3 may need to retune if its model differs materially (the expectations object records the knobs).

### D-022 — One active alert per project and kind

- **Decision:** at most one alert per (project, kind) may be active, where active means `open` or `ack`. Postgres enforces it with a partial unique index (`where status in ('open', 'ack')`), which is also the upsert target; the in-memory repository enforces the same rule.
- **Why:** an acknowledged alert is still a live problem. Allowing a new `open` alert next to an `ack` one would show the same risk twice and lose the acknowledgement.
- **Tradeoff:** a re-detected problem after an acknowledgement updates the acknowledged alert silently; the UI must surface "updated since you acknowledged" if that matters.
- **Status:** the rule stands; the partial index is replaced by a generated `active_key` ([D-029](#d-029--alerts-upsert-on-a-generated-active-key)).

### D-023 — Sprints store instants, not days

- **Decision:** sprints have `start_at` / `end_at` (`timestamptz`) instead of the `start_date` / `end_date` in the original data model.
- **Why:** scope creep is "added after the sprint started"; with day precision, items added during planning on day 1 would be miscounted.
- **Tradeoff:** charts that think in days must truncate to the UTC day.

### D-024 — Operational tables are readable by role

- **Decision:** project-scoped tables are readable by project members only. `sync_runs` (freshness per source, no project) is readable by anyone with a project membership, `llm_calls` (usage and cost) by owners and leads. Users write only alert `status` (column privilege plus policy) and reports as themselves; every other write goes through the service role, which bypasses RLS.
- **Why:** least privilege without an admin role in the MVP; ingestion and AI writes are server-side jobs.
- **Tradeoff:** an owner of one project sees LLM cost across all projects. A dedicated admin role can replace the rule later.
- **Status:** superseded by [D-025](#d-025--sync-runs-are-per-project-with-sanitized-errors) (sync runs), [D-026](#d-026--llm-usage-is-admin-only) (LLM usage), and [D-028](#d-028--owners-and-leads-write-viewers-read) (writes).

### D-025 — Sync runs are per project, with sanitized errors

- **Decision:** `sync_runs` has a required `project_id`; every sync records one run per project and source, readable only by that project's members. `error` holds a short sanitized reason built by `describeSyncFailure`: a `SourceUnavailableError`'s status and safe reason (`jira: HTTP 401 unauthorized`, URLs replaced by `[url]`), a repository constraint name, or just the error class (`docs: unexpected TypeError`). Raw upstream messages are never stored. A calendar run fails with an explicit reason when there is no roster because the issue tracker failed.
- **Why:** a global run per source leaked other projects' keys and upstream text (URLs, bodies) to every member, and freshness is a per-project question anyway.
- **Tradeoff:** four rows per project per sync, and less detail for debugging; full errors belong in server logs, not in the database.

### D-026 — LLM usage is admin-only

- **Decision:** `llm_calls` is readable only when `public.is_admin()` is true: the JWT's `app_metadata.role` equals `admin`. `app_metadata` is writable only with the service role (never `user_metadata`, which users can edit).
- **Why:** cost and usage are operational data, not project data; "owner of any project" was too broad.
- **Tradeoff:** an admin has to be flagged through the Supabase admin API or dashboard; there is no in-app admin management.

### D-027 — Composite foreign keys keep rows inside their project

- **Decision:** `issues` and `sprints` have `unique (project_id, id)`. Children reference the pair: issue events, comments, worklogs, and snapshots use `(project_id, issue_id) -> issues (project_id, id) on delete cascade`, and issues and snapshots use `(project_id, sprint_id) -> sprints (project_id, id) on delete set null (sprint_id)`.
- **Why:** RLS filters on each row's own `project_id`; a worklog of project A pointing at an issue of project B would be shown to A's members with B's data behind it. The schema now makes that state impossible.
- **Tradeoff:** an extra unique index per parent; `on delete set null (column)` needs Postgres 15+.

### D-028 — Owners and leads write, viewers read

- **Decision:** writes are role-aware through `public.has_project_role(project_id, roles)`. Only owners and leads may change an alert's `status` and insert reports (as themselves); viewers are read-only. Grants are least-privilege: anon has nothing; authenticated has `SELECT` plus `UPDATE (status)` on alerts and `INSERT (project_id, kind, period_start, period_end, content, markdown, created_by)` on reports, so ids and timestamps cannot be spoofed. Reports are capped (`markdown` 200 KB, `content` 1 MB). A `BEFORE UPDATE OF status` trigger allows users only open -> ack | resolved and ack -> open | resolved; resolved is terminal for users, while service jobs are exempt.
- **Why:** reviewers found any member (viewer included) could reopen resolved alerts, spoof report ids and dates, insert multi-megabyte reports, and that authenticated still had TRUNCATE.
- **Tradeoff:** every new user write needs an explicit column grant plus a policy; that friction is intended.

### D-029 — Alerts upsert on a generated active key

- **Decision:** `alerts.active_key` is a stored generated column (`project_id:kind` while `open` or `ack`, null once `resolved`) with a plain unique index, replacing the partial index. Alerts also carry `updated_at` and `last_detected_at` (set from the detection time on every upsert). Semantics: `ack` = seen and still active (re-detections update it, duplicates are blocked); `resolved` = handled, and if the detector fires again on the next sync a new `open` alert is created. `setStatus` throws `AlertConflictError` instead of creating a second active alert.
- **Why:** supabase-js `.upsert(row, { onConflict })` sends `ON CONFLICT (columns)` and cannot add the `WHERE` predicate a partial index needs, so the partial index could not be the upsert target in live mode.
- **Tradeoff:** one more column whose meaning lives in an expression; the partial-index version was easier to read.

### D-030 — Live mode runs on the service role and is therefore unauthenticated

- **Decision (current state):** live mode wires exactly ONE `SupabaseRadarRepository`, built from a **service-role** client, and uses it for every read and every write. There is no sign-in, no session, no `project_members` management, and no request-scoped cookie client.
- **Consequence, stated plainly:** the service role bypasses Row Level Security, so the policies in `0002_rls.sql` are **not the enforcement layer today** — they are dormant, waiting for authenticated callers. A live deployment is effectively **public**: anyone who can reach the deployment sees every project. It must not hold real client data until authentication lands.
- **Why we shipped it this way:** the data spine, the forecast engine, and the cockpit needed a real database behind them before auth was worth designing; wiring one repository kept that slice small and reviewable.
- **Tradeoff:** correctness of the security model is deferred, not achieved. The RLS migration stays in place precisely so that adding auth is a wiring change, not a schema change.
- **What "done" looks like:** magic-link sign-in, middleware, `project_members` rows, and a second, request-scoped `RadarRepository` built from the Supabase SSR cookie client for every user-facing read — with the service-role repository narrowed to cron, sync, and admin jobs. Until then, treat a live deployment as a demo on real infrastructure.

### D-031 — pgvector lives in extensions, with aligned search rules

- **Decision:** `create extension vector with schema extensions` (Supabase's convention); `match_memory_items` sets `search_path = public, extensions` so `<=>` and `vector_norm` resolve. Postgres and the in-memory repository share the rules: `k <= 0` returns nothing, at most 50 results (`MAX_MEMORY_SEARCH_RESULTS`), and zero vectors (stored or query) never match instead of producing NaN.
- **Why:** extension objects stay out of the exposed `public` API schema, and the two adapters must answer the same query the same way.
- **Tradeoff:** the PGlite harness has to create the `extensions` schema to mirror Supabase.

### D-032 — Repositories are strict, sync is forgiving

- **Decision:** both repositories reject what Postgres rejects: a natural key twice in one batch, rows whose project, issue, or sprint does not exist (or belongs to another project), a new id for a known sprint natural key, and duplicate Jira keys, all as `RepositoryConstraintError`. `syncProjects` dedupes every batch by natural key (last occurrence wins), drops children of issues the source did not return, clears links to unknown sprints, and records `duplicatesDropped`, `orphansDropped`, and `issuesWithUnknownSprint` in the run's stats.
- **Why:** the in-memory adapter silently accepted states Postgres would refuse, so demo and tests could pass while live mode failed. Real sources do return duplicates across pages and references to other boards' sprints; one bad record should not fail the whole project.
- **Tradeoff:** dropped records are only visible as counters on the run.

### D-033 — The demo container is rebuilt per UTC day

- **Decision:** the container promise is cached on `globalThis` (one instance per process, shared by RSC and route-handler module copies) under a key of mode, model, URL, and, in demo mode, the UTC day. A new day rebuilds the demo; a failed build is not cached. The demo repository uses deterministic ids (`ids: "deterministic"`), derived from stable inputs (alerts: project, kind, first detection day, occurrence), so instances booted on the same day agree on alert ids and deep links survive instance changes.
- **Why:** a long-running server must not show yesterday's "today", and separate module instances must not boot separate demos.
- **Tradeoff:** demo writes (acknowledged alerts, generated reports) reset at UTC midnight, on top of D-001's per-instance ephemerality. Sync-run ids still differ between instances because each boots at a different time.

### D-034 — Stalled means five working days without commits

- **Decision:** the detector contract for phase 3 is "In Progress with no linked commit in at least 5 working days" (weekends do not count). The demo's stalled issue (BCN-306) last committed 7 working days before today, i.e. 6 full idle working days on any weekday; `stalledMinWorkingDaysWithoutCommits` records the threshold.
- **Why:** with calendar days, Monday demos would flag work that simply paused over the weekend, and the scripted issue would drift in and out of the threshold by weekday.
- **Tradeoff:** holidays still count as working days until capacity feeds the detector.

### D-035 — Refined schemas export a plain Fields variant

- **Decision:** entities with cross-field rules export `ProjectFieldsSchema`, `SprintFieldsSchema`, `CalendarEventFieldsSchema`, `ReportFieldsSchema`, and `DateRangeFieldsSchema` (plain objects) next to the refined `*Schema`. Derive with `.omit`, `.pick`, or `.partial` from the Fields variant; validate with the refined one.
- **Why:** Zod 4 throws when `.omit()` or `.pick()` is called on an object schema that has refinements.
- **Tradeoff:** two names per entity; derived schemas must re-add the refinement when they need it.

### D-036 — Sources are normalized at the adapter boundary

- **Decision:** adapters emit timestamps as UTC ISO strings (`toISOString()`; Jira's `+0000` offsets included), all-day calendar events on UTC-midnight bounds, full 40-character commit SHAs (DB check constraint), and issue keys only in uppercase (`extractIssueKeys` ignores `bcn-123` and `api-2`). Failures are `SourceUnavailableError` with a safe reason. "New Feature" and "Feature" count as code-requiring issue types.
- **Why:** downstream code compares timestamps as strings, computes capacity per UTC day, and links PRs to issues by key; lowercase matching produced false links from ordinary words.
- **Tradeoff:** lowercase branch names (`bcn-123-fix`) no longer link a PR on their own; titles must carry the key.

### D-037 — Sprint forecast bootstraps daily throughput

- **Decision:** `P(complete by sprint end)` comes from 10,000 bootstrap runs. Each run walks the remaining working days, today included, and draws one daily throughput per day. Draws are uniform with replacement from every working day of the last 6 closed sprints, zero days included. A done issue counts on the working day it was resolved (weekend resolutions count on the previous working day), in the project's unit. Each draw is scaled by that day's capacity factor (D-038). Runs continue 30 working days past the sprint end, only to date the completion: P50/P85 are the days reached by 50%/85% of runs (`null` beyond the horizon), and the expected date is the mean completion day of the runs that finish. The seed is `projectId:asOf` (D-009). The burn-up cone shows the cumulative done reached by 50% and 85% of runs. The unit falls back to issue count when any active-sprint or sampled done issue has no estimate (D-007). Fewer than 2 closed sprints, or a history with no completed work, is inconclusive. This engine is the reference model `expectations.ts` describes: on the 7 weekday anchors Beacon lands at 0.373-0.382, Atlas at 0.755-0.763, and Cobalt at 0.68-0.70. It takes about 5 ms per project.
- **Why:** bootstrap sampling keeps the real shape of the team's days (zero days, big merges) without assuming a distribution. One function serves as both engine and calibration model, so the demo cannot drift from what the product computes (D-021).
- **Tradeoff:** days are drawn independently, so streaks are not modeled and the band can be slightly narrow. Issue count assumes similar sizes.

### D-038 — Capacity scales by the elapsed-day baseline

- **Decision:** capacity factor = team available hours that day / baseline, clamped at 0. The baseline is the mean team hours of the sprint's elapsed working days. When no elapsed day has capacity data, it falls back to team size x 8 h (driver `capacity_baseline_nominal`). Without any capacity data every factor is 1 (driver `capacity_unavailable`, confidence -0.1). Days without capacity entries count as normal.
- **Why:** historical throughput already reflects ordinary meetings (stand-ups, planning, retros), so the comparison should be against a normal day of this team, not a meeting-free 8 h day. Using team x 8 h as the primary baseline drops Beacon to about 0.32 (outside the ±0.03 calibration) and penalizes every project for its routine meetings.
- **Tradeoff:** a sprint whose elapsed days were unusually light (holidays early on) inflates the factors of later days.

### D-039 — Budget burn is an EWMA with alpha 0.3

- **Decision:** spend = worklog hours x hourly rate. The daily burn is an EWMA (alpha 0.3, seeded with the first value) of hours per working day, from the first day with logged time to yesterday (weekend logs count on the previous working day). The projection keeps that burn constant from today. Exhaustion is the working day the remaining budget is used up (ceil), or, when the budget is already spent, the historical day spend crossed it. The detector triggers when exhaustion is before `endDate`, and also whenever the budget is already spent, including when that happened after the end date (an overspent project is over budget whether or not it is still running); for an ended project, projected spend is the actual spend. Severity buckets by calendar days early: already exhausted or 10 or more days critical, 5 or more high, 2 or more medium, else low. Confidence = 0.9 x min(1, history days / 20) x (1 - CV of the last 15 days, floored at 0.5). No worklogs, budget, or rate is inconclusive. Cobalt runs out 14 days early on weekday anchors (12-13 on weekends).
- **Why:** with alpha 0.3, about 97% of the weight sits on the last 10 working days, so the projection follows a ramp-up (Cobalt's two late joiners) within two weeks while one odd day moves it little.
- **Tradeoff:** a burn that is still ramping is under-projected; seasonality and planned staffing changes are ignored.

### D-040 — Scope creep is net growth over 15 percent

- **Decision:** scope at any instant is rebuilt from the changelog (D-018). Committed = scope at the sprint's start instant. Added = issues pulled in plus raised estimates after the start; removed = issues moved out plus lowered estimates. The detector triggers when (added - removed) / committed > 15%. Severity: above 50% critical, above 30% high, else medium. Confidence is 0.9, or 0.7 when counting issues instead of points. Evidence is the sprint report plus one changelog entry per change. Beacon: +13 on 27 committed (48%, high).
- **Why:** net growth is what threatens the commitment; swapping equal work in and out is replanning, not creep.
- **Tradeoff:** a large addition offset by a large removal stays silent even though the team changed course.

### D-041 — Flow signal thresholds and severity mapping

- **Decision:** each signal describes today's state, so `eta` is today and confidence is 0.9.
  - **WIP:** active-sprint issues in the `in_progress` category above `wipLimit`. At least 2x the limit is critical, 1.5x high, otherwise medium.
  - **Stale review:** open PRs without a first review for more than 48 h (calendar hours). Three or more PRs, or one waiting 2x the threshold, is high; otherwise medium.
  - **Stalled:** code-requiring `in_progress` issues with at least 5 full working days since the last linked commit, or since work started when there is none (D-034). 2x the threshold is high, otherwise medium.
  - **Reopen rate:** resolutions cleared vs. set in the last 20 working days, above 15% with at least 5 resolutions (otherwise inconclusive). 2x the threshold is high, otherwise medium.
  - **Sprint risk:** P < 0.5 triggers; below 0.3 critical, otherwise high. Confidence = 0.9 x (sprints used / 6) x (1 - CV of sprint totals, floored at 0.5).

  Every threshold is a `ForecastOptions` field.
- **Why:** simple, explainable rules whose numbers go to the LLM as drivers unchanged.
- **Tradeoff:** fixed thresholds do not adapt to team size; a team with a WIP limit of 5 and 6 people is noisy until the limit is tuned.

### D-042 — Alerts auto-resolve when a conclusive detector stops firing

- **Decision:** `runForecasts` upserts the active alert of every triggered kind (titles from deterministic templates, `explanation` null until phase 4). It resolves the active (`open` or `ack`) alert of a kind whose detector ran conclusively and did not trigger. Two cases leave alerts untouched instead: insufficient data (driver `insufficient_data`), and a detector that triggered with no evidence to cite (driver `missing_evidence`, added by the engine). The second case cannot raise an alert either, because every alert needs evidence, but silence about a problem is not proof that it is gone, so it must not resolve one. Detectors therefore report what they measured and never fold "no records to cite" into `triggered`. A forecast identical to the latest one of the same UTC day is not inserted again, so reruns are idempotent. A project that fails is reported in the summary (sanitized error) and the others continue. Demo boot runs `syncProjects` then `runForecasts`, and fails if either fails.
- **Why:** alerts must not outlive the condition that raised them, but missing data is not evidence that a problem went away. Before this, a triggered detector whose evidence list came back empty fell through to the resolve branch and silently closed a live alert.
- **Tradeoff:** a flapping signal resolves and re-creates alerts (a new `open` alert each time, D-029); hysteresis can come later.

### D-043 — Memory item ids are derived, not generated

- **Decision:** a `MemoryItem.id` is a pure hash of `(projectId, kind, rule, primary record key)` (`memoryItemId`, `modules/memory/domain/ids.ts`), shaped like a version-5 UUID. No `node:crypto`, no randomness, no clock: the domain stays runtime-agnostic and the same fact always lands on the same row.
- **Why:** the repository keys memory items by `id`, so `buildMemory` is only idempotent if ids are. With generated ids, every rerun would duplicate the project's whole memory.
- **Tradeoff:** the hash is a seeded FNV-1a quadruple, not SHA-1, so it is not cryptographic. It only has to keep the few dozen records of one project apart; if a collision ever matters, swap the digest and accept a one-time id churn.

### D-044 — Memory rules are deterministic and the LLM is a seam

- **Decision:** phase 5 detects everything rule-based: five pending rules (Done without a merged PR, merged PR without a closed issue, PR stuck past the review/age threshold, in-progress issue without commits, unanswered Jira question), resolved work with its evidence chain, decisions from ADR documents, and risks from "blocked on" comments. `next_step` is deliberately EMPTY: no record states a future commitment a rule can read without guessing, and an invented next step is exactly the claim the evidence rule exists to prevent. The Claude extraction plugs into `MemoryNarrator` (`modules/memory/application/memory-narrator.ts`), whose output will pass the same `restrictEvidenceTo` + `withEvidence` guards.
- **Why:** "evidence or it didn't happen" (§1). A rule can always name the record it read; a model cannot be trusted to, so its output has to survive the same gate.
- **Tradeoff:** summaries are template strings, so they read mechanically until phase 4 rewrites them. Thresholds (48 h review wait, 7 days open, 5 working days idle, 48 h unanswered) are duplicated from `ForecastOptions` rather than shared, because the two modules own different questions; promote one constant into `@/shared/domain` if they ever need to move together.

### D-045 — The pending rule lives in the summary prefix

- **Decision:** `MemoryItem` has no rule column, so a pending summary is templated as `"<rule label> — <detail>"` and the UI/digest group by that prefix (`pendingRuleOf`). The separator and the labels are part of the contract.
- **Why:** the alternative was widening the shared `MemoryItem` schema (and the Postgres table) with a column only one module reads. Memory items are already text-first; the prefix keeps the shared spine unchanged.
- **Tradeoff:** renaming a rule label orphans previously stored items into an "Other" group until the next `buildMemory` run rewrites them.

### D-046 — `memory.search` stays unimplemented until the Embedder port

- **Decision:** `buildMemory` writes items WITHOUT embeddings. The in-memory `memory.search` contract is unchanged and simply matches nothing, because an item without a vector never matches. Phase 6/7 adds the Embedder port, embeds each item on write, and wires semantic search into Ask Flock-Radar.
- **Why:** embeddings mean an API call per item on demo boot, which would make the container slow to build for a feature nothing reads yet.
- **Tradeoff:** chat cannot search memory semantically until that phase; it can still read memory items per project through the repository.

### D-047 — One LLM port with two capabilities, and an "unavailable" implementation

- **Decision:** `@/shared/ports/llm.ts` exposes `explainAlert` and `chat` on a single `LlmPort`, with `available: boolean`. When `ANTHROPIC_API_KEY` is absent the composition root wires `createUnavailableLlm`, which returns a `failed`/`unavailable` outcome and a single `error` chat event instead of throwing.
- **Why:** both capabilities are the same dependency (one client, one key, one model) and must degrade together. Making "no key" a port implementation rather than a branch in every caller is what keeps PROMPT §1 principle 4 ("demo-proof") true by construction: the demo boot, the alerts tab, and `/ask` all take the same code path with or without a key.
- **Tradeoff:** the port carries a capability a given caller does not need, and `ChatTool.run` is erased to `(input: unknown)` so the port stays free of generic variance. `defineChatTool` restores type safety at the definition site by re-validating with the same Zod schema.

### D-048 — Explanations are a follow-up use case with an input-hash cache, not part of `runForecasts`

- **Decision:** `explainAlerts` runs after `runForecasts` (composition root, demo boot) and rewrites each active alert through `alerts.upsertForKind`, keeping the detector's `lastDetectedAt`. Results are cached by `model + JSON(input)` in a process-wide map, so a rerun on unchanged data neither calls nor writes. The LLM adapter owns generation, the grounding check, and the one corrective retry; the use case owns the deterministic template fallback and the `llmCalls` log.
- **Why:** the forecast engine must stay pure and fast — it runs on every sync and in tests — while explanation is IO, is optional, and must be skippable. Keeping the fallback in the application layer (not the adapter) means the no-key adapter has nothing to fall back *to*, and the same template serves an API error, a refusal, and twice-ungrounded prose.
- **Tradeoff:** the cache is per process, so a cold serverless instance re-pays for explanations it has already generated. Persisting the input hash would need a column on `alerts`; deferred until live mode.

### D-049 — Grounding is strict: a bare day-of-month is not a grounded number

- **Decision:** `checkGrounding` strips every rendering of an allowed date *before* extracting numbers, so `2026-10-22` and `Oct 22` pass whole, but a bare `22` does not — the day is only grounded as part of a date. Likewise, words that mix letters and digits (`P85`, `Q4`) must appear verbatim in the input text, and hex runs only count as commit SHAs when they contain a letter.
- **Why:** the check exists to catch invented numbers, and the fallback (regenerate once, then template) is cheap. A permissive checker that lets a date fragment ground an unrelated count defeats the purpose.
- **Tradeoff:** correct prose can be rejected ("the budget runs out on the 22nd"), which costs one extra call and may end on the template. That is the intended direction of the error.

### D-050 — People are organization-level

- **Decision:** `people` has no `project_id`. A person exists once in the organization and reaches projects only through `team_members -> teams -> projects`, so the same person can be on teams in several projects without being duplicated. `teams` still hangs off a project: projects stay the root of the portfolio.
- **Why:** the alternative (a person row per project) duplicates the directory, makes "what is this person working on?" a union across projects, and makes a rename a multi-row write. A status is about a PERSON, not about a project-local copy of them.
- **Tradeoff:** `people` needs its own RLS rule, because there is no project column to filter on (D-056), and `people.search` is global: a user searching by name can only be shown the people the policy lets them read.

### D-051 — The role lives on the membership

- **Decision:** `TeamRole` (`developer`, `lead`, `business_translator`, `functional_analyst`, `ux_ui_designer`) is a column on `team_members`, not on `people`. The values are stable ENGLISH identifiers because they are persisted data; the Spanish labels users read (`Desarrollador`, `Líder`, `Business Translator`, `Analista Funcional`, `Diseñador UX/UI`) live in `src/modules/cockpit/shared/ui/labels.ts`, next to `SEVERITY_LABELS`.
- **Why:** the same person is a lead in one team and a developer in another; a role on the person cannot express that. Keeping the stored value English means a wording change in the UI can never move a stored row (the same rule as every other enum in the domain).
- **Tradeoff:** "what is this person's role?" has no answer without a team; the caller must say which team it means.

### D-052 — Statuses denormalize `project_id`

- **Decision:** `statuses` carries `project_id` even though the project is reachable through `team_id`, and a composite foreign key `(project_id, team_id) -> teams (project_id, id)` keeps the two consistent. The same shape is used for the new `alerts.team_id`.
- **Why:** the same reason every other child table does it (D-027): RLS filters a status row with a plain `project_id in (...)` predicate instead of a join per row, and the composite key makes it impossible for a status to name a team of another project.
- **Tradeoff:** one redundant column, and a status cannot be moved between projects by changing the team alone.

### D-053 — A status is a first-class entity

- **Decision:** a daily status is its own table and its own domain entity, not a `memory_item`. Memory items stay derived and regenerated on every `buildMemory` run; statuses are user-authored and are never rewritten by a pipeline. Shape: `summary` (avances, required), `blockers` and `next_steps` (nullable), `reported_on`, `person_id` (whom it is about), `author_person_id` (who entered it, possibly a lead on someone's behalf), and `source` (`manual` today, with room for ingestion later). The natural key is `(person_id, reported_on)`: re-reporting a day REPLACES the entry, which is also the idempotent upsert target.
- **Why:** "evidence or it didn't happen" only works if the cited record is stable. A regenerated memory item cannot be cited by yesterday's alert; a status can. Reusing `memory_items` would also have meant one table with two lifecycles.
- **Tradeoff:** one more table and one more port group, and a person can hold only one status per day across ALL their teams — deliberate (a day is a day), but it means a person on two projects reports once, naming one team.

### D-054 — The active-alert key includes the subject

- **Decision:** `alerts` keeps `project_id NOT NULL` (isolation and RLS) and gains nullable `team_id` and `person_id`: the SUBJECT the alert is about. The generated `active_key` becomes `project_id:kind:team:person` while the alert is active, with the sentinel `-` for a null subject, and keeps its plain unique index. `alerts.upsertForKind` takes the subject from the draft in both repositories, and `alertSubjectKey` in the domain is the single definition both adapters agree on.
- **Why:** with `project_id:kind` alone, an active "stalled work" alert about one person blocked the alert about a second person — the first problem detected would hide every other one of that kind. The sentinel keeps the expression deterministic (a stored generated column must be) and keeps a plain unique index usable, which is what PostgREST needs: it cannot send a `WHERE` predicate on an upsert (D-029).
- **Tradeoff:** the key is longer and the sentinel is a reserved value: a team or person id can never be the single character `-` (it cannot, they are uuids). Detectors in this slice are still project-wide and pass `null` for both.

### D-055 — `alerts.updated_at` belongs to the writer

- **Decision:** the `alerts_set_updated_at` trigger now calls `set_updated_at_unless_supplied()`, which stamps `now()` only when the statement did not change `updated_at`. `upsertForKind` therefore stores the DETECTION timestamp, as the port always promised. The other `updated_at` triggers are unchanged.
- **Why:** this closes live-mode debt #2. The old trigger overwrote `updated_at` with the write time on every UPDATE, so a re-detection recorded when the row was written instead of when the problem was seen — harmless while detectors run against the current clock, wrong for any backfill.
- **Tradeoff:** a writer that sets `updated_at` to its CURRENT value gets `now()` anyway (the trigger cannot tell "set to the same value" from "not set"), and a buggy writer can now store a timestamp of its choosing. Both are acceptable: all alert writes go through one repository method.

### D-056 — People are readable through a shared project

- **Decision:** `people` is readable by an authenticated user who shares at least one project with that person, resolved by the security-definer helper `shares_project_with_person(id)` (`team_members -> teams -> project_members`). Ended memberships still count. `teams` and `statuses` use the ordinary `project_id in (...)` policy; `team_members` is filtered through its team's project.
- **Why:** the alternative, "readable by all authenticated users", is simpler and faster but turns the table into an organization-wide directory for anyone with an account, which is more than the rest of the schema gives away. The helper keeps `people` as least-privilege as every project-scoped table.
- **Tradeoff:** the check is per row (a correlated function call), not the uncorrelated subquery the project-scoped policies use, so it is the most expensive read policy in the schema. A person on no team is invisible to everyone, and so is a status author who is not on any team of the reader's projects — acceptable because authors are team members in practice, but it is a real edge.

### D-057 — Status evidence links are internal

- **Decision:** `Evidence.sourceType` gains `status`, whose `url` is an INTERNAL app path, `"/projects/{projectId}/statuses/{statusId}"` (`statusEvidenceUrl`), consistent with the existing `/projects/[id]` route. The page itself is not part of this slice. `Evidence.url` therefore validates with `LinkSchema` (an absolute http(s) URL **or** a root-relative app path) instead of `HttpUrlSchema`. The path form rejects a protocol-relative `//host` and a backslash, so it can only ever resolve against this origin, and `javascript:` stays rejected as before. The evidence chip renders an internal link in place instead of in a new tab.
- **Why:** a status-derived claim must cite the actual status record, and that record only exists here. Sending the reader to an absolute URL would have meant hard-coding the deployment's own origin into stored data.
- **Tradeoff:** `Evidence.url` is no longer "always absolute", so any consumer that assumed it could be handed to `new URL(...)` without a base must pass one. Storing a relative link also means the record is only meaningful inside this app — which is exactly what it is.

## Known debt (phase 3)

Found in review of the forecast engine, deliberately deferred so the three modules can be finished end to end first. Each is a real behaviour gap, not a style preference.

| # | Debt | Where |
|---|------|-------|
| 1 | Scope creep and sprint completion disagree for issues created directly in the sprint: real Jira writes no changelog entry when the sprint field is set at creation, so such issues raise `current` without producing a `ScopeChange`. Fix: synthesize an `added` change at `createdAt`, then assert `net === current - committed`. | `domain/sprint-scope.ts`, `domain/scope-creep.ts` |
| 2 | An active sprint whose end date has passed gets an `eta` in the past and an empty burn-up cone, although P50/P85 dates are computed from the horizon. | `domain/sprint-completion.ts` |
| 3 | `doneByDay` is revisionist: it uses each issue's current size and current resolution, so a re-estimate after a resolution can push a past day above the scope line, and a reopened issue never shows as done. It should be rebuilt point-in-time from the changelog. | `domain/sprint-scope.ts` |
| 4 | Today is counted twice: work already resolved today is in `done`, and today also gets a full simulated day of throughput. | `domain/sprint-completion.ts` |
| 5 | `cumulativeP50` / `cumulativeP85` name opposite tails (median vs. 15th percentile), which reads as a contradiction. Rename before any chart binds to them. | `domain/monte-carlo.ts` |
| 6 | Throughput sampling tradeoffs are undocumented: weekend resolutions attributed to the previous working day, samples outside sprint windows dropped, overlapping history windows double-counting a day, and current (not point-in-time) estimates used for history. | `domain/throughput.ts`, D-037 |
| 7 | The domain relies on the repository's ordering without re-sorting, so a differently ordered implementation would shift sample order and therefore the seeded draws. Sort by a stable key in the domain and state the guarantee on the port. | `domain/*`, `shared/ports/radar-repository.ts` |
| 8 | The sprint probabilities have no engine-independent anchor: `expectations.ts` and the engine are one implementation, so the calibration test asserts the engine against itself. Cobalt's budget already has a hand-computed anchor in `dataset.test.ts`; sprint risk needs the same. D-037's "cannot drift" claim is too strong until it does. | `adapters/demo/scenario/*`, D-037 |


## Known debt (live mode)

Found while implementing the Supabase repository. Each is a real behaviour gap between the in-memory adapter and the live one, deliberately deferred. The former entry #2 (`alerts.updated_at` overwritten by the trigger) is RESOLVED by [D-055](#d-055--alertsupdated_at-belongs-to-the-writer); the remaining entries were renumbered.

| # | Debt | Where |
|---|------|-------|
| 1 | **No authentication.** Live mode runs on the service role, so RLS is bypassed and the deployment is public. See [D-030](#d-030--live-mode-runs-on-the-service-role-and-is-therefore-unauthenticated). | `composition-root.ts`, `adapters/supabase/client.ts` |
| 2 | Repository-assigned ids differ between adapters. The in-memory repository derives deterministic ids for forecasts, reports, sync runs, LLM calls, and alerts (D-043); live mode lets Postgres generate them. Deep links built in demo mode do not resolve against a live database seeded from the same scenario. | `adapters/demo/in-memory-radar-repository.ts`, `adapters/supabase/radar-repository.ts` |
| 3 | `llmCalls.totals()` pages the whole table client-side instead of aggregating in Postgres. Fine for the admin page today, linear in call volume forever. Fix: a `security definer` aggregate function behind the same admin check as D-026. | `adapters/supabase/radar-repository.ts` |
| 4 | Issue children cost one extra round-trip. `issue_events`, `issue_comments`, and `worklogs` reference `issues.id`, but the domain carries `issueKey`, so every read and write first loads the project's `(id, key)` map. Fix: either embed the key through the composite foreign key in the PostgREST select, or store `issue_key` alongside `issue_id`. | `adapters/supabase/radar-repository.ts` |
| 5 | `capacity.person` and `issues.assignee` are still free-text names, not `people` references, so "who is this?" is a string match between the calendar, the tracker, and the team roster. Deliberately deferred with the teams slice: linking them means owning identity resolution for records that come from systems with their own user directories. Fix: resolve the source identity to a `person_id` at the adapter boundary and keep the display name as a fallback. | `supabase/migrations/0001_core.sql`, `adapters/jira/*`, `adapters/calendar/*` |
| 6 | No UI for team and status management, and no LLM pass over the statuses. The data model, both repositories, and the demo dataset are in place; reading and writing statuses from the cockpit, and analysing them, are the next slice. The internal evidence URL `"/projects/{id}/statuses/{statusId}"` ([D-057](#d-057--status-evidence-links-are-internal)) points at a route that does not exist yet. | `app/projects/[id]/*`, `modules/cockpit/*` |
