import { describe, expect, it } from "vitest";

import { EvidenceListSchema, MemoryItemSchema } from "@/shared/domain";

import { comment, commit, issue, pullRequest, snapshot } from "./fixtures";
import {
  detectDoneWithoutMergedPr,
  detectMergedPrWithoutClosedIssue,
  detectStalledIssues,
  detectStuckPullRequests,
  detectUnansweredQuestions,
} from "./pending";

/**
 * One positive and one negative case per rule. Each positive case also
 * asserts the item is a valid, evidence-backed `MemoryItem`, because an item
 * that does not validate never reaches the repository.
 */

function expectOneValidItem(items: ReturnType<typeof detectStalledIssues>) {
  expect(items).toHaveLength(1);
  expect(() => MemoryItemSchema.parse(items[0])).not.toThrow();
  expect(() => EvidenceListSchema.parse(items[0].evidence)).not.toThrow();
  return items[0];
}

const DONE_ISSUE = issue({
  key: "TST-1",
  status: "Done",
  statusCategory: "done",
  resolvedAt: "2026-03-17T16:00:00.000Z",
});

describe("rule: done without a merged PR", () => {
  it("flags a Done code issue whose only trace is a direct commit", () => {
    const items = detectDoneWithoutMergedPr(
      snapshot({
        issues: [DONE_ISSUE],
        commits: [commit({ sha: "a".repeat(40), linkedIssueKeys: ["TST-1"] })],
      }),
    );
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("TST-1");
    expect(item.evidence.map((entry) => entry.externalId)).toEqual(["TST-1", "aaaaaaa"]);
  });

  it("stays silent when a merged PR references the issue", () => {
    const items = detectDoneWithoutMergedPr(
      snapshot({
        issues: [DONE_ISSUE],
        pullRequests: [
          pullRequest({
            number: 7,
            state: "merged",
            mergedAt: "2026-03-17T15:45:00.000Z",
            linkedIssueKeys: ["TST-1"],
          }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it("stays silent for an issue whose type does not ship code", () => {
    const items = detectDoneWithoutMergedPr(
      snapshot({ issues: [{ ...DONE_ISSUE, type: "Spike", requiresCode: false }] }),
    );
    expect(items).toEqual([]);
  });
});

describe("rule: merged PR without a closed issue", () => {
  it("flags a merged PR that references no issue", () => {
    const items = detectMergedPrWithoutClosedIssue(
      snapshot({
        pullRequests: [
          pullRequest({
            number: 9,
            title: "Hotfix: raise upstream timeout",
            state: "merged",
            mergedAt: "2026-03-16T16:00:00.000Z",
          }),
        ],
      }),
    );
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("PR #9");
    expect(item.evidence[0].externalId).toBe("#9");
  });

  it("flags a merged PR whose issue never reached done", () => {
    const items = detectMergedPrWithoutClosedIssue(
      snapshot({
        issues: [issue({ key: "TST-2", status: "In Review", statusCategory: "in_progress" })],
        pullRequests: [
          pullRequest({
            number: 10,
            state: "merged",
            mergedAt: "2026-03-16T16:00:00.000Z",
            linkedIssueKeys: ["TST-2"],
          }),
        ],
      }),
    );
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("TST-2 sigue en In Review");
  });

  it("stays silent when the linked issue is done", () => {
    const items = detectMergedPrWithoutClosedIssue(
      snapshot({
        issues: [DONE_ISSUE],
        pullRequests: [
          pullRequest({
            number: 11,
            state: "merged",
            mergedAt: "2026-03-17T15:45:00.000Z",
            linkedIssueKeys: ["TST-1"],
          }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });
});

describe("rule: stuck pull requests", () => {
  it("flags a PR waiting more than 48 h for a first review", () => {
    const items = detectStuckPullRequests(
      snapshot({
        pullRequests: [pullRequest({ number: 12, createdAt: "2026-03-15T12:00:00.000Z" })],
      }),
    );
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("72 h esperando una primera revisión");
  });

  it("flags a reviewed PR that has stayed open past the age threshold", () => {
    const items = detectStuckPullRequests(
      snapshot({
        pullRequests: [
          pullRequest({
            number: 13,
            createdAt: "2026-03-05T09:00:00.000Z",
            firstReviewAt: "2026-03-05T14:00:00.000Z",
          }),
        ],
      }),
    );
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("13 días abierta");
  });

  it("stays silent for a fresh, unreviewed PR", () => {
    const items = detectStuckPullRequests(
      snapshot({
        pullRequests: [pullRequest({ number: 14, createdAt: "2026-03-17T12:00:00.000Z" })],
      }),
    );
    expect(items).toEqual([]);
  });
});

describe("rule: stalled in-progress issues", () => {
  const stalled = issue({
    key: "TST-3",
    status: "In Progress",
    statusCategory: "in_progress",
  });

  it("flags an in-progress issue with no linked commit for 5+ working days", () => {
    const items = detectStalledIssues(
      snapshot({
        issues: [stalled],
        commits: [
          commit({
            sha: "b".repeat(40),
            committedAt: "2026-03-09T09:00:00.000Z",
            linkedIssueKeys: ["TST-3"],
          }),
        ],
      }),
    );
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("sin commits vinculados desde hace 6 días hábiles");
  });

  it("stays silent when a commit landed yesterday", () => {
    const items = detectStalledIssues(
      snapshot({
        issues: [stalled],
        commits: [
          commit({
            sha: "c".repeat(40),
            committedAt: "2026-03-17T09:00:00.000Z",
            linkedIssueKeys: ["TST-3"],
          }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });
});

describe("rule: unanswered questions", () => {
  const question = comment({
    id: "100",
    issueKey: "TST-4",
    author: "Ana Ruiz",
    body: "Should saved carts expire after 30 days?",
    createdAt: "2026-03-15T09:00:00.000Z",
  });
  const issues = [issue({ key: "TST-4" })];

  it("flags a question nobody else answered for more than 48 h", () => {
    const items = detectUnansweredQuestions(snapshot({ issues, issueComments: [question] }));
    const item = expectOneValidItem(items);
    expect(item.summary).toContain("Ana Ruiz hizo una pregunta en TST-4");
    expect(item.evidence[0].sourceType).toBe("jira_comment");
  });

  it("stays silent once another author replied", () => {
    const items = detectUnansweredQuestions(
      snapshot({
        issues,
        issueComments: [
          question,
          comment({
            id: "101",
            issueKey: "TST-4",
            author: "Bruno Diaz",
            body: "They expire after 30 days.",
            createdAt: "2026-03-15T11:00:00.000Z",
          }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it("keeps flagging when only the asker follows up", () => {
    const items = detectUnansweredQuestions(
      snapshot({
        issues,
        issueComments: [
          question,
          comment({
            id: "102",
            issueKey: "TST-4",
            author: "Ana Ruiz",
            body: "Pinging again.",
            createdAt: "2026-03-16T11:00:00.000Z",
          }),
        ],
      }),
    );
    expect(items).toHaveLength(1);
  });
});
