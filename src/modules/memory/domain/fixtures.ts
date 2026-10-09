import type {
  Commit,
  DocRef,
  Issue,
  IssueComment,
  IssueEvent,
  Project,
  PullRequest,
} from "@/shared/domain";

import type { MemorySnapshot } from "./snapshot";

/**
 * Minimal, hand-written records for the rule tests. Kept tiny on purpose: the
 * realistic end-to-end coverage lives in the demo pipeline test, these
 * fixtures only have to make ONE rule fire or not fire.
 */

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const NOW = new Date("2026-03-18T12:00:00.000Z"); // Wednesday

export const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Test Project",
  jiraKey: "TST",
  githubRepo: "acme/test",
  clientName: "Acme",
  budgetAmount: 100_000,
  budgetCurrency: "USD",
  hourlyRate: 60,
  startDate: "2026-01-05",
  endDate: "2026-06-30",
  forecastUnit: "points",
  wipLimit: 5,
};

export function issue(overrides: Partial<Issue> & { key: string }): Issue {
  return {
    projectId: PROJECT_ID,
    title: `Work on ${overrides.key}`,
    type: "Story",
    status: "To Do",
    statusCategory: "todo",
    points: 3,
    assignee: "Ana Ruiz",
    createdAt: "2026-03-02T09:00:00.000Z",
    updatedAt: "2026-03-16T09:00:00.000Z",
    resolvedAt: null,
    url: `https://acme.atlassian.net/browse/${overrides.key}`,
    sprintId: null,
    requiresCode: true,
    ...overrides,
  };
}

export function pullRequest(
  overrides: Partial<PullRequest> & { number: number },
): PullRequest {
  return {
    projectId: PROJECT_ID,
    title: `PR ${overrides.number}`,
    state: "open",
    author: "aruiz",
    createdAt: "2026-03-16T09:00:00.000Z",
    mergedAt: null,
    firstReviewAt: null,
    linkedIssueKeys: [],
    url: `https://github.com/acme/test/pull/${overrides.number}`,
    ...overrides,
  };
}

export function commit(overrides: Partial<Commit> & { sha: string }): Commit {
  return {
    projectId: PROJECT_ID,
    author: "aruiz",
    message: "chore: work",
    committedAt: "2026-03-16T09:00:00.000Z",
    linkedIssueKeys: [],
    url: `https://github.com/acme/test/commit/${overrides.sha}`,
    ...overrides,
  };
}

export function comment(
  overrides: Partial<IssueComment> & { id: string; issueKey: string },
): IssueComment {
  return {
    projectId: PROJECT_ID,
    author: "Ana Ruiz",
    body: "Looks good.",
    createdAt: "2026-03-16T09:00:00.000Z",
    url: `https://acme.atlassian.net/browse/${overrides.issueKey}?focusedCommentId=${overrides.id}`,
    ...overrides,
  };
}

export function doc(overrides: Partial<DocRef> & { slug: string }): DocRef {
  return {
    projectId: PROJECT_ID,
    title: overrides.slug,
    url: `https://docs.acme.dev/${overrides.slug}`,
    updatedAt: "2026-03-01T09:00:00.000Z",
    excerpt: "",
    ...overrides,
  };
}

export function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    project: PROJECT,
    now: NOW,
    issues: [],
    issueEvents: [] as readonly IssueEvent[],
    issueComments: [],
    pullRequests: [],
    commits: [],
    docs: [],
    ...overrides,
  };
}
