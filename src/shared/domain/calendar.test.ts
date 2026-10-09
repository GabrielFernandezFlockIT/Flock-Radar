import { describe, expect, it } from "vitest";

import { capacityFromEvents, type CalendarEvent } from "./calendar";

// 2026-10-05 is a Monday; 2026-10-10/11 are Saturday/Sunday.
const WEEK = { start: "2026-10-05", end: "2026-10-11" };

function event(
  person: string,
  kind: CalendarEvent["kind"],
  start: string,
  end: string,
): CalendarEvent {
  return { person, kind, start, end, title: `${kind} for ${person}` };
}

function hoursOf(
  entries: ReturnType<typeof capacityFromEvents>,
  person: string,
  date: string,
) {
  return entries.find((entry) => entry.person === person && entry.date === date);
}

describe("capacityFromEvents", () => {
  it("gives every person a full day on working days and 0h on weekends", () => {
    const entries = capacityFromEvents([], ["ana", "bo"], WEEK);

    expect(entries).toHaveLength(14);
    expect(hoursOf(entries, "ana", "2026-10-05")).toEqual({
      person: "ana",
      date: "2026-10-05",
      availableHours: 8,
      reason: null,
    });
    expect(hoursOf(entries, "bo", "2026-10-10")).toMatchObject({
      availableHours: 0,
      reason: "weekend",
    });
    expect(hoursOf(entries, "bo", "2026-10-11")).toMatchObject({
      availableHours: 0,
      reason: "weekend",
    });
  });

  it("zeroes days covered by multi-day PTO", () => {
    const entries = capacityFromEvents(
      [event("ana", "pto", "2026-10-06T00:00:00Z", "2026-10-08T00:00:00Z")],
      ["ana"],
      WEEK,
    );

    expect(hoursOf(entries, "ana", "2026-10-05")?.availableHours).toBe(8);
    expect(hoursOf(entries, "ana", "2026-10-06")).toMatchObject({
      availableHours: 0,
      reason: "pto",
    });
    expect(hoursOf(entries, "ana", "2026-10-07")).toMatchObject({
      availableHours: 0,
      reason: "pto",
    });
    expect(hoursOf(entries, "ana", "2026-10-08")?.availableHours).toBe(8);
  });

  it("zeroes holidays and prefers the holiday reason over PTO", () => {
    const entries = capacityFromEvents(
      [
        event("ana", "holiday", "2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z"),
        event("ana", "pto", "2026-10-09T00:00:00Z", "2026-10-10T00:00:00Z"),
      ],
      ["ana"],
      WEEK,
    );

    expect(hoursOf(entries, "ana", "2026-10-09")).toMatchObject({
      availableHours: 0,
      reason: "holiday",
    });
  });

  it("subtracts meeting hours without double counting overlaps", () => {
    const entries = capacityFromEvents(
      [
        event("ana", "meeting", "2026-10-05T10:00:00Z", "2026-10-05T12:00:00Z"),
        event("ana", "meeting", "2026-10-05T11:00:00Z", "2026-10-05T12:30:00Z"),
        event("ana", "meeting", "2026-10-05T15:00:00Z", "2026-10-05T15:15:00Z"),
      ],
      ["ana"],
      WEEK,
    );

    // 10:00-12:30 (2.5h) + 15:00-15:15 (0.25h) = 2.75h busy
    expect(hoursOf(entries, "ana", "2026-10-05")).toMatchObject({
      availableHours: 5.25,
      reason: "meetings",
    });
  });

  it("subtracts partial-day PTO and never goes below zero", () => {
    const entries = capacityFromEvents(
      [
        event("ana", "pto", "2026-10-07T13:00:00Z", "2026-10-07T17:00:00Z"),
        event("bo", "meeting", "2026-10-07T00:00:00Z", "2026-10-07T12:00:00Z"),
      ],
      ["ana", "bo"],
      WEEK,
    );

    expect(hoursOf(entries, "ana", "2026-10-07")).toMatchObject({
      availableHours: 4,
      reason: "pto",
    });
    expect(hoursOf(entries, "bo", "2026-10-07")).toMatchObject({
      availableHours: 0,
      reason: "meetings",
    });
  });

  it("clips events that span midnight to each day", () => {
    const entries = capacityFromEvents(
      [event("ana", "meeting", "2026-10-05T23:00:00Z", "2026-10-06T01:00:00Z")],
      ["ana"],
      WEEK,
    );

    expect(hoursOf(entries, "ana", "2026-10-05")?.availableHours).toBe(7);
    expect(hoursOf(entries, "ana", "2026-10-06")?.availableHours).toBe(7);
  });

  it("ignores events of people outside the roster and deduplicates people", () => {
    const entries = capacityFromEvents(
      [event("zed", "pto", "2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z")],
      ["ana", "ana"],
      { start: "2026-10-05", end: "2026-10-05" },
    );

    expect(entries).toEqual([
      { person: "ana", date: "2026-10-05", availableHours: 8, reason: null },
    ]);
  });

  it("supports a custom working-day length", () => {
    const entries = capacityFromEvents(
      [event("ana", "meeting", "2026-10-05T09:00:00Z", "2026-10-05T10:00:00Z")],
      ["ana"],
      { start: "2026-10-05", end: "2026-10-05" },
      6,
    );

    expect(entries[0].availableHours).toBe(5);
  });
});
