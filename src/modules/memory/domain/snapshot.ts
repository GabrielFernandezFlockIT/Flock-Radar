import type {
  Commit,
  DocRef,
  Issue,
  IssueComment,
  IssueEvent,
  Project,
  PullRequest,
} from "@/shared/domain";

/**
 * Everything the memory rules read for one project, loaded by the application
 * layer. Rules are pure functions of a snapshot plus options: "now" is a
 * field, never a clock read.
 */
export interface MemorySnapshot {
  project: Project;
  now: Date;
  issues: readonly Issue[];
  issueEvents: readonly IssueEvent[];
  issueComments: readonly IssueComment[];
  pullRequests: readonly PullRequest[];
  commits: readonly Commit[];
  docs: readonly DocRef[];
}

/** Tunable knobs; `DEFAULT_MEMORY_OPTIONS` documents each default. */
export interface MemoryOptions {
  /**
   * A pull request waiting longer than this for its FIRST review is pending.
   *
   * Duplicated from `ForecastOptions.staleReviewHours` (same default, 48) on
   * purpose: the forecast engine owns alerting thresholds and the memory
   * module owns remembering thresholds, and a cross-module domain import
   * would couple two independent slices. If they ever need to move together,
   * promote ONE constant into `@/shared/domain` and delete both copies.
   */
  staleReviewHours: number;
  /** A pull request open longer than this (calendar days) is pending. */
  openPullRequestDays: number;
  /**
   * Full working days an in-progress issue may go without a linked commit
   * before it counts as stalled. Duplicated from
   * `ForecastOptions.stalledWorkingDays` (D-034), same note as above.
   */
  stalledWorkingDays: number;
  /** Hours a question may stay unanswered in Jira before it is pending. */
  unansweredQuestionHours: number;
  /** Window of the weekly digest and of the "what got done" view, in days. */
  digestDays: number;
}

export const DEFAULT_MEMORY_OPTIONS: MemoryOptions = {
  staleReviewHours: 48,
  openPullRequestDays: 7,
  stalledWorkingDays: 5,
  unansweredQuestionHours: 48,
  digestDays: 7,
};
