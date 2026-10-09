import type { AlertExplanationInput } from "./alert";

/**
 * Number grounding (PROMPT §5.1, "math computes, the LLM explains").
 *
 * Generated prose may only contain numbers, dates, and record identifiers
 * that are derivable from the inputs the generator was given. This module is
 * pure: the adapter generates, this decides whether the result is usable.
 *
 * The checker is deliberately strict — anything it cannot tie back to an
 * input is reported — because the caller's fallback (regenerate once, then a
 * deterministic template) is cheap, while a confidently invented number in a
 * leadership cockpit is not.
 *
 * Accepted formatting variants of a grounded value:
 * - thousands separators: `1,200` grounds `1200`;
 * - percentages: `38%` grounds the unit-interval `0.38`, and vice versa;
 * - rounding at the precision written: `38%` grounds `0.3842`, `2.5` grounds
 *   `2.47`;
 * - sign: `13` grounds a driver of `-13` ("13 points removed");
 * - dates: every common rendering of an allowed ISO day, in English and in
 *   Spanish (`2026-10-22`, `Oct 22`, `October 22, 2026`, `22 de octubre de
 *   2026`, `22 oct`, `22/10/2026`, ...);
 * - ordinals: `22nd` is read as the number `22`.
 */

export interface GroundingInputs {
  /** Numeric values the text may use. */
  numbers: readonly number[];
  /** Record identifiers the text may cite (`BCN-123`, `#42`, a commit SHA). */
  identifiers: readonly string[];
  /** ISO days (`yyyy-mm-dd`) the text may name, in any common rendering. */
  dates: readonly string[];
  /** Input text. Word-shaped tokens with digits (`P85`, `Q4`) must appear here. */
  corpus: string;
}

export interface GroundingResult {
  grounded: boolean;
  /** Tokens the inputs do not back, in order of appearance, deduplicated. */
  ungrounded: string[];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * The UI and the generated prose are Spanish, so an allowed day may be
 * written with a Spanish month name. These are renderings of a day that is
 * already on the allow-list — they widen how a permitted date may be spelled,
 * never which dates are permitted.
 */
const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

/** `sep` for September; Spanish abbreviates it as `sept` too. */
const MONTH_ES_SHORT = [
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

/** `-?1,234,567.89` (thousands form first) or `-?1234.89`. */
const NUMBER_PATTERN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
const URL_PATTERN = /https?:\/\/\S+/gi;
const ORDINAL_PATTERN = /\b(\d+)(?:st|nd|rd|th)\b/gi;
/** `BCN-123`, `#42`, and SHAs (hex runs that contain at least one letter). */
const ISSUE_KEY_PATTERN = /\b[A-Za-z][A-Za-z0-9]*-\d+\b/g;
const PR_NUMBER_PATTERN = /#\d+\b/g;
const SHA_PATTERN = /\b(?=[0-9a-f]{7,40}\b)(?=\d*[a-f])[0-9a-f]{7,40}\b/gi;
/** A word that mixes letters and digits: `P85`, `Q4`, `v2`, `H1`. */
const WORD_WITH_DIGITS_PATTERN = /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]+\b/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every common rendering of one ISO day, longest first. */
export function dateRenderings(isoDay: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!match) return [];
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return [];
  const short = monthName.slice(0, 3);
  const dayNumber = String(Number(day));

  const renderings = new Set<string>([
    isoDay,
    `${monthName} ${dayNumber}, ${year}`,
    `${monthName} ${day}, ${year}`,
    `${short} ${dayNumber}, ${year}`,
    `${short} ${day}, ${year}`,
    `${monthName} ${dayNumber} ${year}`,
    `${short} ${dayNumber} ${year}`,
    `${dayNumber} ${monthName} ${year}`,
    `${dayNumber} ${short} ${year}`,
    `${monthName} ${dayNumber}`,
    `${monthName} ${day}`,
    `${short} ${dayNumber}`,
    `${short} ${day}`,
    `${dayNumber} ${monthName}`,
    `${dayNumber} ${short}`,
    `${month}/${day}/${year}`,
    `${day}/${month}/${year}`,
    `${month}/${day}`,
    `${day}/${month}`,
  ]);

  // Spanish renderings of the same day.
  const monthEs = MONTHS_ES[Number(month) - 1];
  const shortEs = MONTH_ES_SHORT[Number(month) - 1];
  // September is abbreviated both `sep` and `sept` in Spanish.
  const aliases = shortEs === "sep" ? [monthEs, shortEs, "sept"] : [monthEs, shortEs];
  for (const name of aliases) {
    renderings.add(`${dayNumber} de ${name} de ${year}`);
    renderings.add(`${day} de ${name} de ${year}`);
    renderings.add(`${dayNumber} de ${name}`);
    renderings.add(`${day} de ${name}`);
    renderings.add(`${dayNumber} ${name} ${year}`);
    renderings.add(`${dayNumber} ${name}`);
    renderings.add(`${day} ${name}`);
  }

  return [...renderings].sort((a, b) => b.length - a.length);
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/^#/, "");
}

