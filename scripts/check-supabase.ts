/**
 * Connectivity probe for a Supabase project.
 *
 * Verifies credentials and reachability WITHOUT requiring any migration to be
 * applied, so it can be run against a brand-new, empty project.
 *
 * Run with:
 *   node --env-file=.env.local --experimental-strip-types scripts/check-supabase.ts
 *
 * Secrets are never printed: only the key *kind* and whether it is present.
 */

type KeyKind = "publishable" | "secret" | "legacy-jwt" | "unknown";

const PASS = "PASS";
const FAIL = "FAIL";
const WARN = "WARN";

function classifyKey(key: string): KeyKind {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("eyJ")) return "legacy-jwt";
  return "unknown";
}

function line(status: string, message: string): void {
  console.log(`[${status}] ${message}`);
}

/** Reads a variable without ever echoing its value. */
function readVar(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function main(): Promise<void> {
  console.log("Supabase connectivity check\n");

  const url = readVar("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = readVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceKey = readVar("SUPABASE_SERVICE_ROLE_KEY");

  let failed = false;

  // 1. Presence
  for (const [name, value] of [
    ["NEXT_PUBLIC_SUPABASE_URL", url],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ] as const) {
    if (value) {
      const detail = name.endsWith("URL") ? value : `${classifyKey(value)} key`;
      line(PASS, `${name} is set (${detail})`);
    } else {
      line(FAIL, `${name} is missing or empty`);
      failed = true;
    }
  }

  if (!url || !anonKey || !serviceKey) {
    console.log(
      "\nAdd the missing variables to .env.local, then run this check again.",
    );
    process.exit(1);
  }

  // 2. URL shape
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      line(FAIL, `URL must use https, got ${parsed.protocol}`);
      failed = true;
    }
    origin = parsed.origin;
    line(PASS, `URL parses as ${origin}`);
  } catch {
    line(FAIL, "URL is not a valid absolute URL");
    console.log("\nExpected something like https://xxxxxxxx.supabase.co");
    process.exit(1);
  }

  // 3. Legacy key warning — anon/service_role JWTs are deprecated end of 2026.
  for (const [name, value] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ] as const) {
    if (classifyKey(value) === "legacy-jwt") {
      line(WARN, `${name} is a legacy JWT key; prefer the new sb_* keys`);
    } else if (classifyKey(value) === "unknown") {
      line(WARN, `${name} has an unrecognised format; it may be wrong`);
    }
  }

  // 4. Reachability + auth, using the PostgREST root.
  //    This responds on an empty project, so it needs no migration.
  async function probe(label: string, key: string): Promise<void> {
    // The PostgREST root serves the OpenAPI document, which lists every exposed
    // table and column, so Supabase restricts it to secret keys. A publishable
    // key is checked against the Auth settings endpoint instead; both prove the
    // key belongs to this project.
    const introspects = classifyKey(key) !== "publishable";
    const endpoint = introspects ? `${origin}/rest/v1/` : `${origin}/auth/v1/settings`;
    const started = Date.now();
    let response: Response;
    try {
      // Publishable and secret keys are short strings, not JWTs, so they go on
      // `apikey` only. Putting one on `Authorization: Bearer` makes PostgREST
      // try to verify it as a JWT, which fails with a 401. `Authorization` is
      // reserved for a signed-in user's own JWT.
      const headers: Record<string, string> = { apikey: key };
      if (classifyKey(key) === "legacy-jwt") {
        headers.Authorization = `Bearer ${key}`;
      }
      response = await fetch(endpoint, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown error";
      line(FAIL, `${label}: could not reach ${endpoint} (${reason})`);
      failed = true;
      return;
    }

    const ms = Date.now() - started;
    if (response.ok) {
      line(PASS, `${label}: authenticated against the project (${ms} ms)`);
      if (!introspects) return;
      // The OpenAPI document lists the exposed tables, which tells us whether
      // the migrations have been applied yet.
      try {
        const spec = (await response.json()) as { paths?: Record<string, unknown> };
        const tables = Object.keys(spec.paths ?? {})
          .filter((path) => path !== "/" && !path.startsWith("/rpc/"))
          .map((path) => path.replace(/^\//, ""));
        if (tables.length === 0) {
          line(WARN, `${label}: no tables exposed yet (migrations not applied)`);
        } else {
          line(PASS, `${label}: ${tables.length} tables exposed`);
        }
      } catch {
        line(WARN, `${label}: authenticated, but the schema listing was unreadable`);
      }
      return;
    }

    if (response.status === 401 || response.status === 403) {
      line(
        FAIL,
        `${label}: rejected (HTTP ${response.status}) — the key does not belong to this project`,
      );
    } else if (response.status === 404) {
      line(FAIL, `${label}: HTTP 404 — the URL does not look like a Supabase project`);
    } else {
      line(FAIL, `${label}: HTTP ${response.status}`);
    }
    failed = true;
  }

  console.log();
  await probe("anon/publishable key", anonKey);
  await probe("service role/secret key", serviceKey);

  console.log();
  if (failed) {
    console.log("Connection check FAILED. Fix the items above and re-run.");
    process.exit(1);
  }
  console.log("Connection check PASSED. The project is reachable and the keys are valid.");
}

await main();

export {};
