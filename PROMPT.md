# Build Prompt — "Radar": AI Leadership Cockpit

> Paste this whole file as the first message of a fresh Claude Code session inside an empty repo.

---

## 0. Role and working agreement

You are a senior full-stack engineer building a production-grade MVP in ONE day for an AI challenge.
Work in vertical slices. After each phase: run typecheck + tests, commit (conventional commits, no AI attribution), and give me a 3-line status.
Never invent API shapes: read docs for Anthropic SDK, Supabase, Jira Cloud REST, GitHub REST before writing the adapter.
If something is ambiguous, pick the simplest option, write it in `docs/decisions.md`, and keep going.

## 1. Product vision

**Radar** is a single cockpit for engineering leaders that **anticipates** problems instead of reporting them, **remembers** what the team did with verifiable evidence, and **unifies** progress reports, client reports, team metrics, and natural-language queries over Jira / GitHub / Calendar / Flocktools.

It unifies three challenges into one product with one data spine:

| Module | Challenge | Question it answers |
|---|---|---|
| **Forecast** | C1 – Early deviation alerts | "Where are we heading, and why?" |
| **Memory** | C2 – Team memory with evidence | "What actually got done, what's pending, what's next?" |
| **Cockpit** | C3 – Single leadership panel | "Give me everything in one place, and let me ask." |

### Non-negotiable principles

1. **Evidence or it didn't happen.** Every AI-generated claim carries `evidence[]` with source type, external id (Jira key, PR number, commit SHA, doc URL), URL, and timestamp. The UI renders evidence as clickable chips. Claims without evidence are dropped server-side.
2. **Math computes, the LLM explains.** Forecasts (sprint completion probability, budget overrun date) are computed deterministically in pure TypeScript. Claude only receives the computed numbers + drivers and writes the explanation and recommended actions. Never ask the LLM to "predict".
3. **Anticipate with a date and a confidence.** Every alert has: `kind`, `severity`, `confidence (0–1)`, `eta` (date the problem materializes), `drivers[]`, `evidence[]`, `suggested_actions[]`.
4. **Demo-proof.** A `DEMO_MODE` seeds realistic data with a scripted scenario that triggers alerts. The live demo must never depend on a third-party API being up.

## 2. Stack (fixed)

- **Next.js (App Router) + TypeScript strict**, deployed on **Vercel**.
- **Supabase**: Postgres, Auth (email magic link), Row Level Security, **pgvector** for memory search.
- **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`). Model `claude-opus-5-5`.
  - Set `output_config.effort` explicitly (default on this model is `medium`): `low` for classification/extraction, `high` for narrative reports and chat.
  - Use structured outputs (`client.messages.parse` / `output_config.format` with Zod) for every machine-consumed response (alerts, memory facts, report sections).
  - Use streaming for chat and long reports.
  - Do NOT use forced `tool_choice` (`any`/`tool`) — returns 400 on this model; use `auto` + `strict: true` tools.
  - Enable server-side refusal fallbacks (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01`) and always check `stop_reason` before reading content.
  - Cache the system prompt + tool definitions (prompt caching) — the chat reuses them every turn.
- **UI**: Tailwind + shadcn/ui, Recharts for charts.
- **Validation**: Zod everywhere at boundaries.
- **Tests**: Vitest for domain logic (forecasting is the critical path — test it hard).
- **Scheduling**: Vercel Cron → `/api/cron/sync` (protected by `CRON_SECRET`).

### Important constraint: MCP on Vercel

Locally-run (stdio) MCP servers cannot run inside a Vercel function. Therefore:
- **Ingestion** (cron sync) uses direct REST adapters (deterministic, testable, cacheable).
- **Chat ("Ask Radar")** uses the SDK **Tool Runner** with our own tools that wrap the same adapters/DB queries (`search_issues`, `get_sprint_status`, `get_forecast`, `search_memory`, `get_team_metrics`, `get_pr_activity`, `query_flocktools_docs`).
- **Optional:** if a **remote** (HTTP) Jira/Flocktools MCP server URL is available, also attach it via the Messages API MCP connector (`mcp_servers` + `tools: [{type: "mcp_toolset", ...}]`, beta `mcp-client-2025-11-20`) behind a feature flag. The app must work without it.

