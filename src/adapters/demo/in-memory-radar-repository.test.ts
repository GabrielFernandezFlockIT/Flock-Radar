import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  type Evidence,
  type Issue,
  type IssueComment,
  type IssueEvent,
  type MemoryItem,
  type Project,
  type Sprint,
  type Worklog,
} from "@/shared/domain";
import {
  AlertConflictError,
  MAX_MEMORY_SEARCH_RESULTS,
  RepositoryConstraintError,
  type AlertDraft,
} from "@/shared/ports";

import { InMemoryRadarRepository } from "./in-memory-radar-repository";

const PROJECT_ID = "0b6f3f2e-1c1d-5e4a-8b7c-111111111111";
const OTHER_PROJECT_ID = "0b6f3f2e-1c1d-5e4a-8b7c-222222222222";
const SPRINT_ID = "0b6f3f2e-1c1d-5e4a-8b7c-000000000001";

const project: Project = {
  id: PROJECT_ID,
  name: "Beacon",
  jiraKey: "BCN",
  githubRepo: "demo-org/beacon-api",
  clientName: "Globex",
  budgetAmount: 100_000,
  budgetCurrency: "USD",
  hourlyRate: 50,
  startDate: "2026-07-01",
  endDate: "2026-12-31",
  forecastUnit: "points",
  wipLimit: 5,
};

const otherProject: Project = {
  ...project,
  id: OTHER_PROJECT_ID,
  name: "Atlas",
  jiraKey: "ATL",
};

const evidence: Evidence = {
  sourceType: "jira_issue",
  externalId: "BCN-1",
  url: "https://demo.atlassian.net/browse/BCN-1",
  occurredAt: "2026-10-01T10:00:00.000Z",
};

function issue(key: string, overrides: Partial<Issue> = {}): Issue {
  return {
    projectId: PROJECT_ID,
    key,
    title: `Issue ${key}`,
    type: "Story",
    status: "To Do",
    statusCategory: "todo",
    points: 3,
    assignee: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    resolvedAt: null,
    url: `https://demo.atlassian.net/browse/${key}`,
    sprintId: null,
    requiresCode: true,
    ...overrides,
  };
}

function sprint(
  id: string,
  startAt: string,
  endAt: string,
  state: Sprint["state"],
  overrides: Partial<Sprint> = {},
): Sprint {
  return {
    id,
    projectId: PROJECT_ID,
    externalId: id.slice(-4),
    name: `Sprint ${id.slice(-4)}`,
    goal: null,
    startAt,
    endAt,
    state,
    committedPoints: null,
    ...overrides,
  };
}

function event(issueKey: string, externalId: string): IssueEvent {
  return {
    projectId: PROJECT_ID,
    externalId,
    issueKey,
    field: "status",
    from: "To Do",
    to: "In Progress",
    at: "2026-10-02T10:00:00.000Z",
    author: "Ana",
  };
}

function comment(issueKey: string, id: string): IssueComment {
  return {
    projectId: PROJECT_ID,
    issueKey,
    id,
    author: "Ana",
    body: "Looks good.",
    createdAt: "2026-10-02T10:00:00.000Z",
    url: `https://demo.atlassian.net/browse/${issueKey}?focusedCommentId=${id}`,
  };
}

function worklog(issueKey: string, id: string): Worklog {
  return {
    projectId: PROJECT_ID,
    issueKey,
    id,
    author: "Ana",
    seconds: 3600,
    startedAt: "2026-10-02T09:00:00.000Z",
  };
}

function draft(overrides: Partial<AlertDraft> = {}): AlertDraft {
  return {
    teamId: null,
    personId: null,
    severity: "high",
    confidence: 0.8,
    eta: "2026-10-20",
    title: "Sprint goal at risk",
    explanation: null,
    explanationSource: null,
    drivers: [{ key: "scope_added", label: "Scope added", value: 13, unit: "pts" }],
    evidence: [evidence],
    suggestedActions: [],
    detectedAt: "2026-10-08T07:00:00.000Z",
    ...overrides,
  };
}

