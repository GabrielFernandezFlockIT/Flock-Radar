import { describe, expect, it } from "vitest";

import { buildMemoryItems } from "./index";
import { commit, doc, issue, pullRequest, snapshot } from "./fixtures";
import { detectResolved } from "./resolved";
import { detectDecisions, detectRisks } from "./knowledge";
import { memoryItemId } from "./ids";

const RESOLVED_ISSUE = issue({
  key: "TST-1",
  title: "Guest checkout",
  status: "Done",
  statusCategory: "done",
  resolvedAt: "2026-03-17T16:00:00.000Z",
});

const MERGE_SHA = "d".repeat(40);

const FULL_CHAIN = snapshot({
  issues: [RESOLVED_ISSUE],
  pullRequests: [
    pullRequest({
      number: 42,
      state: "merged",
      mergedAt: "2026-03-17T15:45:00.000Z",
      linkedIssueKeys: ["TST-1"],
      mergeCommitSha: MERGE_SHA,
    }),
  ],
  commits: [
    commit({
      sha: MERGE_SHA,
      committedAt: "2026-03-17T15:45:00.000Z",
      message: "Merge pull request #42 from acme/tst-1",
      linkedIssueKeys: ["TST-1"],
    }),
  ],
});

describe("resolved work", () => {
  it("assembles the evidence chain issue -> PR -> merge commit, in order", () => {
    const [item] = detectResolved(FULL_CHAIN);
    expect(item.kind).toBe("done");
    expect(item.status).toBe("resolved");
    expect(item.summary).toContain("TST-1");
    expect(item.summary).toContain("mediante la PR #42");
    expect(item.evidence.map((entry) => entry.sourceType)).toEqual([
      "jira_issue",
      "github_pr",
      "github_commit",
    ]);
    expect(item.evidence.map((entry) => entry.externalId)).toEqual([
      "TST-1",
      "#42",
      "ddddddd",
    ]);
  });

  it("ignores work resolved before the window", () => {
    const old = { ...RESOLVED_ISSUE, resolvedAt: "2026-02-01T16:00:00.000Z" };
    expect(detectResolved(snapshot({ issues: [old] }))).toEqual([]);
  });
});

describe("decisions and risks", () => {
  it("turns ADR documents into decision items and leaves runbooks alone", () => {
    const items = detectDecisions(
      snapshot({
        docs: [
          doc({ slug: "tst-adr-003-partitions", title: "ADR-003: Partition fact tables" }),
          doc({ slug: "tst-runbook-nightly", title: "Runbook: nightly failures" }),
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("decision");
    expect(items[0].evidence[0].externalId).toBe("tst-adr-003-partitions");
  });

  it("raises a risk only from a blocked comment on an unfinished issue", () => {
    const blocked = issue({
      key: "TST-5",
      status: "In Progress",
      statusCategory: "in_progress",
    });
    const items = detectRisks(
      snapshot({
        issues: [blocked],
        issueComments: [
          {
            projectId: blocked.projectId,
            issueKey: "TST-5",
            id: "200",
            author: "Ana Ruiz",
            body: "Blocked on the carrier sandbox credentials.",
            createdAt: "2026-03-13T11:00:00.000Z",
            url: "https://acme.atlassian.net/browse/TST-5?focusedCommentId=200",
          },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("risk");
    expect(detectRisks(snapshot({ issues: [blocked] }))).toEqual([]);
  });
});

describe("deterministic ids", () => {
  it("derives the same id from the same project, kind, and record key", () => {
    const first = buildMemoryItems(FULL_CHAIN).items;
    const second = buildMemoryItems(FULL_CHAIN).items;
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
    expect(first[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("separates record keys that would otherwise concatenate the same way", () => {
    expect(memoryItemId("a", "bc")).not.toBe(memoryItemId("ab", "c"));
  });
});
