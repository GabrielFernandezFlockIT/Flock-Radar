import { describe, expect, it } from "vitest";

import type {
  BudgetRunwayForecast,
  SprintCompletionForecast,
} from "@/modules/forecast/domain";
import { FORECAST_KINDS, runForecasts } from "@/modules/forecast/application/run-forecasts";
import { syncProjects } from "@/modules/ingestion/application/sync-projects";
import { EvidenceListSchema, toIsoDate, type AlertKind, type Project } from "@/shared/domain";
import type { Clock } from "@/shared/ports";

import { createDemoSources } from "./demo-sources";
import { InMemoryRadarRepository } from "./in-memory-radar-repository";
import { buildDemoDataset } from "./scenario/dataset";
import { DEMO_SCENARIO_EXPECTATIONS as EXPECT } from "./scenario/expectations";

/**
 * Integration and calibration: demo sources -> sync -> forecast engine ->
 * in-memory repository. Lives with the adapters because application tests may
 * not import adapters. The engine IS the reference model of `expectations.ts`
 * (decision D-037), so these numbers are its calibration contract.
 */

const WEEKDAYS = Array.from({ length: 5 }, (_, index) => new Date(Date.UTC(2026, 9, 5 + index, 12)));
const WEEKEND = [new Date(Date.UTC(2026, 9, 10, 12)), new Date(Date.UTC(2026, 9, 11, 12))];

const EXPECTED_KINDS: Record<string, AlertKind[]> = {
  ATL: [],
  BCN: ["scope_creep", "sprint_goal_risk", "stale_review", "stalled_issue", "wip_over_limit"],
  CBL: ["budget_overrun"],
};

async function boot(now: Date) {
  const clock: Clock = { now: () => now };
  const dataset = buildDemoDataset(now);
  const repo = new InMemoryRadarRepository({ ids: "deterministic", now: () => now });
  for (const project of dataset.projects) await repo.projects.upsert(project);
  await syncProjects({ repo, clock, ...createDemoSources(dataset) });
  const summary = await runForecasts({ repo, clock });
  const projects = await repo.projects.list();
  const byKey = (jiraKey: string) => projects.find((project) => project.jiraKey === jiraKey) as Project;
  const sprintOf = async (jiraKey: string) =>
    (await repo.forecasts.latest(byKey(jiraKey).id, FORECAST_KINDS.sprintCompletion))
      ?.result as SprintCompletionForecast;
  const budgetOf = async (jiraKey: string) =>
    (await repo.forecasts.latest(byKey(jiraKey).id, FORECAST_KINDS.budgetRunway))
      ?.result as BudgetRunwayForecast;
  return { repo, clock, dataset, summary, byKey, sprintOf, budgetOf };
}