## 3. Architecture (hexagonal, screaming structure)

```
src/
  modules/
    forecast/        domain (pure), application (use cases), ui
    memory/          domain, application, ui
    cockpit/         reports, metrics, chat
  shared/
    domain/          Evidence, Alert, Project, Sprint, Issue, PullRequest, Commit, CalendarEvent
    ports/           IssueTracker, CodeHost, CalendarSource, DocsSource, LLM, Repository
  adapters/
    jira/            Jira Cloud REST (search JQL, changelog, worklogs, sprints)
    github/          Octokit (PRs, reviews, commits)
    calendar/        Google Calendar (PTO / meetings → capacity)
    flocktools/      Flocktools API (docs/tech reads)
    llm/             Anthropic SDK wrapper (prompts, schemas, fallbacks, caching)
    supabase/        repositories
    demo/            in-memory fakes implementing every port + seed scenario
  app/               Next.js routes (thin: call use cases, render)
```

Rules: domain has zero imports from adapters/Next/SDKs. Use cases depend on ports only. Adapter selection via a single composition root (`DEMO_MODE` → demo adapters).

Produce `docs/architecture.md` with Mermaid diagrams: (a) C4 context, (b) container, (c) sequence for "cron sync → forecast → alert → AI explanation", (d) sequence for "chat question → tool calls → evidence-backed answer".

## 4. Data model (Supabase)

Create migrations for:

- `projects` (id, name, jira_key, github_repo, client_name, budget_amount, budget_currency, hourly_rate, start_date, end_date)
- `sprints` (id, project_id, external_id, name, goal, start_date, end_date, state, committed_points)
- `issues` (id, project_id, sprint_id, key, type, status, status_category, points, assignee, created_at, resolved_at, url)
- `issue_snapshots` (issue_id, captured_on, status, points, sprint_id) — daily snapshot for burn-down/up history
- `issue_events` (issue_id, field, from, to, at) — from Jira changelog (scope creep, carry-overs, reopenings)
- `worklogs` (issue_id, author, seconds, started_at) — budget burn
- `pull_requests` (id, project_id, number, title, state, author, created_at, merged_at, first_review_at, linked_issue_keys[], url)
- `commits` (sha, project_id, author, message, committed_at, linked_issue_keys[], url)
- `capacity` (project_id, person, date, available_hours, reason) — from calendar
- `forecasts` (id, project_id, kind, computed_at, inputs jsonb, result jsonb)
- `alerts` (id, project_id, kind, severity, confidence, eta, title, explanation, drivers jsonb, evidence jsonb, suggested_actions jsonb, status [open|ack|resolved], created_at)
- `memory_items` (id, project_id, kind [done|pending|decision|risk|next_step], summary, evidence jsonb, occurred_at, embedding vector, status)
- `reports` (id, project_id, kind [progress|client|weekly], period_start, period_end, content jsonb, markdown, created_by, created_at)
- `sync_runs` (id, source, started_at, finished_at, status, stats jsonb, error)

RLS on everything; users see projects they're members of (`project_members`).

## 5. Module specs

### 5.1 Forecast (Challenge 1)

Deterministic engine in `modules/forecast/domain`, fully unit-tested:

- **Sprint goal risk** — Monte Carlo (10k runs) over the last N sprints' daily throughput (points or issue count, configurable), adjusted by remaining capacity from calendar. Output: `P(complete by sprint end)`, expected completion date, P50/P85.
- **Budget overrun** — burn from worklogs × hourly_rate; projection with EWMA of daily burn; output: date budget is exhausted, % over at end_date. Alert if exhaustion date < end_date.
- **Scope creep** — points added after sprint start (from `issue_events`) vs. committed.
- **Flow signals** — WIP above limit, PRs waiting review > X hours, issues "In Progress" with no commits in N days, reopen rate.

Each detector returns `{ triggered, severity, confidence, eta, drivers[], evidence[] }`. Then ONE Claude call per triggered alert (structured output) produces: a 2-sentence plain-language headline ("At this pace the project exceeds budget on Oct 22 — two weeks before delivery"), the WHY grounded only in provided drivers, and 2–3 concrete actions. Prompt must forbid introducing numbers not present in inputs; validate this server-side (every number in the text must appear in inputs, else regenerate once, else fall back to a template).