function parseNumberToken(token: string): number {
  return Number(token.replace(/,/g, ""));
}

function decimalsOf(token: string): number {
  const dot = token.indexOf(".");
  return dot === -1 ? 0 : token.length - dot - 1;
}

/** Numbers written in `text`, normalized (thousands separators removed). */
export function extractNumbers(text: string): number[] {
  return [...text.matchAll(NUMBER_PATTERN)]
    .map((match) => parseNumberToken(match[0]))
    .filter((value) => Number.isFinite(value));
}

function matchesAllowed(
  value: number,
  decimals: number,
  isPercent: boolean,
  allowed: readonly number[],
): boolean {
  // Tolerate rounding at the precision the text was written with.
  const tolerance = Math.max(0.5 * 10 ** -decimals, 1e-9);
  return allowed.some((candidate) => {
    const variants = [candidate];
    // A unit-interval input (confidence, probability) may be written as a
    // percentage; a percentage in the text may come from such an input.
    if (Math.abs(candidate) <= 1) variants.push(candidate * 100);
    if (isPercent) variants.push(candidate * 100);
    return variants.some(
      (variant) =>
        Math.abs(variant - value) <= tolerance ||
        Math.abs(Math.abs(variant) - Math.abs(value)) <= tolerance,
    );
  });
}

/**
 * Reports every number, date, or identifier in `text` that `inputs` does not
 * back. `grounded` is true only when nothing is left unexplained.
 */
export function checkGrounding(
  text: string,
  inputs: GroundingInputs,
): GroundingResult {
  const ungrounded: string[] = [];
  const seen = new Set<string>();
  const report = (token: string): void => {
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ungrounded.push(token);
  };

  const identifiers = new Set(inputs.identifiers.map(normalizeIdentifier));
  const corpus = inputs.corpus.toLowerCase();

  // 1. URLs are citations, not prose; their digits are not claims.
  let remaining = text.replace(URL_PATTERN, " ");

  // 2. Remove every rendering of an allowed day, longest rendering first, so
  //    `October 22, 2026` never decomposes into the bare numbers 22 and 2026.
  const renderings = [...new Set(inputs.dates.flatMap(dateRenderings))].sort(
    (a, b) => b.length - a.length,
  );
  for (const rendering of renderings) {
    remaining = remaining.replace(new RegExp(escapeRegExp(rendering), "gi"), " ");
  }

  // 3. `22nd` is the number 22.
  remaining = remaining.replace(ORDINAL_PATTERN, "$1 ");

  // 4. Record identifiers must be ones we handed the generator.
  for (const pattern of [ISSUE_KEY_PATTERN, PR_NUMBER_PATTERN, SHA_PATTERN]) {
    remaining = remaining.replace(new RegExp(pattern.source, pattern.flags), (token) => {
      if (!identifiers.has(normalizeIdentifier(token))) report(token);
      return " ";
    });
  }

  // 5. Word-shaped tokens with digits (`P85`, `Q4`) are only allowed when the
  //    inputs actually use that word.
  remaining = remaining.replace(WORD_WITH_DIGITS_PATTERN, (token) => {
    if (!corpus.includes(token.toLowerCase()) && !identifiers.has(normalizeIdentifier(token))) {
      report(token);
    }
    return " ";
  });

  // 6. Whatever numbers are left are claims and must come from the inputs.
  for (const match of remaining.matchAll(NUMBER_PATTERN)) {
    const token = match[0];
    const value = parseNumberToken(token);
    if (!Number.isFinite(value)) continue;
    const after = remaining.slice(match.index + token.length);
    const isPercent = /^\s*%/.test(after);
    if (!matchesAllowed(value, decimalsOf(token), isPercent, inputs.numbers)) {
      report(isPercent ? `${token}%` : token);
    }
  }

  return { grounded: ungrounded.length === 0, ungrounded };
}

/** Builds the allow-list from the exact input an explanation was asked for. */
export function collectGroundingInputs(
  input: AlertExplanationInput,
): GroundingInputs {
  const texts = [
    input.title,
    input.project.name,
    input.project.clientName,
    input.project.budgetCurrency,
    ...input.drivers.flatMap((driver) => [
      driver.label,
      driver.detail ?? "",
      driver.unit ?? "",
    ]),
    ...input.evidence.flatMap((evidence) => [evidence.label ?? "", evidence.externalId]),
  ];
  const corpus = texts.join(" ");

  const numbers = [
    ...input.drivers.map((driver) => driver.value),
    input.confidence,
    input.project.budgetAmount,
    // Numbers written into labels and details are inputs too ("38% of 13 pts").
    ...extractNumbers(corpus),
  ];

  const dates = [
    ...(input.eta === null ? [] : [input.eta]),
    input.project.startDate,
    input.project.endDate,
    ...input.evidence.map((evidence) => evidence.occurredAt.slice(0, 10)),
    ...(corpus.match(/\d{4}-\d{2}-\d{2}/g) ?? []),
  ];

  const identifiers = input.evidence.map((evidence) => evidence.externalId);

  return { numbers, identifiers, dates, corpus };
}
