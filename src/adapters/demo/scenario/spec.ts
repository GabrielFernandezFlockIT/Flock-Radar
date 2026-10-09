/**
 * Declarative description of one demo project. `builder.ts` turns a spec into
 * domain records anchored to "today"; `projects.ts` holds the three specs.
 *
 * Day numbers refer to working days of the ACTIVE sprint: day 1 is its first
 * working day and "today" is always day 6, so days 1-5 are in the past and
 * days 6-10 are the remaining ones. Days above 10 continue into the next
 * sprint (useful for future PTO).
 */

import type { TeamRole } from "@/shared/domain";

export const ISSUE_TYPES = ["Story", "Bug", "Task", "Spike"] as const;
export type DemoIssueType = (typeof ISSUE_TYPES)[number];

export interface DemoPerson {
  /** Display name, used as Jira assignee and calendar owner. */
  name: string;
  /** GitHub login. */
  login: string;
  /** Joins at the start of the burn window (Cobalt ramp-up); defaults to false. */
  joinsLate?: boolean;
}

export type PlannedState = "done" | "in_progress" | "in_review" | "todo";

/** Scripted anomalies that later phases must detect. */
export type PlannedScript =
  | "stalled"
  | "stale_review"
  | "done_without_pr";

export interface PlannedIssue {
  type: DemoIssueType;
  title: string;
  /** Current estimate. */
  points: number;
  /** Index into `ProjectSpec.people`. */
  assignee: number;
  state: PlannedState;
  /** Day work started (in_progress, in_review, done). */
  startedOnDay?: number;
  /** Day the issue was resolved (done). */
  doneOnDay?: number;
  /** Day the pull request was opened (in_review). */
  prOnDay?: number;
  /** Added to the sprint after it started, on this day (scope creep). */
  addedOnDay?: number;
  /** Estimate at sprint start when it was re-estimated later (scope creep). */
  initialPoints?: number;
  reestimatedOnDay?: number;
  /** Was in the previous sprint and carried over at planning. */
  carriedOver?: boolean;
  script?: PlannedScript;
}

export interface BacklogIssue {
  type: DemoIssueType;
  title: string;
  points: number;
  /** Planned into the next (future) sprint instead of the plain backlog. */
  nextSprint?: boolean;
}

export type CommentTime =
  /** A past day of the active sprint (1-5) at an hour (UTC, fractional). */
  | { day: number; hour: number }
  /** The last working day on or before `today - daysAgo`, at an hour. */
  | { daysAgo: number; hour: number };

export interface CommentScript {
  /** Index into `activePlan`. */
  planIndex: number;
  /** Index into `people`. */
  author: number;
  body: string;
  at: CommentTime;
}

export interface OrphanPullRequest {
  title: string;
  branch: string;
  author: number;
  openedOnDay: number;
  mergedOnDay: number;
}

export interface DocSpec {
  slug: string;
  title: string;
  excerpt: string;
  updatedDaysAgo: number;
}

export interface PtoSpec {
  person: number;
  /** Active-sprint working days (6-10 are upcoming; 11+ next sprint). */
  days: number[];
}

export type BurnSpec =
  | { kind: "steady"; hoursPerPersonDay: number }
  | {
      kind: "accelerating";
      hoursPerPersonDay: number;
      /** Working days before today in which the late joiners also log time. */
      windowWorkingDays: number;
      /**
       * Working days from today until the budget runs out when the window's
       * daily burn continues (the scripted exhaustion date).
       */
      exhaustionWorkingDaysAhead: number;
    };

/**
 * The team that works on the project. Roles are per PERSON INDEX, because the
 * role lives on the membership, not on the person (D-051); exactly one of
 * them must be `lead`.
 */
export interface TeamSpec {
  name: string;
  description: string;
  /** One role per entry of `ProjectSpec.people`, same order. */
  roles: TeamRole[];
  /**
   * Index into `people` whose MOST RECENT status the lead loads on their
   * behalf, so the demo exercises `authorPersonId !== personId`.
   */
  statusLoadedByLeadFor?: number;
}

export interface ProjectSpec {
  slug: "atlas" | "beacon" | "cobalt";
  name: string;
  clientName: string;
  jiraKey: string;
  githubRepo: string;
  boardId: string;
  /** First Jira sprint id; later sprints count up from it. */
  jiraSprintIdBase: number;
  /** Display number of the oldest generated sprint. */
  sprintNumberBase: number;
  /** First pull request number in the repository. */
  prNumberBase: number;
  people: DemoPerson[];
  budgetAmount: number;
  hourlyRate: number;
  /** Calendar days from today to the contractual end date. */
  endOffsetDays: number;
  forecastUnit: "points" | "issues";
  wipLimit: number;
  historySprints: number;
  /** Points completed per closed sprint (inclusive range). */
  historyVelocity: { min: number; max: number };
  titles: Record<DemoIssueType, string[]>;
  activeSprintGoal: string;
  activePlan: PlannedIssue[];
  backlog: BacklogIssue[];
  comments: CommentScript[];
  orphanPullRequest?: OrphanPullRequest;
  docs: DocSpec[];
  pto: PtoSpec[];
  burn: BurnSpec;
  team: TeamSpec;
}
