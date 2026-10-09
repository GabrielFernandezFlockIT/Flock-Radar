import type { ProjectSnapshot } from "@/modules/forecast/domain";
import type {
  CapacityEntry,
  Commit,
  Issue,
  IssueEvent,
  Project,
  PullRequest,
  Sprint,
  Worklog,
} from "@/shared/domain";

/**
 * Small hand-built records for forecast unit tests. Dates are UTC; the
 * default "now" is Thursday 2026-10-08 12:00.
 */

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const NOW = new Date("2026-10-08T12:00:00.000Z");

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: "Test Project",
    jiraKey: "TST",
    githubRepo: "acme/test",
    clientName: "Acme",
    budgetAmount: 10_000,
    budgetCurrency: "USD",
    hourlyRate: 100,
    startDate: "2026-09-01",
    endDate: "2026-12-31",
    forecastUnit: "points",
    wipLimit: 3,
    boardId: "7",
    ...overrides,
  };
}

let sprintCounter = 0;
export function sprint(
  startDay: string,
  endDay: string,
  state: Sprint["state"],
  overrides: Partial<Sprint> = {},
): Sprint {
  sprintCounter += 1;
  const suffix = String(sprintCounter).padStart(12, "0");
  return {
    id: `22222222-2222-4222-8222-${suffix}`,
    projectId: PROJECT_ID,
    externalId: String(100 + sprintCounter),
    name: `TST Sprint ${sprintCounter}`,
    goal: null,
    startAt: `${startDay}T09:00:00.000Z`,
    endAt: `${endDay}T18:00:00.000Z`,
    state,
    committedPoints: null,
    ...overrides,
  };
}

let issueCounter = 0;
export function issue(overrides: Partial<Issue> = {}): Issue {
  issueCounter += 1;
  const key = overrides.key ?? `TST-${issueCounter}`;
  return {
    projectId: PROJECT_ID,
    key,
    title: `Issue ${key}`,
    type: "Story",
    status: "To Do",
    statusCategory: "todo",
    points: 3,
    assignee: "Ana",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    resolvedAt: null,
    url: `https://acme.atlassian.net/browse/${key}`,
    sprintId: null,
    requiresCode: true,
    ...overrides,
  };
}

export function doneIssue(resolvedAt: string, overrides: Partial<Issue> = {}): Issue {
  return issue({
    status: "Done",
    statusCategory: "done",
    resolvedAt,
    updatedAt: resolvedAt,
    ...overrides,
  });
}

let eventCounter = 0;
export function event(
  issueKey: string,
  field: IssueEvent["field"],
  from: string | null,
  to: string | null,
  at: string,
): IssueEvent {
  eventCounter += 1;
  return {
    projectId: PROJECT_ID,
    externalId: `e${eventCounter}`,
    issueKey,
    field,
    from,
    to,
    at,
    author: "Ana",
  };
}

let worklogCounter = 0;
export function worklog(issueKey: string, day: string, hours: number): Worklog {
  worklogCounter += 1;
  return {
    projectId: PROJECT_ID,
    issueKey,
    id: String(worklogCounter),
    author: "Ana",
    seconds: Math.round(hours * 3600),
    startedAt: `${day}T09:00:00.000Z`,
  };
}

export function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  const number = overrides.number ?? 1;
  return {
    projectId: PROJECT_ID,
    number,
    title: `PR ${number}`,
    state: "open",
    author: "ana",
    createdAt: "2026-10-05T10:00:00.000Z",
    mergedAt: null,
    firstReviewAt: null,
    linkedIssueKeys: [],
    url: `https://github.com/acme/test/pull/${number}`,
    ...overrides,
  };
}

export function commit(sha: string, committedAt: string, keys: string[]): Commit {
  return {
    projectId: PROJECT_ID,
    sha: sha.padEnd(40, "0"),
    author: "ana",
    message: `${keys.join(" ")}: work`,
    committedAt,
    linkedIssueKeys: keys,
    url: `https://github.com/acme/test/commit/${sha.padEnd(40, "0")}`,
  };
}

export function capacity(
  person: string,
  date: string,
  availableHours: number,
  reason: CapacityEntry["reason"] = null,
): CapacityEntry {
  return { projectId: PROJECT_ID, person, date, availableHours, reason };
}

export function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    project: project(),
    now: NOW,
    sprints: [],
    activeSprint: null,
    issues: [],
    issueEvents: [],
    worklogs: [],
    pullRequests: [],
    commits: [],
    capacity: [],
    ...overrides,
  };
}