describe.each(WEEKDAYS.map((date) => [toIsoDate(date), date] as const))(
  "forecast calibration on weekday %s",
  (_label, now) => {
    it("matches the scripted sprint, budget, and flow signals", async () => {
      const { repo, summary, byKey, sprintOf, budgetOf } = await boot(now);
      expect(summary.projects.every((project) => project.error === null)).toBe(true);

      const beacon = await sprintOf("BCN");
      expect(beacon.probability).toBeGreaterThanOrEqual(EXPECT.beacon.targetSprintProbability - 0.03);
      expect(beacon.probability).toBeLessThanOrEqual(EXPECT.beacon.targetSprintProbability + 0.03);
      expect(beacon).toMatchObject({
        committed: EXPECT.beacon.committedPointsAtStart,
        scope: EXPECT.beacon.currentScopePoints,
        done: EXPECT.beacon.donePoints,
        remaining: EXPECT.beacon.remainingPoints,
        remainingWorkingDays: EXPECT.sprint.remainingWorkingDays,
      });
      expect(beacon.burnUp).toHaveLength(EXPECT.sprint.workingDays);

      const atlas = await sprintOf("ATL");
      expect(atlas.probability).toBeGreaterThanOrEqual(EXPECT.atlas.minSprintProbability);
      expect(Math.abs((atlas.probability ?? 0) - 0.76)).toBeLessThanOrEqual(0.03);
      expect(atlas.remaining).toBe(EXPECT.atlas.remainingPoints);

      const cobaltSprint = await sprintOf("CBL");
      expect(cobaltSprint.unit).toBe("issues");
      expect(cobaltSprint.probability).toBeGreaterThanOrEqual(EXPECT.cobalt.minSprintProbability);

      const cobalt = await budgetOf("CBL");
      expect(Math.abs((cobalt.daysBeforeEnd ?? 0) - EXPECT.cobalt.exhaustionDaysBeforeEnd)).toBeLessThanOrEqual(1);
      expect((await budgetOf("ATL")).exhaustionDate! > byKey("ATL").endDate).toBe(true);
      expect((await budgetOf("BCN")).exhaustionDate! > byKey("BCN").endDate).toBe(true);

      for (const [jiraKey, kinds] of Object.entries(EXPECTED_KINDS)) {
        const alerts = await repo.alerts.byProject(byKey(jiraKey).id);
        expect(alerts.map((alert) => alert.kind).sort(), jiraKey).toEqual(kinds);
        for (const alert of alerts) {
          expect(() => EvidenceListSchema.parse(alert.evidence)).not.toThrow();
          expect(alert).toMatchObject({ status: "open", explanation: null, explanationSource: null });
        }
      }

      const beaconAlerts = await repo.alerts.byProject(byKey("BCN").id);
      const alert = (kind: AlertKind) => beaconAlerts.find((item) => item.kind === kind)!;
      const driver = (kind: AlertKind, key: string) =>
        alert(kind).drivers.find((item) => item.key === key)?.value;

      expect(alert("sprint_goal_risk").severity).toBe("high");
      expect(driver("sprint_goal_risk", "probability")).toBe(Math.round((beacon.probability ?? 0) * 100));
      expect(driver("sprint_goal_risk", "remaining_work")).toBe(EXPECT.beacon.remainingPoints);
      expect(driver("sprint_goal_risk", "pto_person_days")).toBe(
        EXPECT.beacon.ptoPeople * EXPECT.beacon.ptoDaysPerPerson,
      );
      expect(alert("sprint_goal_risk").title).toMatch(/^Objetivo del sprint en riesgo: 3[5-9]% de probabilidad de terminar para el \d{1,2} [a-z]{3}$/);

      expect(driver("scope_creep", "scope_added")).toBe(EXPECT.beacon.scopeAddedPoints);
      expect(driver("scope_creep", "committed_scope")).toBe(EXPECT.beacon.committedPointsAtStart);
      expect(alert("scope_creep").evidence.map((item) => item.externalId.split("#")[0])).toEqual(
        expect.arrayContaining([
          ...Object.keys(EXPECT.beacon.scopeAddedIssues),
          ...Object.keys(EXPECT.beacon.scopeReestimates),
        ]),
      );

      expect(driver("wip_over_limit", "wip")).toBe(EXPECT.beacon.inProgress);
      expect(alert("stale_review").evidence.map((item) => item.externalId)).toContain(
        EXPECT.beacon.staleReviewIssueKey,
      );
      expect(driver("stale_review", "longest_wait_hours")).toBeGreaterThanOrEqual(EXPECT.beacon.staleReviewMinHours);
      expect(alert("stalled_issue").evidence[0].externalId).toBe(EXPECT.beacon.stalledIssueKey);
      expect(driver("stalled_issue", "max_idle_working_days")).toBeGreaterThanOrEqual(
        EXPECT.beacon.stalledMinWorkingDaysWithoutCommits,
      );

      const budgetAlert = (await repo.alerts.byProject(byKey("CBL").id))[0];
      expect(budgetAlert.eta).toBe(cobalt.exhaustionDate);
      expect(budgetAlert.evidence.every((item) => item.sourceType === "jira_worklog")).toBe(true);
      expect(budgetAlert.drivers.find((item) => item.key === "exhaustion_days_before_end")?.value).toBe(
        cobalt.daysBeforeEnd,
      );

      // Atlas is healthy; reopens are not scripted, so the reopen signal is conclusive and quiet.
      const atlasSummary = summary.projects.find((project) => project.projectId === byKey("ATL").id)!;
      expect(atlasSummary.inconclusive).not.toContain("reopen_rate");
      expect(atlasSummary.triggered).toEqual([]);
    });
  },
);

describe.each(WEEKEND.map((date) => [toIsoDate(date), date] as const))(
  "forecast calibration on weekend %s",
  (_label, now) => {
    it("keeps the story (Cobalt 12-14 days early, Beacon at risk)", async () => {
      const { sprintOf, budgetOf } = await boot(now);
      const days = (await budgetOf("CBL")).daysBeforeEnd ?? 0;
      expect(days).toBeGreaterThanOrEqual(12);
      expect(days).toBeLessThanOrEqual(14);
      expect(Math.abs(((await sprintOf("BCN")).probability ?? 0) - 0.38)).toBeLessThanOrEqual(0.03);
    });
  },
);

