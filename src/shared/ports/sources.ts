import type {
  CalendarEvent,
  Commit,
  DateRange,
  DocRef,
  Issue,
  IssueComment,
  IssueEvent,
  Project,
  PullRequest,
  Sprint,
  Worklog,
} from "@/shared/domain";

/**
 * Source ports: read-only views of the systems Flock-Radar ingests from. Adapters
 * (Jira, GitHub, Google Calendar, Flocktools, demo fakes) return validated
 * domain records; they never write back to the source.
 *
 * Contract for every adapter:
 * - Failures reject with `SourceUnavailableError` carrying a short, safe
 *   reason (no URLs, tokens, or upstream bodies). The sync use case stores
 *   only that reason and keeps going with the other sources.
 * - Timestamps are normalized to UTC ISO strings via `Date#toISOString()`
 *   (Jira's `2026-10-08T10:00:00.000+0000` becomes `...000Z`), so string
 *   comparison and `Date.parse` agree everywhere downstream.
 * - Natural keys are unique within one response; the sync use case still
 *   dedupes defensively (last occurrence wins).
 */

export interface IssueTracker {
  getSprints(project: Project): Promise<Sprint[]>;
  getIssues(
    project: Project,
    options?: { updatedSince?: string },
  ): Promise<Issue[]>;
  getIssueEvents(
    project: Project,
    issueKeys: readonly string[],
  ): Promise<IssueEvent[]>;
  getComments(
    project: Project,
    issueKeys: readonly string[],
  ): Promise<IssueComment[]>;
  getWorklogs(
    project: Project,
    issueKeys: readonly string[],
  ): Promise<Worklog[]>;
}

export interface CodeHost {
  /** Pull requests created or updated at or after `since` (ISO datetime). */
  getPullRequests(
    project: Project,
    options: { since: string },
  ): Promise<PullRequest[]>;
  /** Commits on the default branch at or after `since` (ISO datetime). */
  getCommits(project: Project, options: { since: string }): Promise<Commit[]>;
}

export interface CalendarSource {
  /**
   * Events of `people` overlapping the inclusive day range.
   * All-day events (PTO, holidays) are emitted on UTC-midnight bounds, one
   * day = `[YYYY-MM-DDT00:00:00.000Z, next day T00:00:00.000Z)`, whatever
   * the calendar's own time zone, because capacity is computed per UTC day.
   * Team-wide holidays are expanded into one event per person.
   */
  getEvents(
    people: readonly string[],
    range: DateRange,
  ): Promise<CalendarEvent[]>;
}

export interface DocsSource {
  listDocs(project: Project): Promise<DocRef[]>;
}

/** The full set of source ports, as wired by the composition root. */
export interface SourcePorts {
  issueTracker: IssueTracker;
  codeHost: CodeHost;
  calendar: CalendarSource;
  docs: DocsSource;
}
