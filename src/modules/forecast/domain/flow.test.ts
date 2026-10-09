import { describe, expect, it } from "vitest";

import { DetectorResultSchema } from "@/shared/domain";
import {
  commit,
  doneIssue,
  event,
  issue,
  project,
  pullRequest,
  snapshot,
  sprint,
} from "@test/helpers/forecast-fixtures";

import {
  detectReopenRate,
  detectStaleReviews,
  detectStalledIssues,
  detectWipOverLimit,
  reopenSeverity,
  staleReviewTitle,
  stalledSeverity,
  stalledTitle,
  wipSeverity,
  wipTitle,
} from "./flow";
import { DEFAULT_FORECAST_OPTIONS as DEFAULT, isInconclusive } from "./snapshot";

// NOW is Thursday 2026-10-08 12:00 UTC.
const active = sprint("2026-10-05", "2026-10-16", "active");
const inProgress = (key: string, overrides = {}) =>
  issue({ key, sprintId: active.id, status: "In Progress", statusCategory: "in_progress", ...overrides });

describe("detectWipOverLimit", () => {
  it("fires above the limit with every in-progress issue as evidence", () => {
    const issues = ["TST-1", "TST-2", "TST-3", "TST-4", "TST-5"].map((key) => inProgress(key));
    const result = detectWipOverLimit(snapshot({ activeSprint: active, issues }));
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("high"); // 5 >= 1.5 x 3
    expect(result.eta).toBe("2026-10-08");
    expect(result.evidence).toHaveLength(5);
    expect(result.drivers.map((driver) => [driver.key, driver.value])).toEqual([
      ["wip", 5],
      ["wip_limit", 3],
      ["wip_over", 2],
    ]);
    expect(() => DetectorResultSchema.parse(result)).not.toThrow();
    expect(wipTitle(5, 3)).toBe("WIP sobre el límite: 5 incidencias en curso (límite 3)");
  });

  it("stays quiet at the limit and ignores other sprints", () => {
    const issues = [inProgress("TST-1"), inProgress("TST-2"), inProgress("TST-3"), inProgress("TST-4", { sprintId: null })];
    expect(detectWipOverLimit(snapshot({ activeSprint: active, issues })).triggered).toBe(false);
  });

  it("is inconclusive without an active sprint", () => {
    expect(isInconclusive(detectWipOverLimit(snapshot()))).toBe(true);
  });

  it("maps the overflow to severity", () => {
    expect(wipSeverity(10, 5)).toBe("critical");
    expect(wipSeverity(8, 5)).toBe("high");
    expect(wipSeverity(6, 5)).toBe("medium");
    expect(wipSeverity(5, 5)).toBe("low");
  });
});

describe("detectStaleReviews", () => {
  const linked = inProgress("TST-7", { status: "In Review" });

  it("fires for open PRs without a first review after 48 hours", () => {
    const prs = [
      pullRequest({ number: 1, createdAt: "2026-10-05T20:00:00.000Z", linkedIssueKeys: ["TST-7"] }), // 64 h
      pullRequest({ number: 2, createdAt: "2026-10-07T12:00:00.000Z" }), // 24 h
      pullRequest({ number: 3, createdAt: "2026-10-01T12:00:00.000Z", firstReviewAt: "2026-10-02T12:00:00.000Z" }),
      pullRequest({ number: 4, createdAt: "2026-10-01T12:00:00.000Z", state: "merged", mergedAt: "2026-10-02T12:00:00.000Z" }),
    ];
    const result = detectStaleReviews(snapshot({ issues: [linked], pullRequests: prs }));
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("medium");
    expect(result.stale).toEqual([{ number: 1, hours: 64 }]);
    expect(result.evidence.map((item) => [item.sourceType, item.externalId])).toEqual([
      ["github_pr", "#1"],
      ["jira_issue", "TST-7"],
    ]);
    expect(staleReviewTitle(result.stale, 48)).toBe(
      "La PR #1 lleva 64 h esperando una primera revisión",
    );
  });

  it("is high with a very old PR, and quiet without stale PRs", () => {
    const old = detectStaleReviews(
      snapshot({ pullRequests: [pullRequest({ number: 9, createdAt: "2026-10-01T12:00:00.000Z" })] }),
    );
    expect(old.severity).toBe("high");
    expect(detectStaleReviews(snapshot()).triggered).toBe(false);
    expect(staleReviewTitle([{ number: 1, hours: 50 }, { number: 2, hours: 49 }], 48)).toBe(
      "2 PRs llevan más de 48 h esperando una primera revisión",
    );
  });

  it("respects a configured threshold", () => {
    const prs = [pullRequest({ number: 1, createdAt: "2026-10-07T12:00:00.000Z" })];
    const options = { ...DEFAULT, staleReviewHours: 12 };
    expect(detectStaleReviews(snapshot({ pullRequests: prs }), options).triggered).toBe(true);
  });
});

