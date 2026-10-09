import { describe, expect, it, vi } from "vitest";

import { stubIsolatedEnv } from "@test/helpers/env";

const SECRET = "s3cr3t-cron-token-0123";
const CRON_URL = "http://localhost/api/cron/sync";

/**
 * The env is memoized per module instance, so each test stubs an isolated env
 * first and then imports a fresh copy of the route.
 */
async function loadRoute(cronSecret?: string) {
  stubIsolatedEnv({
    DEMO_MODE: "true",
    ...(cronSecret === undefined ? {} : { CRON_SECRET: cronSecret }),
  });
  vi.resetModules();
  return import("./route");
}

function requestWith(authorization?: string): Request {
  return new Request(CRON_URL, {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("GET /api/cron/sync", () => {
  it("returns 401 without an Authorization header", async () => {
    const { GET } = await loadRoute(SECRET);
    const response = await GET(requestWith());
    expect(response.status).toBe(401);
  });

  it("returns 401 with a wrong secret", async () => {
    const { GET } = await loadRoute(SECRET);
    const response = await GET(requestWith("Bearer wrong-secret-0123456789"));
    expect(response.status).toBe(401);
  });

  it("returns 401 when the secret is sent without the Bearer scheme", async () => {
    const { GET } = await loadRoute(SECRET);
    const response = await GET(requestWith(SECRET));
    expect(response.status).toBe(401);
  });

  it("returns 401 for any request when CRON_SECRET is unset", async () => {
    const { GET } = await loadRoute();
    for (const header of [undefined, "Bearer ", "Bearer undefined"]) {
      const response = await GET(requestWith(header));
      expect(response.status).toBe(401);
    }
  });

  it("returns 202 noop with the correct secret", async () => {
    const { GET } = await loadRoute(SECRET);
    const response = await GET(requestWith(`Bearer ${SECRET}`));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "noop",
      reason: "sync implemented in phase 9",
    });
  });

  it("accepts a configured secret that carries a trailing newline", async () => {
    const { GET } = await loadRoute(`${SECRET}\n`);
    const response = await GET(requestWith(`Bearer ${SECRET}`));
    expect(response.status).toBe(202);
  });
});
