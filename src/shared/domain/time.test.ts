import { describe, expect, it } from "vitest";

import {
  addWorkingDays,
  eachDayOfRange,
  startOfUtcDay,
  toIsoDate,
  workingDaysOfRange,
} from "./time";

describe("time helpers", () => {
  it("truncates to the UTC day regardless of the time", () => {
    expect(startOfUtcDay(new Date("2026-10-08T23:59:59.999Z")).toISOString()).toBe(
      "2026-10-08T00:00:00.000Z",
    );
  });

  it("skips weekends when moving by working days", () => {
    // Friday + 1 working day = Monday; Monday - 1 working day = Friday.
    expect(toIsoDate(addWorkingDays(new Date("2026-10-09T12:00:00Z"), 1))).toBe(
      "2026-10-12",
    );
    expect(toIsoDate(addWorkingDays(new Date("2026-10-12T00:00:00Z"), -1))).toBe(
      "2026-10-09",
    );
    // From a Saturday, 5 working days back lands on the Monday of that week.
    expect(toIsoDate(addWorkingDays(new Date("2026-10-10T00:00:00Z"), -5))).toBe(
      "2026-10-05",
    );
  });

  it("lists inclusive calendar and working days", () => {
    const range = { start: "2026-10-09", end: "2026-10-12" };
    expect(eachDayOfRange(range)).toEqual([
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
    ]);
    expect(workingDaysOfRange(range)).toEqual(["2026-10-09", "2026-10-12"]);
  });
});
