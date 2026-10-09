import { z } from "zod";

import { IsoDateSchema, type IsoDate } from "./primitives";

/**
 * Pure calendar helpers. Every calculation is in UTC so results never depend
 * on the host time zone; working days are Monday to Friday.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** Inclusive range of calendar days. */
export const DateRangeFieldsSchema = z.object({
  start: IsoDateSchema,
  end: IsoDateSchema,
});

/** Refined variant; derive new schemas from `DateRangeFieldsSchema` (Zod 4). */
export const DateRangeSchema = DateRangeFieldsSchema.refine(
  (range) => range.start <= range.end,
  { message: "DateRange.start must be on or before DateRange.end" },
);
export type DateRange = z.infer<typeof DateRangeSchema>;

/** `YYYY-MM-DD` of the UTC day containing `date`. */
export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC of an ISO date. */
export function fromIsoDate(isoDate: IsoDate): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isWorkingDay(date: Date): boolean {
  return !isWeekend(date);
}

/**
 * Moves `count` working days from `date` (positive: forward, negative:
 * backward). The starting day itself is never counted.
 */
export function addWorkingDays(date: Date, count: number): Date {
  const step = count >= 0 ? 1 : -1;
  let remaining = Math.abs(count);
  let cursor = startOfUtcDay(date);
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (isWorkingDay(cursor)) remaining -= 1;
  }
  return cursor;
}

/** Every calendar day in the inclusive range, as ISO dates. */
export function eachDayOfRange(range: DateRange): IsoDate[] {
  const days: IsoDate[] = [];
  const end = fromIsoDate(range.end).getTime();
  for (
    let cursor = fromIsoDate(range.start);
    cursor.getTime() <= end;
    cursor = addDays(cursor, 1)
  ) {
    days.push(toIsoDate(cursor));
  }
  return days;
}

/** Working days (Mon-Fri) in the inclusive range, as ISO dates. */
export function workingDaysOfRange(range: DateRange): IsoDate[] {
  return eachDayOfRange(range).filter((day) => isWorkingDay(fromIsoDate(day)));
}

/** Milliseconds two half-open intervals `[aStart, aEnd)` and `[bStart, bEnd)` share. */
export function overlapMs(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}