describe("runForecasts pipeline", () => {
  const NOW = new Date("2026-10-08T07:00:00Z");

  it("is idempotent when rerun on the same day", async () => {
    const { repo, clock, byKey } = await boot(NOW);
    const before = await repo.alerts.byProject(byKey("BCN").id);
    const second = await runForecasts({ repo, clock });

    expect(second.projects.every((project) => project.forecastsStored.length === 0)).toBe(true);
    expect(second.projects.every((project) => project.resolved.length === 0)).toBe(true);
    const after = await repo.alerts.byProject(byKey("BCN").id);
    expect(after.map((alert) => [alert.id, alert.kind, alert.status, alert.title])).toEqual(
      before.map((alert) => [alert.id, alert.kind, alert.status, alert.title]),
    );
  });

  it("keeps an acknowledged alert active and updates it in place", async () => {
    const { repo, clock, byKey } = await boot(NOW);
    const [wip] = (await repo.alerts.byProject(byKey("BCN").id)).filter((alert) => alert.kind === "wip_over_limit");
    await repo.alerts.setStatus(wip.id, "ack");
    await runForecasts({ repo, clock });
    const again = (await repo.alerts.byProject(byKey("BCN").id)).filter((alert) => alert.kind === "wip_over_limit");
    expect(again.map((alert) => [alert.id, alert.status])).toEqual([[wip.id, "ack"]]);
  });

  it("resolves an alert once its condition clears, and reopens a new one if it returns", async () => {
    const { repo, clock, byKey, dataset } = await boot(NOW);
    const beacon = byKey("BCN");
    const stalePr = dataset.pullRequests.find(
      (pr) => pr.projectId === beacon.id && pr.linkedIssueKeys.includes(EXPECT.beacon.staleReviewIssueKey),
    )!;

    await repo.pullRequests.upsertMany([{ ...stalePr, firstReviewAt: "2026-10-08T06:00:00.000Z" }]);
    const cleared = await runForecasts({ repo, clock });
    expect(cleared.projects.find((project) => project.projectId === beacon.id)?.resolved).toEqual(["stale_review"]);
    const stale = (await repo.alerts.byProject(beacon.id)).filter((alert) => alert.kind === "stale_review");
    expect(stale.map((alert) => alert.status)).toEqual(["resolved"]);

    await repo.pullRequests.upsertMany([stalePr]);
    await runForecasts({ repo, clock });
    const statuses = (await repo.alerts.byProject(beacon.id))
      .filter((alert) => alert.kind === "stale_review")
      .map((alert) => alert.status);
    // Both were detected at the same instant, so `byProject`'s secondary sort
    // (the id) decides the order: assert the set, not an id-dependent order.
    expect([...statuses].sort()).toEqual(["open", "resolved"]);
  });

  it("leaves an alert open when its detector fires without evidence", async () => {
    const { repo, clock, byKey } = await boot(NOW);
    const cobalt = byKey("CBL");
    const [budget] = (await repo.alerts.byProject(cobalt.id)).filter(
      (alert) => alert.kind === "budget_overrun",
    );
    expect(budget.status).toBe("open");

    // The issues the worklogs hang off disappear from the read model (filtered,
    // moved, or a partial sync). The burn still says the budget runs out early,
    // but nothing can be cited: unproven, not cleared.
    const blind = {
      ...repo,
      issues: {
        ...repo.issues,
        byProject: async (projectId: string) =>
          projectId === cobalt.id ? [] : repo.issues.byProject(projectId),
      },
    };
    const result = await runForecasts({ repo: blind, clock });
    const summary = result.projects.find((project) => project.projectId === cobalt.id)!;

    expect(summary.resolved).not.toContain("budget_overrun");
    expect(summary.triggered).not.toContain("budget_overrun");
    expect(summary.inconclusive).toContain("budget_overrun");
    const after = (await repo.alerts.byProject(cobalt.id)).filter(
      (alert) => alert.kind === "budget_overrun",
    );
    expect(after.map((alert) => [alert.id, alert.status])).toEqual([[budget.id, "open"]]);
  });

  it("stores forecasts with chart series and seeded inputs", async () => {
    const { repo, byKey } = await boot(NOW);
    const sprint = await repo.forecasts.latest(byKey("BCN").id, FORECAST_KINDS.sprintCompletion);
    const budget = await repo.forecasts.latest(byKey("CBL").id, FORECAST_KINDS.budgetRunway);
    expect(sprint?.inputs).toMatchObject({ runs: 10_000, seed: `${byKey("BCN").id}:2026-10-08`, unit: "points" });
    const result = sprint?.result as SprintCompletionForecast & { detector: { kind: string } };
    expect(result.detector.kind).toBe("sprint_goal_risk");
    expect(result.burnUp.filter((point) => point.p50 !== null).length).toBeGreaterThan(0);
    expect((budget?.result as BudgetRunwayForecast).series.length).toBeGreaterThan(0);
  });

  it("reports a failing project without stopping the others", async () => {
    const { repo, clock, byKey } = await boot(NOW);
    const failing = {
      ...repo,
      worklogs: {
        ...repo.worklogs,
        byProject: async (projectId: string) => {
          if (projectId === byKey("ATL").id) throw new Error("db timeout https://secret.example");
          return repo.worklogs.byProject(projectId);
        },
      },
    };
    const result = await runForecasts({ repo: failing, clock });
    const errors = result.projects.map((project) => project.error);
    expect(errors.filter((error) => error !== null)).toEqual(["forecast failed: Error"]);
  });
});
