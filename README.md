# Flock-Radar

Flock-Radar is a cockpit for engineering leaders. It **anticipates** delivery risks with a date and a confidence, **remembers** what the team did with verifiable evidence, and **unifies** progress reports, client reports, team metrics, and natural-language questions over Jira, GitHub, Google Calendar, and Flocktools.

Out of the box it runs in **demo mode**: seeded data, no accounts, no API keys.

> ⚠️ **Live mode (`DEMO_MODE=false`) has no authentication yet.** It talks to Supabase with the service role key, so RLS is bypassed and the deployment is public. Do not point it at real client data — see [Security note](#security-note-live-mode-has-no-authentication).

> **Status: phase 2 (data spine).** The app shell, env validation, health check, and the authenticated cron endpoint work, and demo mode now boots a seeded three-project scenario through the real sync pipeline. Everything else below is marked with the phase that delivers it.

## Quickstart

Requires Node.js `^22.12.0 || >=24` (see `engines` in `package.json`).

```bash
npm install
cp .env.example .env.local   # DEMO_MODE=true by default
npm run dev                  # http://localhost:3000
```

Check it is up: `curl http://localhost:3000/api/health` returns `{"status":"ok","mode":"demo","model":"claude-opus-5-5"}`.

## What works today

| Capability | Status |
|------------|--------|
| App shell, demo-mode badge, placeholder pages | Available |
| Validated server-only env (`DEMO_MODE`, live-mode requirements) | Available |
| `GET /api/health` | Available |
| `GET /api/cron/sync` (Bearer `CRON_SECRET`, currently a no-op) | Available |
| Demo scenario (3 projects) synced into an in-memory repository | Available (data only; UI in phase 5) |
| Supabase schema, RLS, and pgvector search (`supabase/migrations`) | Available (validated on PGlite in tests) |
| Portfolio cards | Planned (phase 5) |
| Forecast engine and alerts | Planned (phase 3) |
| AI explanations with deterministic template fallback | Planned (phase 4) |
| Memory, Ask Flock-Radar chat, reports | Planned (phases 6 to 8) |
| Live mode: Supabase repository (service role, reads and writes) | Available — **unauthenticated**, see the security note below |
| Live mode: magic-link auth, RLS actually enforced | Planned |
| Real Jira / GitHub / Calendar / Flocktools ingestion | Planned (phase 9) |

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint, including the hexagonal import rules |
| `npm run typecheck` | Generate Next.js route types, then `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest (single run / watch) |
| `npm run seed:supabase` | Push the demo scenario into a live Supabase project (idempotent). Needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and the migrations applied first |

## Live mode (Supabase)

Live mode reads whatever the database already holds; it never syncs on boot, because the Jira/GitHub/Calendar/Flocktools adapters are still pending. Read the [security note](#security-note-live-mode-has-no-authentication) first.

1. **Create a Supabase project** and copy its URL and keys.
2. **Apply the migrations in order** — `0001_core.sql`, `0002_rls.sql`, `0003_memory_vector.sql`. Either paste them into the SQL editor in that order, or run `supabase db push` with the CLI linked to the project.
3. **Set the environment variables** (in `.env.local` locally, or in the hosting dashboard):

   ```bash
   DEMO_MODE=false
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<service role / secret key>
   ```

4. **Seed the demo scenario** (optional, but a live database with nothing in it shows empty pages):

   ```bash
   npm run seed:supabase
   ```

   It is idempotent: re-running it the same day rewrites the same rows. `forecasts` is append-only by design, so each run adds one forecast row per project and kind.

5. **Check it**: `curl http://localhost:3000/api/health` returns `{"status":"ok","mode":"live","model":"...","database":"ok"}`. A `503` with `"database":"unreachable"` means the credentials or the migrations are wrong.

Run the live integration suite against that project with:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
```

Without those variables the suite skips, so `npm test` stays green with no credentials.

## Docs

- [Architecture](docs/architecture.md): C4 diagrams, sync and chat sequences, folder structure, layering rules.
- [Decisions](docs/decisions.md): what we chose, why, and the tradeoffs.
- [.env.example](.env.example): every environment variable, grouped and commented.

## Deploy

Demo mode needs nothing but a Vercel project.

1. Push this repository to GitHub.
2. Import it in the [Vercel dashboard](https://vercel.com/new), or run `npx vercel` after `npx vercel login`.
3. Set environment variables in the Vercel project settings:
   - `DEMO_MODE=true` is enough for a working demo.
   - Add `CRON_SECRET` (at least 16 characters, for example `openssl rand -hex 32`) so the cron job in `vercel.json` can authenticate. It runs daily, within the 07:00 UTC hour (Vercel Hobby precision).
4. Deploy.

> ### Security note: live mode has no authentication
>
> `DEMO_MODE=false` connects to Supabase with the **service role key**, which bypasses Row Level Security. The policies in `supabase/migrations/0002_rls.sql` are in place but **are not the enforcement layer today**, because nothing authenticates and every query runs as a privileged service.
>
> In practice that means a live deployment is **public**: anyone who can reach the URL sees every project, every issue, and every alert. There is no login, no session, and no per-user scoping yet.
>
> **Do not point live mode at real client data.** Use it with the seeded demo scenario, behind a private URL, until magic-link authentication and the request-scoped RLS repository land (see [D-030](docs/decisions.md#d-030--live-mode-runs-on-the-service-role-and-is-therefore-unauthenticated)). For anything shared, keep `DEMO_MODE=true`.
