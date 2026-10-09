import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubIsolatedEnv } from "@test/helpers/env";

const SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
  ANTHROPIC_API_KEY: "sk-ant-secret-value",
  VOYAGE_API_KEY: "voyage-secret-value",
  JIRA_API_TOKEN: "jira-secret-value",
  GITHUB_TOKEN: "github-secret-value",
  GOOGLE_PRIVATE_KEY: "google-private-key-value",
  FLOCKTOOLS_API_TOKEN: "flocktools-secret-value",
  REMOTE_MCP_JIRA_TOKEN: "mcp-secret-value",
  CRON_SECRET: "cron-secret-value-0123456789",
};

const LIVE_ENV = {
  DEMO_MODE: "false",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_APP_URL: "https://radar.example.com",
  ...SECRETS,
};

async function loadModule(env: Record<string, string>) {
  stubIsolatedEnv(env);
  vi.resetModules();
  const compositionRoot = await import("./composition-root");
  compositionRoot.resetContainer();
  return compositionRoot;
}

async function loadContainer(env: Record<string, string>) {
  const { getContainer } = await loadModule(env);
  return getContainer();
}

function expectNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(SECRETS)) {
    expect(serialized).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.doUnmock("@/adapters/demo");
  (await import("./composition-root")).resetContainer();
});

describe("getContainer", () => {
  it("exposes only non-secret configuration and ports in live mode", async () => {
    const container = await loadContainer(LIVE_ENV);

    expect(Object.keys(container).sort()).toEqual([
      "appUrl",
      "clock",
      "llm",
      "llmAvailable",
      "mode",
      "model",
      "repo",
      "sources",
    ]);
    expect(container.mode).toBe("live");
    expectNoSecrets(container);
  });

  it("exposes no secrets in demo mode either", async () => {
    const container = await loadContainer({ DEMO_MODE: "true", ...SECRETS });
    expect(container.mode).toBe("demo");
    expectNoSecrets(container);
  });

  it("selects demo mode by default and boots the scenario through sync", async () => {
    const container = await loadContainer({});

    expect(container.mode).toBe("demo");
    expect(container.model).toBe("claude-opus-5-5");
    expect(container.clock.now()).toBeInstanceOf(Date);

    const projects = await container.repo.projects.list();
    expect(projects.map((project) => project.jiraKey).sort()).toEqual(["ATL", "BCN", "CBL"]);
    for (const project of projects) {
      expect(await container.repo.issues.byProject(project.id)).not.toHaveLength(0);
      expect(await container.repo.pullRequests.byProject(project.id)).not.toHaveLength(0);
      expect(await container.repo.capacity.byProject(project.id)).not.toHaveLength(0);
      const runs = await container.repo.syncRuns.latestBySource(project.id);
      expect(runs.map((run) => [run.source, run.status])).toEqual([
        ["jira", "ok"],
        ["github", "ok"],
        ["calendar", "ok"],
        ["docs", "ok"],
      ]);
    }

    // Boot also runs the forecast engine: alerts exist with evidence.
    const alertKinds = async (jiraKey: string) => {
      const project = projects.find((item) => item.jiraKey === jiraKey);
      const alerts = await container.repo.alerts.byProject(project?.id ?? "");
      for (const alert of alerts) expect(alert.evidence.length).toBeGreaterThan(0);
      return alerts.map((alert) => alert.kind);
    };
    expect(await alertKinds("BCN")).toContain("sprint_goal_risk");
    expect(await alertKinds("CBL")).toContain("budget_overrun");
    expect(await alertKinds("ATL")).toEqual([]);
    const beacon = projects.find((item) => item.jiraKey === "BCN");
    expect(await container.repo.forecasts.latest(beacon?.id ?? "", "sprint_completion")).not.toBeNull();
  });

  it("returns the same promise and instance on repeated calls within a day", async () => {
    const { getContainer } = await loadModule({});
    const first = getContainer();
    expect(getContainer()).toBe(first);
    expect(await getContainer()).toBe(await first);
  });

  it("shares one container across module instances in the process", async () => {
    const first = await loadContainer({});
    vi.resetModules();
    const { getContainer } = await import("./composition-root");
    expect(await getContainer()).toBe(first);
  });

  it("rebuilds the demo container when the UTC day changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T23:00:00Z"));
    const { getContainer } = await loadModule({});

    const today = await getContainer();
    vi.setSystemTime(new Date("2026-10-08T23:59:59Z"));
    expect(await getContainer()).toBe(today);

    vi.setSystemTime(new Date("2026-10-09T00:00:01Z"));
    const tomorrow = await getContainer();
    expect(tomorrow).not.toBe(today);

    const activeStart = async (container: typeof today) => {
      const [project] = await container.repo.projects.list();
      return (await container.repo.sprints.active(project.id, container.clock.now()))?.startAt;
    };
    expect(await activeStart(tomorrow)).not.toBe(await activeStart(today));
  });

  it("does not cache a failed build", async () => {
    let calls = 0;
    vi.doMock("@/adapters/demo", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/adapters/demo")>();
      return {
        ...actual,
        buildDemoDataset: (now: Date) => {
          calls += 1;
          if (calls === 1) throw new Error("dataset exploded");
          return actual.buildDemoDataset(now);
        },
      };
    });
    const { getContainer } = await loadModule({});

    await expect(getContainer()).rejects.toThrow("dataset exploded");
    const recovered = await getContainer();
    expect(recovered.mode).toBe("demo");
    expect(calls).toBe(2);
  });

  it("builds the Supabase repository in live mode and leaves sources unavailable", async () => {
    const container = await loadContainer(LIVE_ENV);

    // The repository is real (no network is touched by constructing it); the
    // REST source adapters are still pending, so live mode never syncs on boot.
    expect(container.repo.constructor.name).toBe("SupabaseRadarRepository");
    await expect(
      container.sources.issueTracker.getIssues({} as never),
    ).rejects.toThrow(/issueTracker\.getIssues/);
  });
});

describe("getAppConfig", () => {
  it("returns mode, model, and URL without building the container", async () => {
    const { getAppConfig } = await loadModule(LIVE_ENV);
    expect(getAppConfig()).toEqual({
      mode: "live",
      model: "claude-opus-5-5",
      appUrl: "https://radar.example.com",
      llmAvailable: true,
    });
  });
});
