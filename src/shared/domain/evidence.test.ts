import { describe, expect, it } from "vitest";

import {
  EvidenceSchema,
  dedupeEvidence,
  restrictEvidenceTo,
  statusEvidenceUrl,
  withEvidence,
  type Evidence,
} from "./evidence";

const issue: Evidence = {
  sourceType: "jira_issue",
  externalId: "BCN-123",
  url: "https://demo.atlassian.net/browse/BCN-123",
  occurredAt: "2026-10-01T10:00:00.000Z",
};

const pr: Evidence = {
  sourceType: "github_pr",
  externalId: "#42",
  url: "https://github.com/demo-org/beacon-api/pull/42",
  occurredAt: "2026-10-02T10:00:00.000Z",
  label: "Add rate limiting",
};

describe("EvidenceSchema", () => {
  it("accepts a well-formed evidence pointer", () => {
    expect(EvidenceSchema.parse(pr)).toEqual(pr);
  });

  it("accepts an INTERNAL app path for a status-derived claim", () => {
    const status: Evidence = {
      sourceType: "status",
      externalId: "Nicolás Vega 2026-10-08",
      url: statusEvidenceUrl(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
      occurredAt: "2026-10-08T17:30:00.000Z",
    };
    expect(EvidenceSchema.parse(status)).toEqual(status);
  });

  it.each([
    ["a javascript: URL", { ...issue, url: "javascript:alert(1)" }],
    // A path with no leading slash is ambiguous, and a protocol-relative URL
    // resolves against ANOTHER origin: both stay rejected.
    ["a path without a leading slash", { ...issue, url: "browse/BCN-123" }],
    ["a protocol-relative URL", { ...issue, url: "//evil.test/x" }],
    ["a backslash-escaped origin", { ...issue, url: "/\\evil.test/x" }],
    ["an unknown source type", { ...issue, sourceType: "slack_message" }],
    ["an empty external id", { ...issue, externalId: " " }],
    ["a date without time", { ...issue, occurredAt: "2026-10-01" }],
  ])("rejects %s", (_label, candidate) => {
    expect(EvidenceSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("withEvidence", () => {
  it("drops items without evidence and keeps the rest in order", () => {
    const items = [
      { claim: "a", evidence: [issue] },
      { claim: "b", evidence: [] },
      { claim: "c", evidence: [pr, issue] },
    ];

    expect(withEvidence(items).map((item) => item.claim)).toEqual(["a", "c"]);
  });

  it("returns an empty list when nothing has evidence", () => {
    expect(withEvidence([{ evidence: [] }])).toEqual([]);
  });

  it("removes invalid evidence entries and drops items left without any", () => {
    const invalid = {
      sourceType: "doc",
      externalId: "",
      url: "javascript:alert(1)",
      occurredAt: "nope",
    } as unknown as Evidence;

    expect(withEvidence([{ claim: "x", evidence: [invalid] }])).toEqual([]);
    expect(withEvidence([{ claim: "y", evidence: [invalid, pr] }])).toEqual([
      { claim: "y", evidence: [pr] },
    ]);
  });
});

describe("restrictEvidenceTo", () => {
  it("keeps only evidence present in the allowed set", () => {
    const invented: Evidence = { ...pr, externalId: "#999", url: "https://github.com/demo-org/beacon-api/pull/999" };
    const claims = [
      { claim: "grounded", evidence: [issue, invented] },
      { claim: "invented only", evidence: [invented] },
      { claim: "fully grounded", evidence: [pr] },
    ];

    expect(restrictEvidenceTo(claims, [issue, pr])).toEqual([
      { claim: "grounded", evidence: [issue] },
      { claim: "fully grounded", evidence: [pr] },
    ]);
  });

  it("matches on source type, external id, and URL, ignoring labels and dates", () => {
    const sameRecord = { ...issue, label: "relabeled", occurredAt: "2026-10-05T10:00:00.000Z" };
    const otherUrl = { ...issue, url: "https://demo.atlassian.net/browse/BCN-124" };

    expect(restrictEvidenceTo([{ evidence: [sameRecord] }], [issue])).toHaveLength(1);
    expect(restrictEvidenceTo([{ evidence: [otherUrl] }], [issue])).toEqual([]);
  });

  it("drops everything when nothing is allowed", () => {
    expect(restrictEvidenceTo([{ evidence: [issue] }], [])).toEqual([]);
  });
});

describe("dedupeEvidence", () => {
  it("removes repeated pointers and keeps the first occurrence order", () => {
    const relabeled = { ...issue, label: "same record, other label" };
    expect(dedupeEvidence([issue, pr, relabeled, pr])).toEqual([issue, pr]);
  });

  it("keeps pointers that share an id but come from different sources", () => {
    const commit: Evidence = {
      ...issue,
      sourceType: "jira_transition",
    };
    expect(dedupeEvidence([issue, commit])).toHaveLength(2);
  });
});