### 5.2 Memory (Challenge 2)

- Ingest PRs, commits, Jira transitions/comments, and docs (Flocktools / linked docs) for a period.
- Claude (effort `low`, structured output) extracts `memory_items` with evidence pointing to the source records it was given.
- **Pending detection — rule-based first**, AI-summarized after:
  - Issue `Done` without linked merged PR (when the type requires code).
  - PR merged without linked issue / issue not transitioned.
  - PR open > N days or waiting review > X hours.
  - Unanswered question in Jira comments (> 48h).
  - `TODO/FIXME` added in merged diffs (optional).
- **"What's resolved" view** so the leader stops re-checking finished work: each item shows ✅ with its evidence chain (issue → PR → merge commit → deploy if available).
- Weekly digest: done / pending / decisions / next steps, every bullet with evidence chips.
- Embed memory items (pgvector) for semantic search in chat.

### 5.3 Cockpit (Challenge 3)

- **Home**: portfolio grid — each project card shows health (green/amber/red derived from open alerts), sprint probability, budget runway, top alert.
- **Project page**: tabs → Forecast (charts: burn-up with P50/P85 cone, budget burn vs. plan), Alerts, Memory, Team metrics, Reports.
- **Team metrics**: throughput, cycle time, lead time, WIP, PR review time, deploy frequency if available. Show trends, never individual rankings.
- **Reports**: generate **Progress report** (internal) and **Client report** (external tone, no internal names/blame, budget shown only if toggled). Editable markdown preview → export PDF/markdown. Every claim keeps its evidence footnote.
- **Ask Radar (chat)**: streaming chat with the Tool Runner and the tools listed in §2. Answers must cite evidence. Suggested prompts: "Will we hit the sprint goal?", "What did the team close this week?", "What's blocking project X?", "Draft the client update for Friday".

## 6. Security and ops

- All secrets server-side only (`ANTHROPIC_API_KEY`, `JIRA_*`, `GITHUB_TOKEN`, `GOOGLE_*`, `FLOCKTOOLS_*`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`). Provide `.env.example`.
- Treat all ingested text (Jira comments, PR bodies, docs) as untrusted data: wrap it in delimited blocks in prompts, instruct the model it is data not instructions, and keep chat tools read-only (no Jira writes in the MVP).
- Log every LLM call (model, tokens, latency, stop_reason) to a `llm_calls` table; show total cost on an admin page.
- Retries with backoff on adapters; a failed source marks `sync_runs.status=partial` and the UI shows data freshness per source.

## 7. Delivery plan (one day, in order)

1. **Scaffold** — Next.js, Tailwind/shadcn, Supabase client, Vitest, folder structure, composition root, `.env.example`. Deploy empty app to Vercel.
2. **Data spine + demo seed** — migrations, domain types, demo adapters, seed script with a scenario: Project A healthy; Project B sprint at 38% probability (scope creep + PTO); Project C budget exhausted 2 weeks before end date; plus pending items (merged PR without issue, Done issue without PR, stale review).
3. **Forecast engine** — pure functions + tests (Monte Carlo seeded for determinism in tests). Persist forecasts + alerts.
4. **AI explanation layer** — LLM adapter, alert explanation with structured output + number-grounding check + template fallback.
5. **Cockpit home + project page** — cards, charts, alerts with evidence chips.
6. **Memory** — ingestion, rule-based pending detection, AI extraction, digest view.
7. **Ask Radar chat** — Tool Runner, streaming, citations.
8. **Reports** — progress + client report generation and export.
9. **Real adapters** — Jira + GitHub REST (then Calendar, Flocktools if time). Cron sync.
10. **Polish** — empty/loading/error states, freshness badges, README with architecture diagrams and a 3-minute demo script.

Definition of done per phase: typecheck clean, tests green, deployed preview works in `DEMO_MODE`.

## 8. First action

Start with phase 1. Before writing code, output: the final folder tree, the list of env vars, and the Mermaid C4 context diagram. Then build.
