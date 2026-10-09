/**
 * Display formatting for the cockpit.
 *
 * Every formatter pins the locale and the UTC time zone: the same value must
 * render identically on the server and on the client (React would otherwise
 * flag a hydration mismatch) and on every host.
 */

const LOCALE = "es-AR";

const DAY_FORMATTER = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DAY_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const TIME_FORMATTER = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** `14 oct` from an ISO day (`2026-10-14`). */
export function formatDay(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? day : DAY_FORMATTER.format(parsed);
}

/** `14 de oct de 2026` from an ISO day. */
export function formatDayWithYear(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? day : DAY_WITH_YEAR_FORMATTER.format(parsed);
}

/** `14 oct, 09:30 UTC` from an ISO instant. */
export function formatInstant(instant: string): string {
  const parsed = Date.parse(instant);
  return Number.isNaN(parsed) ? instant : `${TIME_FORMATTER.format(parsed)} UTC`;
}

/** `62%` from a 0..1 ratio. */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Unknown currency code: never let formatting break a page.
    return `${Math.round(amount).toLocaleString(LOCALE)} ${currency}`;
  }
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Whole days from `fromIso` to `toDay`, negative when the day is in the past. */
export function daysUntil(fromIso: string, toDay: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/** `en 3 días` / `hoy` / `hace 4 días`, from a whole-day distance. */
export function formatDayDistance(days: number): string {
  if (days === 0) return "hoy";
  const magnitude = Math.abs(days);
  const unit = magnitude === 1 ? "día" : "días";
  return days > 0 ? `en ${magnitude} ${unit}` : `hace ${magnitude} ${unit}`;
}

/** `hace 2 horas`, coarse, from an ISO instant to an ISO instant. */
export function formatAgo(instant: string, now: string): string {
  const then = Date.parse(instant);
  const reference = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(reference)) return formatInstant(instant);
  const minutes = Math.max(0, Math.round((reference - then) / 60_000));
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

const TITLE_CASE_EXCEPTIONS: Readonly<Record<string, string>> = {
  wip: "WIP",
  pr: "PR",
  eta: "ETA",
};

/** `sprint_goal_risk` -> `Sprint goal risk`. */
export function humanizeKey(key: string): string {
  const words = key.split(/[_\-\s]+/).filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((word, index) => {
      const special = TITLE_CASE_EXCEPTIONS[word.toLowerCase()];
      if (special) return special;
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}
