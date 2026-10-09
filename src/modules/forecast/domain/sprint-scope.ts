import {
  fromIsoDate,
  workingDaysOfRange,
  type ForecastUnit,
  type Issue,
  type IssueEvent,
  type IsoDate,
  type Sprint,
} from "@/shared/domain";

import { dayOf, endOfDayMs } from "./dates";

/**
 * Sprint scope reconstruction (decision D-018): membership and estimates at
 * any instant are rebuilt from the current issues plus their changelog.
 *
 * - Membership at `t`: the last `sprint` event at or before `t` decides; an
 *   issue without sprint events is a member when it currently belongs to the
 *   sprint and existed at `t`. At or after "now" the current state wins.
 * - Estimate at `t`: the `from` of the first `points` event after `t`, else
 *   the current estimate.
 */

export type ScopeChangeKind = "added" | "removed" | "reestimated";

export interface ScopeChange {
  issueKey: string;
  kind: ScopeChangeKind;
  /** Signed change in the forecast unit. */
  delta: number;
  at: string;
  event: IssueEvent;
  /** Estimates before and after (re-estimates only). */
  from?: number | null;
  to?: number | null;
}

export interface SprintScope {
  sprint: Sprint;
  unit: ForecastUnit;
  /** Scope at the sprint's start instant. */
  committed: number;
  /** Scope now. */
  current: number;
  /** Done now (current members in a done status). */
  done: number;
  remaining: number;
  /** Changes after the sprint started, up to now, in time order. */
  changes: ScopeChange[];
  /** Issues currently in the sprint (key order). */
  members: Issue[];
  /** Sprint working days, first to last (UTC). */
  days: IsoDate[];
  /** Scope at the end of each sprint day (current scope for today and later). */
  scopeByDay: number[];
  /** Done at the end of each elapsed day; `null` from today on. */
  doneByDay: Array<number | null>;
}

function parsePoints(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

interface IssueHistory {
  issue: Issue;
  sprintEvents: IssueEvent[];
  pointEvents: IssueEvent[];
}

/** Indexes changelog events by issue key, keeping time order. */
export function indexHistories(
  issues: readonly Issue[],
  events: readonly IssueEvent[],
): Map<string, IssueHistory> {
  const byKey = new Map<string, IssueHistory>();
  for (const issue of issues) {
    byKey.set(issue.key, { issue, sprintEvents: [], pointEvents: [] });
  }
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const event of sorted) {
    const history = byKey.get(event.issueKey);
    if (!history) continue;
    if (event.field === "sprint") history.sprintEvents.push(event);
    else if (event.field === "points") history.pointEvents.push(event);
  }
  return byKey;
}

export function pointsAt(history: IssueHistory, atMs: number): number | null {
  const next = history.pointEvents.find((event) => Date.parse(event.at) > atMs);
  return next ? parsePoints(next.from) : history.issue.points;
}

function isMemberAt(
  history: IssueHistory,
  sprintId: string,
  atMs: number,
  nowMs: number,
): boolean {
  if (atMs >= nowMs) return history.issue.sprintId === sprintId;
  let last: IssueEvent | undefined;
  for (const event of history.sprintEvents) {
    if (Date.parse(event.at) > atMs) break;
    last = event;
  }
  if (last) return last.to === sprintId;
  if (history.sprintEvents.length > 0) return false; // joined some sprint later
  return (
    history.issue.sprintId === sprintId && Date.parse(history.issue.createdAt) <= atMs
  );
}

export function issueSize(
  history: IssueHistory,
  unit: ForecastUnit,
  atMs: number,
): number {
  return unit === "issues" ? 1 : (pointsAt(history, atMs) ?? 0);
}

export function buildSprintScope(input: {
  sprint: Sprint;
  unit: ForecastUnit;
  issues: readonly Issue[];
  events: readonly IssueEvent[];
  now: Date;
}): SprintScope {
  const { sprint, unit, now } = input;
  const nowMs = now.getTime();
  const startMs = Date.parse(sprint.startAt);
  const histories = indexHistories(input.issues, input.events);

  // Every issue that was ever in the sprint, by event or by current state.
  const candidates = [...histories.values()].filter(
    (history) =>
      history.issue.sprintId === sprint.id ||
      history.sprintEvents.some(
        (event) => event.to === sprint.id || event.from === sprint.id,
      ),
  );

  const scopeAt = (atMs: number) =>
    candidates.reduce(
      (sum, history) =>
        isMemberAt(history, sprint.id, atMs, nowMs)
          ? sum + issueSize(history, unit, atMs)
          : sum,
      0,
    );

  const members = candidates
    .filter((history) => history.issue.sprintId === sprint.id)
    .map((history) => history.issue);
  const memberHistories = candidates.filter(
    (history) => history.issue.sprintId === sprint.id,
  );
  const current = memberHistories.reduce(
    (sum, history) => sum + issueSize(history, unit, nowMs),
    0,
  );
  const doneHistories = memberHistories.filter(
    (history) => history.issue.statusCategory === "done",
  );
  const done = doneHistories.reduce(
    (sum, history) => sum + issueSize(history, unit, nowMs),
    0,
  );

  const changes: ScopeChange[] = [];
  for (const history of candidates) {
    for (const event of history.sprintEvents) {
      const atMs = Date.parse(event.at);
      if (atMs <= startMs || atMs > nowMs) continue;
      const size = issueSize(history, unit, atMs);
      if (event.to === sprint.id && event.from !== sprint.id) {
        changes.push({ issueKey: history.issue.key, kind: "added", delta: size, at: event.at, event });
      } else if (event.from === sprint.id && event.to !== sprint.id) {
        changes.push({ issueKey: history.issue.key, kind: "removed", delta: -size, at: event.at, event });
      }
    }
    if (unit === "issues") continue;
    for (const event of history.pointEvents) {
      const atMs = Date.parse(event.at);
      if (atMs <= startMs || atMs > nowMs) continue;
      if (!isMemberAt(history, sprint.id, atMs, nowMs)) continue;
      const from = parsePoints(event.from);
      const to = parsePoints(event.to);
      const delta = (to ?? 0) - (from ?? 0);
      if (delta === 0) continue;
      changes.push({
        issueKey: history.issue.key,
        kind: "reestimated",
        delta,
        at: event.at,
        event,
        from,
        to,
      });
    }
  }
  changes.sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.issueKey.localeCompare(b.issueKey),
  );

  const days = workingDaysOfRange({
    start: dayOf(sprint.startAt),
    end: dayOf(sprint.endAt),
  });
  const todayMs = fromIsoDate(dayOf(now.toISOString())).getTime();
  const scopeByDay = days.map((day) => {
    const dayEnd = endOfDayMs(day);
    return dayEnd > nowMs ? current : scopeAt(dayEnd - 1);
  });
  const doneByDay = days.map((day) => {
    if (fromIsoDate(day).getTime() >= todayMs) return null;
    const dayEnd = endOfDayMs(day);
    return doneHistories.reduce((sum, history) => {
      const resolvedAt = history.issue.resolvedAt;
      return resolvedAt !== null && Date.parse(resolvedAt) < dayEnd
        ? sum + issueSize(history, unit, nowMs)
        : sum;
    }, 0);
  });

  return {
    sprint,
    unit,
    committed: scopeAt(startMs),
    current,
    done,
    remaining: Math.max(0, current - done),
    changes,
    members,
    days,
    scopeByDay,
    doneByDay,
  };
}
