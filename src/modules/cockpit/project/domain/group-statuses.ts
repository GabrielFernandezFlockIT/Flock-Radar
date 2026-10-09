import type { Status } from "@/shared/domain";

/**
 * Presentation helper for the status feed: groups daily statuses by the day
 * they report on, newest day first, keeping each day's entries in the order
 * the repository returned them (`reportedOn`, then `personId`).
 *
 * Pure and framework-free so it can be unit-tested without a repository or the
 * DOM; the UI maps person ids to names on top of the result.
 */

export interface StatusDayGroup {
  /** ISO day (`2026-10-14`) shared by every entry in `items`. */
  day: string;
  items: Status[];
}

/** Statuses grouped by `reportedOn`, most recent day first. */
export function groupStatusesByDay(statuses: readonly Status[]): StatusDayGroup[] {
  const byDay = new Map<string, Status[]>();
  for (const status of statuses) {
    const bucket = byDay.get(status.reportedOn);
    if (bucket === undefined) {
      byDay.set(status.reportedOn, [status]);
    } else {
      bucket.push(status);
    }
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, items]) => ({ day, items }));
}
