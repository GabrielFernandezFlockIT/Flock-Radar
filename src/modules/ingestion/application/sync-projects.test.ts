import { describe, expect, it } from "vitest";

import type { Sprint } from "@/shared/domain";
import {
  RepositoryConstraintError,
  SourceUnavailableError,
} from "@/shared/ports";

import { capacityWindow, describeSyncFailure } from "./sync-projects";

// End-to-end sync behavior (idempotency, outages) is covered with the demo
// adapters in src/adapters/demo/demo-pipeline.test.ts, because application
// code and its tests may not import adapters.

const sprint = (startAt: string, endAt: string): Sprint => ({
  id: "6f1c3b0e-7a52-5c1e-9c51-2d8f0e7a4b10",
  projectId: "6f1c3b0e-7a52-5c1e-9c51-2d8f0e7a4b11",
  externalId: "1",
  name: "Sprint 1",
  goal: null,
  startAt,
  endAt,
  state: "active",
  committedPoints: 20,
});

describe("capacityWindow", () => {
  const now = new Date("2026-10-08T15:00:00Z");

  it("covers the next 14 days when there is no active sprint", () => {
    expect(capacityWindow(null, now)).toEqual({
      start: "2026-10-08",
      end: "2026-10-22",
    });
  });

  it("extends back to the start of the active sprint", () => {
    expect(
      capacityWindow(
        sprint("2026-10-01T09:00:00Z", "2026-10-14T18:00:00Z"),
        now,
      ),
    ).toEqual({ start: "2026-10-01", end: "2026-10-22" });
  });

  it("extends forward to the end of a long active sprint", () => {
    expect(
      capacityWindow(
        sprint("2026-10-05T09:00:00Z", "2026-10-30T18:00:00Z"),
        now,
      ),
    ).toEqual({ start: "2026-10-05", end: "2026-10-30" });
  });
});

describe("describeSyncFailure", () => {
  it("keeps the status and safe reason of a source failure", () => {
    expect(
      describeSyncFailure(
        "jira",
        new SourceUnavailableError("jira", "unauthorized", { status: 401 }),
      ),
    ).toBe("jira: HTTP 401 unauthorized");
  });

  it("strips URLs and control characters from reasons", () => {
    expect(
      describeSyncFailure(
        "github",
        new SourceUnavailableError("github", "timeout\ncalling https://api.github.com/x?token=abc"),
      ),
    ).toBe("github: timeout calling [url]");
  });

  it("names repository constraints without echoing data", () => {
    expect(
      describeSyncFailure(
        "jira",
        new RepositoryConstraintError("issues_project_key", "secret-ish detail"),
      ),
    ).toBe("jira: rejected by the repository (issues_project_key)");
  });

  it("reduces unknown errors to their class name", () => {
    const error = new TypeError("fetch failed: https://user:pass@host/api <body>");
    expect(describeSyncFailure("docs", error)).toBe("docs: unexpected TypeError");
    expect(describeSyncFailure("docs", "raw string")).toBe("docs: unexpected error");
  });
});
