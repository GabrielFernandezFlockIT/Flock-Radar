import { describe, expect, it } from "vitest";

import { extractIssueKeys } from "./issue-keys";

const KNOWN = ["BCN", "ATL"];

describe("extractIssueKeys", () => {
  it("finds keys in PR titles and commit messages", () => {
    expect(extractIssueKeys("BCN-12: add rate limiting (BCN-7)", KNOWN)).toEqual([
      "BCN-12",
      "BCN-7",
    ]);
  });

  it("finds uppercase keys in branch names", () => {
    expect(extractIssueKeys("feature/BCN-123-retry-webhooks", KNOWN)).toEqual([
      "BCN-123",
    ]);
  });

  it("ignores lowercase look-alikes, even for known projects", () => {
    expect(extractIssueKeys("feature/bcn-123 and atl-4 notes", KNOWN)).toEqual([]);
    expect(extractIssueKeys("bump api-2 client; see web-10", ["API", "WEB"])).toEqual(
      [],
    );
  });

  it("ignores look-alikes from unknown projects", () => {
    expect(
      extractIssueKeys("Use UTF-8 and SHA-256 per ISO-8601 for ATL-3", KNOWN),
    ).toEqual(["ATL-3"]);
  });

  it("does not match keys glued to other letters or digits", () => {
    expect(extractIssueKeys("XBCN-1 BCN-12a 9ATL-4", KNOWN)).toEqual([]);
  });

  it("deduplicates and keeps first-occurrence order", () => {
    expect(extractIssueKeys("ATL-2, BCN-1, ATL-2 and BCN-1 again", KNOWN)).toEqual([
      "ATL-2",
      "BCN-1",
    ]);
  });

  it("separates adjacent keys", () => {
    expect(extractIssueKeys("BCN-1,BCN-2/ATL-3-BCN-4", KNOWN)).toEqual([
      "BCN-1",
      "BCN-2",
      "ATL-3",
      "BCN-4",
    ]);
  });

  it("normalizes leading zeros and rejects issue number zero", () => {
    expect(extractIssueKeys("BCN-007 BCN-0", KNOWN)).toEqual(["BCN-7"]);
  });

  it("returns nothing for empty text or no known projects", () => {
    expect(extractIssueKeys("", KNOWN)).toEqual([]);
    expect(extractIssueKeys("BCN-1", [])).toEqual([]);
  });
});