describe("detectStalledIssues", () => {
  it("counts full working days since the last linked commit (weekends excluded)", () => {
    // Last commit Wed 2026-09-30: full working days Thu 1, Fri 2, Mon 5, Tue 6, Wed 7 = 5.
    const stalledIssue = inProgress("TST-10");
    const fresh = inProgress("TST-11");
    const result = detectStalledIssues(
      snapshot({
        issues: [stalledIssue, fresh],
        commits: [
          commit("aaa", "2026-09-29T10:00:00.000Z", ["TST-10"]),
          commit("bbb", "2026-09-30T10:00:00.000Z", ["TST-10"]),
          commit("ccc", "2026-10-07T10:00:00.000Z", ["TST-11"]),
        ],
      }),
    );
    expect(result.triggered).toBe(true);
    expect(result.stalled.map((item) => [item.key, item.idleWorkingDays])).toEqual([["TST-10", 5]]);
    expect(result.severity).toBe("medium");
    expect(result.evidence.map((item) => [item.sourceType, item.externalId])).toEqual([
      ["jira_issue", "TST-10"],
      ["github_commit", "bbb0000"],
    ]);
    expect(stalledTitle(result.stalled, 5)).toBe(
      "TST-10 detenida: sin commits desde hace 5 días hábiles",
    );
  });

  it("does not flag four idle working days", () => {
    const result = detectStalledIssues(
      snapshot({ issues: [inProgress("TST-10")], commits: [commit("aaa", "2026-10-01T10:00:00.000Z", ["TST-10"])] }),
    );
    expect(result.triggered).toBe(false);
  });

  it("measures from work start when an issue has no commits, and skips non-code work", () => {
    const noCommits = inProgress("TST-12");
    const docs = inProgress("TST-13", { requiresCode: false });
    const result = detectStalledIssues(
      snapshot({
        issues: [noCommits, docs],
        issueEvents: [
          event("TST-12", "status", "To Do", "In Progress", "2026-09-21T10:00:00.000Z"),
          event("TST-13", "status", "To Do", "In Progress", "2026-09-21T10:00:00.000Z"),
        ],
      }),
    );
    expect(result.stalled.map((item) => [item.key, item.idleWorkingDays, item.lastCommit])).toEqual([["TST-12", 12, null]]);
    expect(result.severity).toBe("high");
    expect(result.evidence).toHaveLength(1);
  });

  it("maps idleness to severity", () => {
    expect(stalledSeverity(10, 5)).toBe("high");
    expect(stalledSeverity(6, 5)).toBe("medium");
    expect(stalledSeverity(0, 5)).toBe("low");
  });
});

describe("detectReopenRate", () => {
  function resolutions(count: number, reopened: number) {
    const issues = Array.from({ length: count }, (_, index) => doneIssue("2026-10-01T10:00:00.000Z", { key: `TST-${100 + index}` }));
    const events = issues.flatMap((item, index) => [
      event(item.key, "resolution", null, "Done", "2026-10-01T10:00:00.000Z"),
      ...(index < reopened ? [event(item.key, "resolution", "Done", null, "2026-10-02T10:00:00.000Z")] : []),
    ]);
    return snapshot({ project: project(), issues, issueEvents: events });
  }

  it("fires above the threshold with the reopen transitions as evidence", () => {
    const result = detectReopenRate(resolutions(10, 3));
    expect(result.triggered).toBe(true);
    expect(result.rate).toBeCloseTo(0.3);
    expect(result.severity).toBe("high");
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence[0]).toMatchObject({ sourceType: "jira_transition", label: "Reabierta (estaba en Done)" });
  });

  it("stays quiet without reopens", () => {
    const result = detectReopenRate(resolutions(10, 0));
    expect(result.triggered).toBe(false);
    expect(isInconclusive(result)).toBe(false);
  });

  it("is inconclusive with too few resolutions, and ignores old events", () => {
    expect(isInconclusive(detectReopenRate(resolutions(3, 3)))).toBe(true);
    const old = resolutions(10, 5);
    const shifted = { ...old, now: new Date("2026-12-01T12:00:00.000Z") };
    expect(isInconclusive(detectReopenRate(shifted))).toBe(true);
  });

  it("maps the rate to severity", () => {
    expect(reopenSeverity(0.3, 0.15)).toBe("high");
    expect(reopenSeverity(0.2, 0.15)).toBe("medium");
    expect(reopenSeverity(0.1, 0.15)).toBe("low");
  });
});
