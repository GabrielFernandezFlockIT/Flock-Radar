import { describe, expect, it } from "vitest";

import { DetectorResultSchema, workingDaysOfRange } from "@/shared/domain";
import {
  NOW,
  capacity,
  doneIssue,
  event,
  issue,
  project,
  snapshot,
  sprint,
} from "@test/helpers/forecast-fixtures";

import { detectScopeCreep } from "./scope-creep";
import { DEFAULT_FORECAST_OPTIONS, isInconclusive, type ProjectSnapshot } from "./snapshot";
import {
  forecastSprintCompletion,
  sprintConfidence,
  sprintRiskTitle,
  sprintSeverity,
} from "./sprint-completion";

const OPTIONS = { ...DEFAULT_FORECAST_OPTIONS, runs: 2_000 };

/** Two closed sprints with `perDay` points done every working day. */
function history(perDay: number) {
  const closed = [
    sprint("2026-09-07", "2026-09-18", "closed"),
    sprint("2026-09-21", "2026-10-02", "closed"),
  ];
  const done = closed.flatMap((item) =>
    workingDaysOfRange({ start: item.startAt.slice(0, 10), end: item.endAt.slice(0, 10) }).map(
      (day) => doneIssue(`${day}T15:00:00.000Z`, { points: perDay, sprintId: item.id }),
    ),
  );
  return { closed, done };
}

/** Active sprint Mon 2026-10-05 .. Fri 2026-10-16; today (Thu) is day 4. */
function scenario(options: {
  perDay?: number;
  remainingPoints?: number;
  donePoints?: number;
  extra?: Partial<ProjectSnapshot>;
} = {}): ProjectSnapshot {
  const { closed, done } = history(options.perDay ?? 2);
  const active = sprint("2026-10-05", "2026-10-16", "active");
  const planning = "2026-10-05T08:45:00.000Z";
  const open = issue({ key: "TST-900", sprintId: active.id, points: options.remainingPoints ?? 10, status: "In Progress", statusCategory: "in_progress" });
  const finished = doneIssue("2026-10-06T15:00:00.000Z", { key: "TST-901", sprintId: active.id, points: options.donePoints ?? 4 });
  return snapshot({
    sprints: [...closed, active],
    activeSprint: active,
    issues: [...done, open, finished],
    issueEvents: [
      event("TST-900", "sprint", null, active.id, planning),
      event("TST-901", "sprint", null, active.id, planning),
    ],
    ...options.extra,
  });
}

