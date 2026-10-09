import { describe, expect, it, vi } from "vitest";

import { stubIsolatedEnv } from "@test/helpers/env";

// `connection()` requires a Next.js request scope; outside of one it throws.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

async function loadRoute(env: Record<string, string>) {
  stubIsolatedEnv(env);
  vi.resetModules();
  return import("./route");
}

describe("GET /api/health", () => {
  it("returns exactly status, mode, and model", async () => {
    const { GET } = await loadRoute({
      DEMO_MODE: "true",
      ANTHROPIC_API_KEY: "sk-ant-test-secret",
      CRON_SECRET: "cron-secret-0123456789",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["mode", "model", "status"]);
    expect(body).toEqual({
      status: "ok",
      mode: "demo",
      model: "claude-opus-5-5",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  const LIVE_ENV = {
    DEMO_MODE: "false",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  };

  it("reports live mode and a reachable database", async () => {
    // Stands in for PostgREST: an empty `projects` collection.
    vi.stubGlobal("fetch", async () =>
      Response.json([], { headers: { "content-range": "*/0" } }),
    );
    const { GET } = await loadRoute(LIVE_ENV);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      mode: "live",
      model: "claude-opus-5-5",
      database: "ok",
    });
  });

  it("degrades without leaking why the database is unreachable", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { message: 'relation "public.projects" does not exist at 10.0.0.1:5432' },
        { status: 500 },
      ),
    );
    const { GET } = await loadRoute(LIVE_ENV);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "degraded",
      mode: "live",
      model: "claude-opus-5-5",
      database: "unreachable",
    });
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("does not hang when the database never answers", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => undefined));
    const { GET } = await loadRoute(LIVE_ENV);

    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).database).toBe("unreachable");
  }, 10_000);
});
