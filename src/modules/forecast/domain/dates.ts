import {
  DAY_MS,
  addDays,
  fromIsoDate,
  isWorkingDay,
  startOfUtcDay,
  toIsoDate,
  type IsoDate,
} from "@/shared/domain";

/**
 * Working-day helpers for the forecast engine (UTC, Monday to Friday, like
 * `@/shared/domain/time`). Holidays are not working-day exceptions here: they
 * reduce capacity through the calendar instead.
 */

/** UTC day of an ISO instant. */
export function dayOf(instant: string): IsoDate {
  return toIsoDate(new Date(instant));
}

/** Last instant (exclusive bound) of a UTC day: the next midnight. */
export function endOfDayMs(day: IsoDate): number {
  return fromIsoDate(day).getTime() + DAY_MS;
}

/** The day itself when it is a working day, else the previous working day. */
export function workingDayOnOrBefore(day: IsoDate): IsoDate {
  let cursor = fromIsoDate(day);
  while (!isWorkingDay(cursor)) cursor = addDays(cursor, -1);
  return toIsoDate(cursor);
}

/**
 * `count` consecutive working days starting at `from` (included when it is a
 * working day).
 */
export function workingDaysFrom(from: Date, count: number): IsoDate[] {
  const days: IsoDate[] = [];
  for (
    let cursor = startOfUtcDay(from);
    days.length < count;
    cursor = addDays(cursor, 1)
  ) {
    if (isWorkingDay(cursor)) days.push(toIsoDate(cursor));
  }
  return days;
}

/** Working days strictly after `instant`'s UTC day and strictly before `today`. */
export function fullWorkingDaysBetween(instant: string, today: Date): number {
  let count = 0;
  const end = startOfUtcDay(today).getTime();
  for (
    let cursor = addDays(startOfUtcDay(new Date(instant)), 1);
    cursor.getTime() < end;
    cursor = addDays(cursor, 1)
  ) {
    if (isWorkingDay(cursor)) count += 1;
  }
  return count;
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / DAY_MS,
  );
}

const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/** `14 oct`: locale-independent, so titles are identical on every host. */
export function formatShortDate(day: IsoDate): string {
  const date = fromIsoDate(day);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** Rounds to `digits` decimals (half away from zero for positives). */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Population mean and coefficient of variation (stdev / mean; 0 when the mean is 0). */
export function meanAndCv(values: readonly number[]): { mean: number; cv: number } {
  if (values.length === 0) return { mean: 0, cv: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean === 0) return { mean, cv: 0 };
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, cv: Math.sqrt(variance) / mean };
}
