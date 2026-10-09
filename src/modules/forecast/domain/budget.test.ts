import { describe, expect, it } from "vitest";

import { DetectorResultSchema, workingDaysOfRange } from "@/shared/domain";
import { issue, project, snapshot, worklog } from "@test/helpers/forecast-fixtures";

import { budgetConfidence, budgetSeverity, budgetTitle, ewma, forecastBudgetRunway } from "./budget";
import { isInconclusive } from "./snapshot";

const ISSUE = issue({ key: "TST-1" });

/** One worklog of `hours` on every working day in the inclusive range. */
function steady(start: string, end: string, hours: number) {
  return workingDaysOfRange({ start, end }).map((day) => worklog(ISSUE.key, day, hours));
}

describe("ewma", () => {
  it("is the value itself for a single day", () => {
    expect(ewma([7], 0.3)).toBe(7);
  });

  it("weights recent days by alpha", () => {
    expect(ewma([10, 20], 0.3)).toBeCloseTo(13);
    expect(ewma([4, 4, 4], 0.3)).toBeCloseTo(4);
  });

  it("returns 0 without values and rejects a bad alpha", () => {
    expect(ewma([], 0.3)).toBe(0);
    expect(() => ewma([1], 0)).toThrow(/alpha/);
  });
});

describe("forecastBudgetRunway", () => {
  it("projects exhaustion from a steady burn and triggers before the end date", () => {
    // Budget 10,000 at 100/h = 100 h. 40 h logged (10 days x 4 h) before Thu 2026-10-08.
    // 60 h left at 4 h/day = 15 working days from today: Wed 2026-10-28.
    const outcome = forecastBudgetRunway(
      snapshot({
        project: project({ startDate: "2026-09-24", endDate: "2026-11-30" }),
        issues: [ISSUE],
        worklogs: steady("2026-09-24", "2026-10-07", 4),
      }),
    );
    const { forecast, result } = outcome;
    expect(forecast.spent).toBe(4_000);
    expect(forecast.dailyBurnHours).toBe(4);
    expect(forecast.exhaustionDate).toBe("2026-10-28");
    expect(forecast.daysBeforeEnd).toBe(33);
    expect(forecast.projectedSpendAtEnd).toBe(4_000 + 400 * 38);
    expect(forecast.percentOverAtEnd).toBe(92);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("critical");
    expect(result.eta).toBe("2026-10-28");
    expect(() => DetectorResultSchema.parse(result)).not.toThrow();
    expect(result.evidence).toEqual([
      expect.objectContaining({ sourceType: "jira_worklog", externalId: "TST-1 worklogs", label: "40 h registradas en los últimos 10 días hábiles" }),
    ]);
    expect(budgetTitle(forecast)).toBe(
      "El presupuesto se agota el 28 oct, 33 días antes de la fecha de fin",
    );

    const drivers = Object.fromEntries(result.drivers.map((driver) => [driver.key, driver.value]));
    expect(drivers).toMatchObject({ budget: 10_000, spent: 4_000, daily_burn: 400, exhaustion_days_before_end: 33, percent_over_at_end: 92 });

    const series = forecast.series;
    expect(series[0]).toMatchObject({ date: "2026-09-24", actual: 400, projected: null });
    expect(series.find((point) => point.date === "2026-10-07")).toMatchObject({ actual: 4_000, projected: 4_000 });
    expect(series.find((point) => point.date === "2026-10-08")).toMatchObject({ actual: null, projected: 4_400 });
    expect(series.at(-1)).toMatchObject({ date: "2026-11-30", plan: 10_000 });
  });

  it("does not trigger when the money lasts past the end date", () => {
    const outcome = forecastBudgetRunway(
      snapshot({
        project: project({ startDate: "2026-09-24", endDate: "2026-10-20" }),
        issues: [ISSUE],
        worklogs: steady("2026-09-24", "2026-10-07", 4),
      }),
    );
    expect(outcome.forecast.exhaustionDate).toBe("2026-10-28");
    expect(outcome.result.triggered).toBe(false);
    expect(outcome.forecast.percentOverAtEnd).toBeLessThan(0);
  });

  it("reacts to an accelerating burn through the EWMA", () => {
    const worklogs = [...steady("2026-09-14", "2026-09-30", 2), ...steady("2026-10-01", "2026-10-07", 8)];
    const outcome = forecastBudgetRunway(
      snapshot({ project: project({ startDate: "2026-09-14" }), issues: [ISSUE], worklogs }),
    );
    expect(outcome.forecast.dailyBurnHours).toBeGreaterThan(6);
    expect(outcome.result.drivers.find((driver) => driver.key === "burn_change")).toBeDefined();
  });

  it("is inconclusive without worklogs", () => {
    const outcome = forecastBudgetRunway(snapshot({ issues: [ISSUE] }));
    expect(outcome.result.triggered).toBe(false);
    expect(isInconclusive(outcome.result)).toBe(true);
    expect(outcome.forecast.exhaustionDate).toBeNull();
    expect(outcome.forecast.spent).toBe(0);
  });

  it("handles a single day of history", () => {
    const outcome = forecastBudgetRunway(
      snapshot({ project: project({ startDate: "2026-10-07" }), issues: [ISSUE], worklogs: [worklog(ISSUE.key, "2026-10-07", 10)] }),
    );
    expect(outcome.forecast.dailyBurnHours).toBe(10);
    expect(outcome.forecast.exhaustionDate).toBe("2026-10-20"); // 90 h left at 10 h/day: 9 working days from Thu 8th
    expect(outcome.result.confidence).toBeLessThan(0.2);
  });

  it("reports an already exhausted budget, even after the end date", () => {
    const outcome = forecastBudgetRunway(
      snapshot({
        project: project({ startDate: "2026-09-01", endDate: "2026-10-01", budgetAmount: 2_000 }),
        issues: [ISSUE],
        worklogs: steady("2026-09-14", "2026-09-30", 4),
      }),
    );
    expect(outcome.forecast.alreadyExhausted).toBe(true);
    expect(outcome.forecast.exhaustionDate).toBe("2026-09-18"); // 5 days x 4 h x 100 = 2,000
    expect(outcome.forecast.daysBeforeEnd).toBe(13);
    expect(outcome.forecast.projectedSpendAtEnd).toBe(outcome.forecast.spent);
    expect(outcome.result.triggered).toBe(true);
    expect(outcome.result.severity).toBe("critical");
    expect(budgetTitle(outcome.forecast)).toBe(
      "Presupuesto agotado el 18 sep, antes de la fecha de fin del 1 oct",
    );
  });

  it("triggers an overspent project whose end date is before the exhaustion day", () => {
    // 13 working days x 4 h x 100/h = 5,200 spent against a 2,000 budget.
    const outcome = forecastBudgetRunway(
      snapshot({
        project: project({ startDate: "2026-09-01", endDate: "2026-09-16", budgetAmount: 2_000 }),
        issues: [ISSUE],
        worklogs: steady("2026-09-14", "2026-09-30", 4),
      }),
    );
    expect(outcome.forecast.alreadyExhausted).toBe(true);
    expect(outcome.forecast.exhaustionDate).toBe("2026-09-18");
    expect(outcome.forecast.daysBeforeEnd).toBe(-2); // exhausted after the end date
    expect(outcome.forecast.percentOverAtEnd).toBe(160);
    expect(outcome.result.triggered).toBe(true);
    expect(outcome.result.severity).toBe("critical");
    expect(budgetTitle(outcome.forecast)).toBe(
      "Presupuesto ya agotado; 160% por encima a la fecha de fin del 16 sep",
    );
  });

  it("does not trigger a project that ended within budget", () => {
    const outcome = forecastBudgetRunway(
      snapshot({
        project: project({ startDate: "2026-09-01", endDate: "2026-10-01" }),
        issues: [ISSUE],
        worklogs: steady("2026-09-14", "2026-09-30", 1),
      }),
    );
    expect(outcome.forecast.projectedSpendAtEnd).toBe(outcome.forecast.spent);
    expect(outcome.result.triggered).toBe(false);
  });

  it("counts weekend logs in spend on the previous working day", () => {
    const outcome = forecastBudgetRunway(
      snapshot({ project: project({ startDate: "2026-10-02" }), issues: [ISSUE], worklogs: [worklog(ISSUE.key, "2026-10-04", 3)] }),
    );
    expect(outcome.forecast.spentHours).toBe(3);
    expect(outcome.forecast.dailyHours.find((day) => day.date === "2026-10-02")?.hours).toBe(3);
  });
});

describe("budget severity and confidence", () => {
  it("buckets by days before the end date", () => {
    expect(budgetSeverity(14, false)).toBe("critical");
    expect(budgetSeverity(7, false)).toBe("high");
    expect(budgetSeverity(3, false)).toBe("medium");
    expect(budgetSeverity(1, false)).toBe("low");
    expect(budgetSeverity(0, true)).toBe("critical");
  });

  it("grows with history and stability", () => {
    expect(budgetConfidence(20, [4, 4, 4])).toBe(0.9);
    expect(budgetConfidence(10, [4, 4, 4])).toBe(0.45);
    expect(budgetConfidence(20, [1, 7])).toBe(0.45);
  });
});