function embedding(hot: number, value = 1): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === hot ? value : 0,
  );
}

function memoryItem(id: string, summary: string): MemoryItem {
  return {
    id,
    projectId: PROJECT_ID,
    kind: "done",
    summary,
    evidence: [evidence],
    occurredAt: "2026-10-02T10:00:00.000Z",
    status: "resolved",
  };
}

function memoryId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function sequentialIds() {
  let next = 0;
  return () => memoryId((next += 1));
}

async function repoWithProject(
  options: ConstructorParameters<typeof InMemoryRadarRepository>[0] = {},
) {
  const repo = new InMemoryRadarRepository(options);
  await repo.projects.upsert(project);
  await repo.projects.upsert(otherProject);
  return repo;
}

describe("InMemoryRadarRepository", () => {
  it("upserts on natural keys instead of duplicating", async () => {
    const repo = await repoWithProject();
    await repo.issues.upsertMany([issue("BCN-2"), issue("BCN-10")]);
    await repo.issues.upsertMany([
      issue("BCN-2", { status: "In Progress", statusCategory: "in_progress" }),
    ]);

    const issues = await repo.issues.byProject(PROJECT_ID);
    expect(issues.map((item) => [item.key, item.status])).toEqual([
      ["BCN-2", "In Progress"],
      ["BCN-10", "To Do"],
    ]);
  });

  it("returns copies so callers cannot mutate stored data", async () => {
    const repo = await repoWithProject();
    const input = issue("BCN-1");
    await repo.issues.upsertMany([input]);
    input.title = "mutated after write";

    const [read] = await repo.issues.byProject(PROJECT_ID);
    read.title = "mutated after read";

    const [again] = await repo.issues.byProject(PROJECT_ID);
    expect(again.title).toBe("Issue BCN-1");
  });

  it("rejects invalid records and leaves the store untouched", async () => {
    const repo = await repoWithProject();
    await expect(
      repo.issues.upsertMany([issue("BCN-1"), issue("not a key")]),
    ).rejects.toThrow();
    expect(await repo.issues.byProject(PROJECT_ID)).toEqual([]);
  });

  it("does not leak data when serialized", async () => {
    const repo = await repoWithProject();
    expect(JSON.stringify(repo)).not.toContain("Globex");
  });

  describe("Postgres parity", () => {
    async function expectConstraint(promise: Promise<unknown>, constraint: string) {
      const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(RepositoryConstraintError);
      expect((error as RepositoryConstraintError).constraint).toBe(constraint);
    }

    it("rejects duplicate natural keys within one batch, writing nothing", async () => {
      const repo = await repoWithProject();
      await expectConstraint(
        repo.issues.upsertMany([issue("BCN-1"), issue("BCN-1", { title: "again" })]),
        "issues_natural_key",
      );
      expect(await repo.issues.byProject(PROJECT_ID)).toEqual([]);

      await repo.issues.upsertMany([issue("BCN-1")]);
      await expectConstraint(
        repo.issueEvents.upsertMany([event("BCN-1", "e1"), event("BCN-1", "e1")]),
        "issue_events_natural_key",
      );
      await expectConstraint(
        repo.memory.upsertMany([memoryItem(memoryId(1), "a"), memoryItem(memoryId(1), "b")]),
        "memory_items_natural_key",
      );
    });

    it("rejects rows for unknown projects", async () => {
      const repo = new InMemoryRadarRepository();
      await expectConstraint(repo.issues.upsertMany([issue("BCN-1")]), "issues_project_id_fkey");
      await expectConstraint(
        repo.alerts.upsertForKind(PROJECT_ID, "scope_creep", draft()),
        "alerts_project_id_fkey",
      );
      await expectConstraint(
        repo.syncRuns.start({ projectId: PROJECT_ID, source: "jira", startedAt: "2026-10-08T07:00:00.000Z" }),
        "sync_runs_project_id_fkey",
      );
    });

    it("rejects events, comments, and worklogs for unknown issues", async () => {
      const repo = await repoWithProject();
      await repo.issues.upsertMany([issue("BCN-1")]);

      await expectConstraint(
        repo.issueEvents.upsertMany([event("BCN-404", "e1")]),
        "issue_events_project_issue_fkey",
      );
      await expectConstraint(
        repo.issueComments.upsertMany([comment("BCN-404", "c1")]),
        "issue_comments_project_issue_fkey",
      );
      await expectConstraint(
        repo.worklogs.upsertMany([worklog("BCN-404", "w1")]),
        "worklogs_project_issue_fkey",
      );
      // Same key, other project: still an orphan.
      await expectConstraint(
        repo.worklogs.upsertMany([{ ...worklog("BCN-1", "w2"), projectId: OTHER_PROJECT_ID }]),
        "worklogs_project_issue_fkey",
      );
      await repo.issueEvents.upsertMany([event("BCN-1", "e1")]);
      expect(await repo.issueEvents.byProject(PROJECT_ID)).toHaveLength(1);
    });

    it("rejects issues in unknown sprints or sprints of another project", async () => {
      const repo = await repoWithProject();
      await expectConstraint(
        repo.issues.upsertMany([issue("BCN-1", { sprintId: SPRINT_ID })]),
        "issues_project_sprint_fkey",
      );
      await repo.sprints.upsertMany([
        sprint(SPRINT_ID, "2026-10-05T09:00:00.000Z", "2026-10-16T18:00:00.000Z", "active", {
          projectId: OTHER_PROJECT_ID,
        }),
      ]);
      await expectConstraint(
        repo.issues.upsertMany([issue("BCN-1", { sprintId: SPRINT_ID })]),
        "issues_project_sprint_fkey",
      );
    });

    it("never overwrites a sprint id for a known natural key", async () => {
      const repo = await repoWithProject();
      const original = sprint(SPRINT_ID, "2026-10-05T09:00:00.000Z", "2026-10-16T18:00:00.000Z", "active");
      await repo.sprints.upsertMany([original]);

      await expectConstraint(
        repo.sprints.upsertMany([{ ...original, id: "0b6f3f2e-1c1d-5e4a-8b7c-000000000099" }]),
        "sprints_project_external_key",
      );
      await expectConstraint(
        repo.sprints.upsertMany([{ ...original, externalId: "other" }]),
        "sprints_pkey",
      );
      await repo.sprints.upsertMany([{ ...original, name: "Renamed" }]);
      expect((await repo.sprints.byProject(PROJECT_ID)).map((item) => [item.id, item.name])).toEqual([
        [SPRINT_ID, "Renamed"],
      ]);
    });

    it("keeps Jira keys unique across projects", async () => {
      const repo = await repoWithProject();
      await expectConstraint(
        repo.projects.upsert({ ...otherProject, id: "0b6f3f2e-1c1d-5e4a-8b7c-333333333333" }),
        "projects_jira_key_key",
      );
    });
  });

  it("finds the active sprint for a moment in time", async () => {
    const repo = await repoWithProject();
    const closed = sprint("0b6f3f2e-1c1d-5e4a-8b7c-000000000002", "2026-09-21T09:00:00.000Z", "2026-10-02T18:00:00.000Z", "closed");
    const active = sprint("0b6f3f2e-1c1d-5e4a-8b7c-000000000003", "2026-10-05T09:00:00.000Z", "2026-10-16T18:00:00.000Z", "active");
    await repo.sprints.upsertMany([active, closed]);

    expect((await repo.sprints.byProject(PROJECT_ID)).map((item) => item.id)).toEqual([
      closed.id,
      active.id,
    ]);
    expect((await repo.sprints.active(PROJECT_ID, new Date("2026-10-08T12:00:00Z")))?.id).toBe(active.id);
    // Falls back to the sprint whose window contains the moment.
    await repo.sprints.upsertMany([{ ...active, state: "closed" }]);
    expect((await repo.sprints.active(PROJECT_ID, new Date("2026-09-25T12:00:00Z")))?.id).toBe(closed.id);
    expect(await repo.sprints.active(PROJECT_ID, new Date("2027-01-01T00:00:00Z"))).toBeNull();
  });

  describe("alerts", () => {
    it("keeps one active alert per project and kind and tracks detection times", async () => {
      const repo = await repoWithProject({ newId: sequentialIds() });
      const first = await repo.alerts.upsertForKind(PROJECT_ID, "scope_creep", draft());
      const updated = await repo.alerts.upsertForKind(
        PROJECT_ID,
        "scope_creep",
        draft({ severity: "critical", detectedAt: "2026-10-09T07:00:00.000Z" }),
      );

      expect(first).toMatchObject({
        createdAt: "2026-10-08T07:00:00.000Z",
        updatedAt: "2026-10-08T07:00:00.000Z",
        lastDetectedAt: "2026-10-08T07:00:00.000Z",
      });
      expect(updated).toMatchObject({
        id: first.id,
        severity: "critical",
        createdAt: "2026-10-08T07:00:00.000Z",
        updatedAt: "2026-10-09T07:00:00.000Z",
        lastDetectedAt: "2026-10-09T07:00:00.000Z",
      });
      expect(await repo.alerts.byProject(PROJECT_ID)).toHaveLength(1);
    });

    it("updates an acknowledged alert in place and keeps its status", async () => {
      const repo = await repoWithProject({
        newId: sequentialIds(),
        now: () => new Date("2026-10-08T12:00:00.000Z"),
      });
      const alert = await repo.alerts.upsertForKind(PROJECT_ID, "budget_overrun", draft());
      const acknowledged = await repo.alerts.setStatus(alert.id, "ack");
      expect(acknowledged?.updatedAt).toBe("2026-10-08T12:00:00.000Z");

      const again = await repo.alerts.upsertForKind(PROJECT_ID, "budget_overrun", draft({ confidence: 0.9 }));
      expect(again).toMatchObject({ id: alert.id, status: "ack", confidence: 0.9 });
    });

    it("opens a new alert after the previous one is resolved", async () => {
      const repo = await repoWithProject({ newId: sequentialIds() });
      const first = await repo.alerts.upsertForKind(PROJECT_ID, "stale_review", draft());
      await repo.alerts.setStatus(first.id, "resolved");
      const second = await repo.alerts.upsertForKind(PROJECT_ID, "stale_review", draft());

      expect(second.id).not.toBe(first.id);
      expect(await repo.alerts.byProject(PROJECT_ID, "open")).toHaveLength(1);
      expect(await repo.alerts.byProject(PROJECT_ID, "resolved")).toHaveLength(1);
      // Reopening the old one would create two active alerts of the same kind.
      await expect(repo.alerts.setStatus(first.id, "open")).rejects.toBeInstanceOf(
        AlertConflictError,
      );
    });

    it("rejects alerts without evidence", async () => {
      const repo = await repoWithProject();
      await expect(
        repo.alerts.upsertForKind(PROJECT_ID, "wip_over_limit", draft({ evidence: [] })),
      ).rejects.toThrow();
    });

    it("returns null when setting the status of an unknown alert", async () => {
      const repo = await repoWithProject();
      expect(await repo.alerts.setStatus(memoryId(0), "ack")).toBeNull();
    });

    it("derives the same alert and sync-run ids for the same inputs when deterministic", async () => {
      const first = await repoWithProject({ ids: "deterministic" });
      const second = await repoWithProject({ ids: "deterministic" });
      const startedAt = "2026-10-08T07:00:00.000Z";

      const [a1, a2] = await Promise.all([
        first.alerts.upsertForKind(PROJECT_ID, "scope_creep", draft()),
        second.alerts.upsertForKind(PROJECT_ID, "scope_creep", draft({ detectedAt: "2026-10-08T15:00:00.000Z" })),
      ]);
      expect(a1.id).toBe(a2.id);

      const r1 = await first.syncRuns.start({ projectId: PROJECT_ID, source: "jira", startedAt });
      const r2 = await second.syncRuns.start({ projectId: PROJECT_ID, source: "jira", startedAt });
      expect(r1.id).toBe(r2.id);
      // A second run with identical inputs still gets its own id.
      const r3 = await first.syncRuns.start({ projectId: PROJECT_ID, source: "jira", startedAt });
      expect(r3.id).not.toBe(r1.id);
    });
  });

  describe("memory", () => {
    it("ranks embedded items by cosine similarity within the project", async () => {
      const repo = await repoWithProject();
      await repo.memory.upsertMany([
        { ...memoryItem(memoryId(1), "Shipped retries"), embedding: embedding(0) },
        { ...memoryItem(memoryId(2), "Shipped pagination"), embedding: embedding(1) },
        memoryItem(memoryId(3), "Not embedded yet"),
        { ...memoryItem(memoryId(4), "Zero vector"), embedding: embedding(0, 0) },
        {
          ...memoryItem(memoryId(5), "Other project"),
          projectId: OTHER_PROJECT_ID,
          embedding: embedding(0),
        },
      ]);

      const hits = await repo.memory.search(PROJECT_ID, embedding(0), 5);
      expect(hits.map((hit) => [hit.item.summary, hit.similarity])).toEqual([
        ["Shipped retries", 1],
        ["Shipped pagination", 0],
      ]);
      expect(await repo.memory.search(PROJECT_ID, embedding(0), 0)).toEqual([]);
      expect(await repo.memory.search(PROJECT_ID, embedding(0, 0), 5)).toEqual([]);
    });

    it("caps results at the shared maximum", async () => {
      const repo = await repoWithProject();
      await repo.memory.upsertMany(
        Array.from({ length: MAX_MEMORY_SEARCH_RESULTS + 5 }, (_, index) => ({
          ...memoryItem(memoryId(index + 1), `Item ${index}`),
          embedding: embedding(index % 7, 1),
        })),
      );
      expect(await repo.memory.search(PROJECT_ID, embedding(0), 500)).toHaveLength(
        MAX_MEMORY_SEARCH_RESULTS,
      );
    });

    it("keeps the embedding when only metadata changes and clears it when the summary changes", async () => {
      const repo = await repoWithProject();
      const id = memoryId(1);
      await repo.memory.upsertMany([{ ...memoryItem(id, "v1"), embedding: embedding(3) }]);

      await repo.memory.upsertMany([{ ...memoryItem(id, "v1"), status: "open" }]);
      expect(await repo.memory.search(PROJECT_ID, embedding(3), 1)).toHaveLength(1);

      await repo.memory.upsertMany([memoryItem(id, "v2")]);
      expect(await repo.memory.search(PROJECT_ID, embedding(3), 1)).toEqual([]);

      await repo.memory.upsertMany([{ ...memoryItem(id, "v2"), embedding: embedding(3) }]);
      const [hit] = await repo.memory.search(PROJECT_ID, embedding(3), 1);
      expect(hit.item.summary).toBe("v2");
    });

    it("rejects embeddings with the wrong dimensions", async () => {
      const repo = await repoWithProject();
      await expect(
        repo.memory.upsertMany([{ ...memoryItem(memoryId(1), "x"), embedding: [1, 0] }]),
      ).rejects.toThrow(/1024/);
      await expect(repo.memory.search(PROJECT_ID, [1, 0], 3)).rejects.toThrow(/1024/);
    });
  });

  it("tracks sync runs per project and returns the latest per source", async () => {
    const repo = await repoWithProject({ newId: sequentialIds() });
    const start = (projectId: string, source: "jira" | "github", startedAt: string) =>
      repo.syncRuns.start({ projectId, source, startedAt });

    const old = await start(PROJECT_ID, "jira", "2026-10-07T07:00:00.000Z");
    await repo.syncRuns.finish(old.id, { finishedAt: "2026-10-07T07:01:00.000Z", status: "ok", stats: { issues: 10 }, error: null });
    const latest = await start(PROJECT_ID, "jira", "2026-10-08T07:00:00.000Z");
    const github = await start(PROJECT_ID, "github", "2026-10-08T07:00:00.000Z");
    await repo.syncRuns.finish(github.id, { finishedAt: "2026-10-08T07:02:00.000Z", status: "failed", stats: {}, error: "github: HTTP 503 unavailable" });
    await start(OTHER_PROJECT_ID, "jira", "2026-10-09T07:00:00.000Z");

    const runs = await repo.syncRuns.latestBySource(PROJECT_ID);
    expect(runs.map((run) => [run.source, run.id, run.status])).toEqual([
      ["jira", latest.id, "running"],
      ["github", github.id, "failed"],
    ]);
    await expect(
      repo.syncRuns.finish(memoryId(999), { finishedAt: "2026-10-08T07:00:00.000Z", status: "ok", stats: {}, error: null }),
    ).rejects.toThrow(/Unknown sync run/);
  });

  it("returns the latest forecast of a kind", async () => {
    const repo = await repoWithProject();
    await repo.forecasts.insert({ projectId: PROJECT_ID, kind: "sprint_completion", computedAt: "2026-10-07T07:00:00.000Z", inputs: {}, result: { p: 0.5 } });
    await repo.forecasts.insert({ projectId: PROJECT_ID, kind: "sprint_completion", computedAt: "2026-10-08T07:00:00.000Z", inputs: {}, result: { p: 0.38 } });
    await repo.forecasts.insert({ projectId: PROJECT_ID, kind: "budget_burn", computedAt: "2026-10-09T07:00:00.000Z", inputs: {}, result: {} });

    expect((await repo.forecasts.latest(PROJECT_ID, "sprint_completion"))?.result).toEqual({ p: 0.38 });
    expect(await repo.forecasts.latest(OTHER_PROJECT_ID, "sprint_completion")).toBeNull();
  });

  it("sums LLM usage", async () => {
    const repo = await repoWithProject();
    const call = {
      purpose: "alert_explanation",
      model: "claude-opus-5-5",
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 800,
      latencyMs: 1_500,
      stopReason: "end_turn",
      costUsd: 0.0125,
      createdAt: "2026-10-08T07:00:00.000Z",
    };
    await repo.llmCalls.insert(call);
    await repo.llmCalls.insert({ ...call, costUsd: 0.0075 });

    expect(await repo.llmCalls.totals()).toEqual({
      calls: 2,
      inputTokens: 2_000,
      outputTokens: 400,
      cacheReadTokens: 1_600,
      costUsd: 0.02,
    });
  });

  it("stores reports newest first and rejects oversized markdown", async () => {
    const repo = await repoWithProject();
    const base = {
      projectId: PROJECT_ID,
      kind: "progress" as const,
      periodStart: "2026-10-01",
      periodEnd: "2026-10-07",
      content: { sections: [] },
      markdown: "# Progress",
      createdBy: null,
    };
    const older = await repo.reports.insert({ ...base, createdAt: "2026-10-07T10:00:00.000Z" });
    const newer = await repo.reports.insert({ ...base, createdAt: "2026-10-08T10:00:00.000Z" });

    expect((await repo.reports.byProject(PROJECT_ID)).map((report) => report.id)).toEqual([newer.id, older.id]);
    expect(await repo.reports.get(older.id)).toEqual(older);
    await expect(
      repo.reports.insert({ ...base, markdown: "x".repeat(200_001), createdAt: "2026-10-09T10:00:00.000Z" }),
    ).rejects.toThrow(/200000 bytes/);
  });
});