describe("forecastSprintCompletion", () => {
  it("forecasts with constant throughput and builds the burn-up", () => {
    // 2 pts/day, 7 remaining days (Thu..Fri next week), 10 pts left -> done on day 5.
    const outcome = forecastSprintCompletion(scenario(), OPTIONS);
    const { forecast, result } = outcome;
    expect(forecast.remaining).toBe(10);
    expect(forecast.remainingWorkingDays).toBe(7);
    expect(forecast.probability).toBe(1);
    expect(forecast.p50Date).toBe("2026-10-14");
    expect(forecast.p85Date).toBe("2026-10-14");
    expect(forecast.expectedCompletionDate).toBe("2026-10-14");
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe("low");
    expect(() => DetectorResultSchema.parse(result)).not.toThrow();

    expect(forecast.burnUp).toHaveLength(10);
    expect(forecast.burnUp[0]).toEqual({ date: "2026-10-05", scope: 14, done: 0, p50: null, p85: null });
    expect(forecast.burnUp[1].done).toBe(4);
    expect(forecast.burnUp[2]).toMatchObject({ date: "2026-10-07", done: 4, p50: 4, p85: 4 });
    expect(forecast.burnUp[3]).toMatchObject({ date: "2026-10-08", done: null, p50: 6, p85: 6 });
    expect(forecast.burnUp[9]).toMatchObject({ date: "2026-10-16", p50: 18 });
  });

  it("is deterministic for the same snapshot (seeded by project and day)", () => {
    const input = scenario({ perDay: 1, remainingPoints: 7 });
    const first = forecastSprintCompletion(input, OPTIONS);
    const second = forecastSprintCompletion(structuredClone(input), OPTIONS);
    expect(second).toEqual(first);
    expect(first.inputs.seed).toBe(`${project().id}:2026-10-08`);
  });

  it("triggers below 50% with drivers carrying the exact numbers", () => {
    const outcome = forecastSprintCompletion(scenario({ perDay: 1, remainingPoints: 20 }), OPTIONS);
    expect(outcome.forecast.probability).toBe(0);
    expect(outcome.result.triggered).toBe(true);
    expect(outcome.result.severity).toBe("critical");
    expect(outcome.result.eta).toBe("2026-10-16");
    const drivers = Object.fromEntries(outcome.result.drivers.map((driver) => [driver.key, driver]));
    expect(drivers.probability).toMatchObject({ value: 0, unit: "%" });
    expect(drivers.remaining_work).toMatchObject({ value: 20, unit: "pts" });
    expect(drivers.remaining_working_days.value).toBe(7);
    expect(drivers.historical_daily_throughput.value).toBe(1);
    expect(outcome.result.evidence.map((item) => item.externalId)).toEqual([outcome.forecast.sprint?.name, "TST-900"]);
    expect(sprintRiskTitle(outcome.forecast)).toBe(
      "Objetivo del sprint en riesgo: 0% de probabilidad de terminar para el 16 oct",
    );
  });

  it("returns P = 1 when nothing remains", () => {
    const outcome = forecastSprintCompletion(scenario({ remainingPoints: 0 }), OPTIONS);
    expect(outcome.forecast.probability).toBe(1);
    expect(outcome.forecast.p50Date).toBe("2026-10-08");
  });

  it("returns P = 0 when the sprint has no days left", () => {
    const outcome = forecastSprintCompletion(
      scenario({ extra: { now: new Date("2026-10-17T10:00:00.000Z") } }),
      OPTIONS,
    );
    expect(outcome.forecast.remainingWorkingDays).toBe(0);
    expect(outcome.forecast.probability).toBe(0);
    expect(outcome.result.triggered).toBe(true);
    expect(outcome.forecast.p50Date).toBe("2026-10-23"); // 5 working days from Mon 19th
  });

  it("is inconclusive without enough history", () => {
    const base = scenario();
    const outcome = forecastSprintCompletion(
      { ...base, sprints: base.sprints.filter((item) => item.state !== "closed") },
      OPTIONS,
    );
    expect(outcome.result.triggered).toBe(false);
    expect(outcome.result.confidence).toBeLessThanOrEqual(0.1);
    expect(isInconclusive(outcome.result)).toBe(true);
    expect(outcome.forecast.probability).toBeNull();
  });

  it("is inconclusive when history has no completed work", () => {
    const outcome = forecastSprintCompletion(scenario({ perDay: 0 }), OPTIONS);
    expect(isInconclusive(outcome.result)).toBe(true);
    expect(outcome.result.triggered).toBe(false);
  });

  it("is inconclusive when the sprint is not active", () => {
    const base = scenario();
    const closed = { ...base.activeSprint!, state: "closed" as const };
    expect(isInconclusive(forecastSprintCompletion({ ...base, activeSprint: closed }, OPTIONS).result)).toBe(true);
    expect(isInconclusive(forecastSprintCompletion({ ...base, activeSprint: null }, OPTIONS).result)).toBe(true);
  });

  it("falls back to issue count when estimates are missing", () => {
    const base = scenario();
    const outcome = forecastSprintCompletion(
      { ...base, issues: base.issues.map((item) => (item.key === "TST-900" ? { ...item, points: null } : item)) },
      OPTIONS,
    );
    expect(outcome.forecast.unit).toBe("issues");
    expect(outcome.forecast.unitFallback).toBe(true);
    expect(outcome.forecast.remaining).toBe(1);
    expect(outcome.result.drivers.find((driver) => driver.key === "unit_fallback")?.value).toBe(1);
  });

  it("scales throughput by capacity: PTO lowers P, zero-capacity days add nothing", () => {
    const team = ["Ana", "Bo"];
    const days = workingDaysOfRange({ start: "2026-10-05", end: "2026-10-16" });
    const normal = days.flatMap((day) => team.map((person) => capacity(person, day, 8)));
    const withPto = normal.map((entry) =>
      entry.date >= "2026-10-08" && entry.person === "Bo" ? { ...entry, availableHours: 0, reason: "pto" as const } : entry,
    );
    const base = scenario({ perDay: 2, remainingPoints: 12 });
    const full = forecastSprintCompletion({ ...base, capacity: normal }, OPTIONS);
    const halved = forecastSprintCompletion({ ...base, capacity: withPto }, OPTIONS);
    expect(full.forecast.probability).toBe(1);
    expect(halved.forecast.probability).toBe(0); // 7 days x 1 pt < 12
    expect(halved.forecast.capacity.baselineSource).toBe("elapsed_mean");
    expect(halved.forecast.capacity.baselineHours).toBe(16);
    expect(halved.result.drivers.find((driver) => driver.key === "pto_person_days")).toMatchObject({ value: 7, detail: "Bo" });

    const zero = normal.map((entry) => (entry.date === "2026-10-08" ? { ...entry, availableHours: 0 } : entry));
    const zeroDay = forecastSprintCompletion({ ...base, capacity: zero }, OPTIONS);
    expect(zeroDay.inputs.dayFactors[0]).toBe(0);
    expect(zeroDay.forecast.burnUp[3].p50).toBe(4);
  });

  it("uses a nominal baseline (team x 8 h) without elapsed-day capacity, and flags it", () => {
    const base = scenario();
    const future = [capacity("Ana", "2026-10-08", 4), capacity("Bo", "2026-10-08", 4)];
    const outcome = forecastSprintCompletion({ ...base, capacity: future }, OPTIONS);
    expect(outcome.forecast.capacity.baselineSource).toBe("nominal");
    expect(outcome.inputs.dayFactors[0]).toBe(0.5);
    expect(outcome.result.drivers.some((driver) => driver.key === "capacity_baseline_nominal")).toBe(true);
  });

  it("treats every day as normal without capacity data, and flags it", () => {
    const outcome = forecastSprintCompletion(scenario(), OPTIONS);
    expect(outcome.forecast.capacity.baselineSource).toBe("none");
    expect(outcome.inputs.dayFactors.every((factor) => factor === 1)).toBe(true);
    expect(outcome.result.drivers.some((driver) => driver.key === "capacity_unavailable")).toBe(true);
  });
});

