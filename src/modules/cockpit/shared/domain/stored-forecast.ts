import { z } from "zod";

/**
 * Readers for the forecast documents the spine stores opaquely
 * (`Forecast.inputs` / `Forecast.result` are `unknown` on purpose, so the
 * engine can evolve without a migration).
 *
 * The cockpit therefore parses them defensively: unknown keys are ignored,
 * missing series degrade to `null`, and a document the UI cannot read renders
 * an empty state instead of crashing the page. Cumulative projection fields
 * are accepted under both the short (`p50`) and the long (`cumulativeP50`)
 * names, so a rename in the engine never blanks the chart.
 */

const nullableNumber = z.number().finite().nullable().catch(null);
const numberOr = (fallback: number) => z.number().finite().catch(fallback);

/** Reads `key`, then `aliases`, and keeps the first numeric (or null) value. */
function pickNumber(
  source: Record<string, unknown>,
  key: string,
  ...aliases: string[]
): number | null {
  for (const candidate of [key, ...aliases]) {
    const value = source[candidate];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value === null) return null;
  }
  return null;
}

const BurnUpPointSchema = z
  .looseObject({ date: z.string().min(1) })
  .transform((point) => ({
    date: point.date,
    scope: pickNumber(point, "scope") ?? 0,
    done: pickNumber(point, "done", "cumulativeDone"),
    p50: pickNumber(point, "p50", "cumulativeP50"),
    p85: pickNumber(point, "p85", "cumulativeP85"),
  }));

export type BurnUpPointView = z.infer<typeof BurnUpPointSchema>;

const SprintRefSchema = z
  .object({
    id: z.string().catch(""),
    name: z.string().catch(""),
    startDate: z.string().catch(""),
    endDate: z.string().catch(""),
  })
  .partial()
  .nullable()
  .catch(null);

export const SprintCompletionViewSchema = z.looseObject({
  asOf: z.string().catch(""),
  unit: z.enum(["points", "issues"]).catch("points"),
  unitFallback: z.boolean().catch(false),
  sprint: SprintRefSchema,
  committed: numberOr(0),
  scope: numberOr(0),
  done: numberOr(0),
  remaining: numberOr(0),
  remainingWorkingDays: numberOr(0),
  probability: nullableNumber,
  expectedCompletionDate: z.string().nullable().catch(null),
  p50Date: z.string().nullable().catch(null),
  p85Date: z.string().nullable().catch(null),
  burnUp: z.array(BurnUpPointSchema).catch([]),
});

export type SprintCompletionView = z.infer<typeof SprintCompletionViewSchema>;

const BudgetSeriesPointSchema = z
  .looseObject({ date: z.string().min(1) })
  .transform((point) => ({
    date: point.date,
    actual: pickNumber(point, "actual", "cumulativeActual"),
    projected: pickNumber(point, "projected", "cumulativeProjected"),
    plan: pickNumber(point, "plan", "cumulativePlan") ?? 0,
  }));

export type BudgetSeriesPointView = z.infer<typeof BudgetSeriesPointSchema>;

export const BudgetRunwayViewSchema = z.looseObject({
  asOf: z.string().catch(""),
  currency: z.string().min(1).catch("USD"),
  budget: numberOr(0),
  spent: numberOr(0),
  spentHours: numberOr(0),
  remaining: numberOr(0),
  dailyBurn: numberOr(0),
  dailyBurnHours: numberOr(0),
  exhaustionDate: z.string().nullable().catch(null),
  alreadyExhausted: z.boolean().catch(false),
  endDate: z.string().catch(""),
  daysBeforeEnd: nullableNumber,
  projectedSpendAtEnd: numberOr(0),
  percentOverAtEnd: nullableNumber,
  series: z.array(BudgetSeriesPointSchema).catch([]),
});

export type BudgetRunwayView = z.infer<typeof BudgetRunwayViewSchema>;

export function readSprintCompletion(result: unknown): SprintCompletionView | null {
  const parsed = SprintCompletionViewSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export function readBudgetRunway(result: unknown): BudgetRunwayView | null {
  const parsed = BudgetRunwayViewSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}
