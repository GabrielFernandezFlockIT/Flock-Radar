import {
  workingDaysOfRange,
  type CapacityEntry,
  type ForecastUnit,
  type Issue,
  type IsoDate,
  type Sprint,
} from "@/shared/domain";

import { dayOf, workingDayOnOrBefore } from "./dates";

/**
 * Throughput sampling and capacity scaling for the sprint Monte Carlo
 * (decision D-037).
 */

export interface SprintThroughput {
  sprintId: string;
  name: string;
  /** Throughput per working day of the sprint, zero days included. */
  daily: number[];
  total: number;
}

/**
 * The last `count` closed sprints (by start), oldest first.
 */
export function lastClosedSprints(sprints: readonly Sprint[], count: number): Sprint[] {
  return sprints
    .filter((sprint) => sprint.state === "closed")
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(-count);
}

/**
 * Daily throughput of each sprint: done issues (current status category
 * `done`) are attributed to the working day they were resolved on (a
 * weekend resolution counts on the previous working day). Points count the
 * current estimate; `issues` counts 1 each.
 */
export function sprintThroughput(
  sprints: readonly Sprint[],
  issues: readonly Issue[],
  unit: ForecastUnit,
): SprintThroughput[] {
  const resolvedByDay = new Map<IsoDate, number>();
  for (const issue of issues) {
    if (issue.statusCategory !== "done" || issue.resolvedAt === null) continue;
    const day = workingDayOnOrBefore(dayOf(issue.resolvedAt));
    const size = unit === "issues" ? 1 : (issue.points ?? 0);
    resolvedByDay.set(day, (resolvedByDay.get(day) ?? 0) + size);
  }
  return sprints.map((sprint) => {
    const days = workingDaysOfRange({
      start: dayOf(sprint.startAt),
      end: dayOf(sprint.endAt),
    });
    const daily = days.map((day) => resolvedByDay.get(day) ?? 0);
    return {
      sprintId: sprint.id,
      name: sprint.name,
      daily,
      total: daily.reduce((sum, value) => sum + value, 0),
    };
  });
}

/** Done issues resolved inside the given sprints' windows. */
export function issuesResolvedIn(
  sprints: readonly Sprint[],
  issues: readonly Issue[],
): Issue[] {
  const windows = sprints.map((sprint) => ({
    start: dayOf(sprint.startAt),
    end: dayOf(sprint.endAt),
  }));
  return issues.filter((issue) => {
    if (issue.statusCategory !== "done" || issue.resolvedAt === null) return false;
    const day = dayOf(issue.resolvedAt);
    return windows.some((window) => day >= window.start && day <= window.end);
  });
}

export type CapacityBaselineSource = "elapsed_mean" | "nominal" | "none";

export interface CapacityModel {
  /** Team hours of a "normal" day; capacity factors divide by it. */
  baselineHours: number;
  source: CapacityBaselineSource;
  teamSize: number;
  /** Team available hours per day with capacity data. */
  hoursByDay: Map<IsoDate, number>;
}

/**
 * Baseline for capacity factors (decision D-038): the mean team hours of the
 * sprint's elapsed working days, because historical throughput already
 * reflects ordinary meetings. Falls back to `teamSize x hoursPerPersonDay`
 * when no elapsed day has capacity data (or they sum to zero), and to no
 * scaling at all (`none`, every factor 1) without any capacity data.
 */
export function buildCapacityModel(
  entries: readonly CapacityEntry[],
  elapsedDays: readonly IsoDate[],
  hoursPerPersonDay: number,
): CapacityModel {
  const hoursByDay = new Map<IsoDate, number>();
  const people = new Set<string>();
  for (const entry of entries) {
    people.add(entry.person);
    hoursByDay.set(entry.date, (hoursByDay.get(entry.date) ?? 0) + entry.availableHours);
  }
  const teamSize = people.size;
  const elapsed = elapsedDays.filter((day) => hoursByDay.has(day));
  const elapsedMean =
    elapsed.length === 0
      ? 0
      : elapsed.reduce((sum, day) => sum + (hoursByDay.get(day) ?? 0), 0) / elapsed.length;

  if (elapsedMean > 0) {
    return { baselineHours: elapsedMean, source: "elapsed_mean", teamSize, hoursByDay };
  }
  const nominal = teamSize * hoursPerPersonDay;
  if (nominal > 0) {
    return { baselineHours: nominal, source: "nominal", teamSize, hoursByDay };
  }
  return { baselineHours: 0, source: "none", teamSize, hoursByDay };
}

/**
 * Capacity factor of a day: available team hours / baseline, clamped at 0.
 * Days without capacity data (or without a baseline) count as normal (1).
 */
export function capacityFactor(model: CapacityModel, day: IsoDate): number {
  if (model.baselineHours <= 0) return 1;
  const hours = model.hoursByDay.get(day);
  if (hours === undefined) return 1;
  return Math.max(0, hours / model.baselineHours);
}
