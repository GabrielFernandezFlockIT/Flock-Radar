import { describe, expect, it } from "vitest";

import type { Status } from "@/shared/domain";

import { groupStatusesByDay } from "./group-statuses";

function status(overrides: Partial<Status> & Pick<Status, "reportedOn" | "personId">): Status {
  return {
    id: `id-${overrides.personId}-${overrides.reportedOn}`,
    projectId: "project-1",
    teamId: "team-1",
    summary: "Avance",
    blockers: null,
    nextSteps: null,
    authorPersonId: overrides.personId,
    source: "manual",
    createdAt: "2026-10-08T17:30:00.000Z",
    updatedAt: "2026-10-08T17:30:00.000Z",
    ...overrides,
  };
}

describe("groupStatusesByDay", () => {
  it("groups by reported day, most recent first", () => {
    const groups = groupStatusesByDay([
      status({ reportedOn: "2026-10-06", personId: "ana" }),
      status({ reportedOn: "2026-10-07", personId: "ana" }),
      status({ reportedOn: "2026-10-08", personId: "ana" }),
    ]);

    expect(groups.map((group) => group.day)).toEqual([
      "2026-10-08",
      "2026-10-07",
      "2026-10-06",
    ]);
  });

  it("keeps same-day entries in input order", () => {
    const groups = groupStatusesByDay([
      status({ reportedOn: "2026-10-08", personId: "ana" }),
      status({ reportedOn: "2026-10-08", personId: "bruno" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.personId)).toEqual(["ana", "bruno"]);
  });

  it("returns nothing for an empty feed", () => {
    expect(groupStatusesByDay([])).toEqual([]);
  });
});