describe("sprint severity and confidence", () => {
  it("maps probability to severity", () => {
    expect(sprintSeverity(0.2)).toBe("critical");
    expect(sprintSeverity(0.38)).toBe("high");
    expect(sprintSeverity(0.6)).toBe("medium");
    expect(sprintSeverity(0.9)).toBe("low");
  });

  it("lowers confidence with fewer sprints, more variance, and missing capacity", () => {
    const full = sprintConfidence({ sprintsUsed: 6, sprintsWanted: 6, sprintTotals: [36, 36], capacitySource: "elapsed_mean" });
    expect(full).toBe(0.9);
    expect(sprintConfidence({ sprintsUsed: 3, sprintsWanted: 6, sprintTotals: [36, 36], capacitySource: "elapsed_mean" })).toBe(0.45);
    expect(sprintConfidence({ sprintsUsed: 6, sprintsWanted: 6, sprintTotals: [10, 30], capacitySource: "elapsed_mean" })).toBe(0.45);
    expect(sprintConfidence({ sprintsUsed: 6, sprintsWanted: 6, sprintTotals: [36, 36], capacitySource: "none" })).toBe(0.8);
  });
});

describe("detectScopeCreep", () => {
  function creep(
    extras: (sprintId: string) => { events: ReturnType<typeof event>[]; issues?: ReturnType<typeof issue>[] },
  ) {
    const base = scenario();
    const { events: extraEvents, issues: extraIssues = [] } = extras(base.activeSprint!.id);
    const withExtras = { ...base, issues: [...base.issues, ...extraIssues], issueEvents: [...base.issueEvents, ...extraEvents] };
    const outcome = forecastSprintCompletion(withExtras, OPTIONS);
    return { outcome, result: detectScopeCreep(withExtras, outcome.scope, OPTIONS) };
  }

  it("counts issues added and estimates raised after the start", () => {
    const { outcome, result } = creep((sprintId) => ({
      events: [
        event("TST-950", "sprint", null, sprintId, "2026-10-06T10:30:00.000Z"),
        event("TST-900", "points", "8", "10", "2026-10-07T11:00:00.000Z"),
      ],
      issues: [issue({ key: "TST-950", sprintId, points: 2, createdAt: "2026-10-06T10:00:00.000Z" })],
    }));
    expect(outcome.scope?.committed).toBe(12); // 8 (before re-estimate) + 4
    expect(outcome.scope?.current).toBe(16);
    expect(result.triggered).toBe(true); // 4 / 12 = 33%
    expect(result.severity).toBe("high");
    const drivers = Object.fromEntries(result.drivers.map((driver) => [driver.key, driver.value]));
    expect(drivers).toMatchObject({ committed_scope: 12, scope_added: 4, scope_removed: 0, scope_growth: 33, issues_added: 1, reestimates: 1 });
    expect(result.evidence.map((item) => item.sourceType)).toEqual(["jira_sprint", "jira_transition", "jira_transition"]);
    expect(outcome.forecast.burnUp.map((point) => point.scope).slice(0, 4)).toEqual([12, 14, 16, 16]);
  });

  it("nets removals and stays quiet under the threshold", () => {
    const { result } = creep((sprintId) => ({
      events: [
        event("TST-952", "sprint", null, sprintId, "2026-10-05T08:45:00.000Z"),
        event("TST-951", "sprint", null, sprintId, "2026-10-06T10:00:00.000Z"),
        event("TST-952", "sprint", sprintId, null, "2026-10-06T11:00:00.000Z"),
      ],
      issues: [issue({ key: "TST-951", sprintId, points: 3 }), issue({ key: "TST-952", sprintId: null, points: 2 })],
    }));
    const drivers = Object.fromEntries(result.drivers.map((driver) => [driver.key, driver.value]));
    expect(drivers).toMatchObject({ committed_scope: 16, scope_added: 3, scope_removed: 2, scope_growth: 6 });
    expect(result.triggered).toBe(false);
  });

  it("is inconclusive without an active sprint", () => {
    expect(isInconclusive(detectScopeCreep(snapshot(), null))).toBe(true);
  });

  it("ignores changes made before the sprint started", () => {
    const { result } = creep(() => ({ events: [event("TST-900", "points", "5", "10", "2026-10-02T10:00:00.000Z")] }));
    expect(result.triggered).toBe(false);
    expect(result.drivers.find((driver) => driver.key === "scope_added")?.value).toBe(0);
  });

  it("uses the injected now, never the wall clock", () => {
    expect(scenario().now).toBe(NOW);
  });
});
