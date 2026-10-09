import { z } from "zod";

import {
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  UuidSchema,
} from "./primitives";
import {
  DAY_MS,
  HOUR_MS,
  eachDayOfRange,
  fromIsoDate,
  isWeekend,
  type DateRange,
} from "./time";

export const CALENDAR_EVENT_KINDS = ["pto", "meeting", "holiday"] as const;
export const CalendarEventKindSchema = z.enum(CALENDAR_EVENT_KINDS);
export type CalendarEventKind = z.infer<typeof CalendarEventKindSchema>;

/**
 * A calendar entry that affects someone's availability. Team-wide holidays
 * are expanded by the calendar adapter into one event per person.
 */
export const CalendarEventFieldsSchema = z.object({
  person: NonEmptyStringSchema,
  start: IsoDateTimeSchema,
  end: IsoDateTimeSchema,
  kind: CalendarEventKindSchema,
  title: NonEmptyStringSchema,
});

/** Refined variant; derive new schemas from `CalendarEventFieldsSchema` (Zod 4). */
export const CalendarEventSchema = CalendarEventFieldsSchema.refine(
  (event) => Date.parse(event.start) < Date.parse(event.end),
  {
    message: "CalendarEvent.start must be before CalendarEvent.end",
    path: ["end"],
  },
);
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CAPACITY_REASONS = [
  "weekend",
  "holiday",
  "pto",
  "meetings",
] as const;
export const CapacityReasonSchema = z.enum(CAPACITY_REASONS);
export type CapacityReason = z.infer<typeof CapacityReasonSchema>;

export const CapacityEntrySchema = z.object({
  projectId: UuidSchema,
  person: NonEmptyStringSchema,
  date: IsoDateSchema,
  availableHours: NonNegativeNumberSchema,
  /** Why the day has less than a full day of hours; `null` for a normal day. */
  reason: CapacityReasonSchema.nullable(),
});
export type CapacityEntry = z.infer<typeof CapacityEntrySchema>;

export type PersonDayCapacity = Omit<CapacityEntry, "projectId">;

export const DEFAULT_HOURS_PER_DAY = 8;

interface Interval {
  start: number;
  end: number;
}

function unionMs(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let current: Interval | undefined;
  for (const interval of sorted) {
    if (!current || interval.start > current.end) {
      if (current) total += current.end - current.start;
      current = { ...interval };
    } else {
      current.end = Math.max(current.end, interval.end);
    }
  }
  if (current) total += current.end - current.start;
  return total;
}

function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/**
 * Turns calendar events into available hours per person per day.
 *
 * Rules (all days are UTC calendar days):
 * - Weekends (Saturday, Sunday) have 0 hours, reason `weekend`.
 * - On working days, every event overlapping the day removes the hours it
 *   overlaps, merged so overlapping events are not double counted, capped at
 *   `hoursPerDay`. An all-day PTO or holiday therefore leaves 0 hours, a
 *   two-hour meeting leaves `hoursPerDay - 2`.
 * - Reason priority: `holiday` > `pto` > `meetings` > `null`.
 * - Events of people not in `people` are ignored.
 *
 * Output is ordered by date, then by the order of `people` (deduplicated).
 */
export function capacityFromEvents(
  events: readonly CalendarEvent[],
  people: readonly string[],
  range: DateRange,
  hoursPerDay: number = DEFAULT_HOURS_PER_DAY,
): PersonDayCapacity[] {
  const roster = [...new Set(people)];
  const eventsByPerson = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = eventsByPerson.get(event.person);
    if (list) list.push(event);
    else eventsByPerson.set(event.person, [event]);
  }

  const entries: PersonDayCapacity[] = [];
  for (const date of eachDayOfRange(range)) {
    const dayStart = fromIsoDate(date).getTime();
    const dayEnd = dayStart + DAY_MS;
    const weekend = isWeekend(new Date(dayStart));

    for (const person of roster) {
      if (weekend) {
        entries.push({ person, date, availableHours: 0, reason: "weekend" });
        continue;
      }

      const busy: Interval[] = [];
      const kinds = new Set<CalendarEventKind>();
      for (const event of eventsByPerson.get(person) ?? []) {
        const start = Math.max(Date.parse(event.start), dayStart);
        const end = Math.min(Date.parse(event.end), dayEnd);
        if (end <= start) continue;
        busy.push({ start, end });
        kinds.add(event.kind);
      }

      const busyHours = Math.min(hoursPerDay, unionMs(busy) / HOUR_MS);
      const reason: CapacityReason | null = kinds.has("holiday")
        ? "holiday"
        : kinds.has("pto")
          ? "pto"
          : kinds.has("meeting")
            ? "meetings"
            : null;

      entries.push({
        person,
        date,
        availableHours: roundHours(hoursPerDay - busyHours),
        reason,
      });
    }
  }

  return entries;
}
