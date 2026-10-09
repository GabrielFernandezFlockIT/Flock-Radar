import {
  addDays,
  startOfUtcDay,
  toIsoDate,
  workingDaysOfRange,
  type DetectorResult,
  type Driver,
  type Evidence,
  type Issue,
  type IsoDate,
  type Severity,
} from "@/shared/domain";

import {
  calendarDaysBetween,
  clamp,
  dayOf,
  formatShortDate,
  meanAndCv,
  round,
  workingDayOnOrBefore,
  workingDaysFrom,
} from "./dates";
import { worklogEvidence } from "./evidence";
import {
  DEFAULT_FORECAST_OPTIONS,
  insufficientDataDriver,
  type ForecastOptions,
  type ProjectSnapshot,
} from "./snapshot";

/**
 * Budget runway (decision D-039): spend = worklog hours x hourly rate; the
 * daily burn is an EWMA of hours per working day; the projection keeps that
 * burn constant from today on.
 */

/** Projections stop after this many working days (about 8 years). */
const MAX_PROJECTION_WORKING_DAYS = 2_000;

/**
 * Exponentially weighted moving average, seeded with the first value:
 * s0 = x0, s_t = alpha * x_t + (1 - alpha) * s_(t-1). Empty input -> 0.
 */
export function ewma(values: readonly number[], alpha: number): number {
  if (!(alpha > 0 && alpha <= 1)) throw new Error("ewma: alpha must be in (0, 1].");
  if (values.length === 0) return 0;
  let smoothed = values[0];
  for (let index = 1; index < values.length; index += 1) {
    smoothed = alpha * values[index] + (1 - alpha) * smoothed;
  }
  return smoothed;
}

export interface BudgetSeriesPoint {
  date: IsoDate;
  /** Actual cumulative spend at the end of the day (past working days). */
  actual: number | null;
  /** Projected cumulative spend (today onwards). */
  projected: number | null;
  /** Linear plan from the project start to its end date. */
  plan: number;
}

export interface BudgetRunwayForecast {
  asOf: IsoDate;
  currency: string;
  budget: number;
  hourlyRate: number;
  spent: number;
  spentHours: number;
  remaining: number;
  ewmaAlpha: number;
  /** EWMA of hours per working day, and the same in currency. */
  dailyBurnHours: number;
  dailyBurn: number;
  /** Mean of the recent window and of the days before it (hours/day). */
  recentDailyHours: number;
  earlierDailyHours: number;
  exhaustionDate: IsoDate | null;
  /** Already spent past the budget (exhaustion date is historical). */
  alreadyExhausted: boolean;
  endDate: IsoDate;
  /** Calendar days from exhaustion to the end date (positive = early). */
  daysBeforeEnd: number | null;
  projectedSpendAtEnd: number;
  /** (projected spend at end - budget) / budget, in percent (negative = under). */
  percentOverAtEnd: number | null;
  /** Daily hours of each working day in the burn history. */
  dailyHours: Array<{ date: IsoDate; hours: number }>;
  series: BudgetSeriesPoint[];
}

export interface BudgetRunwayOutcome {
  result: DetectorResult;
  forecast: BudgetRunwayForecast;
  inputs: {
    asOf: IsoDate;
    budget: number;
    hourlyRate: number;
    startDate: IsoDate;
    endDate: IsoDate;
    ewmaAlpha: number;
    worklogs: number;
    spentHours: number;
    dailyHours: number[];
  };
}

/**
 * Severity by how early the money runs out: already exhausted or >= 10
 * calendar days before the end date critical, >= 5 high, >= 2 medium, else low.
 */
export function budgetSeverity(daysBeforeEnd: number, alreadyExhausted: boolean): Severity {
  if (alreadyExhausted || daysBeforeEnd >= 10) return "critical";
  if (daysBeforeEnd >= 5) return "high";
  if (daysBeforeEnd >= 2) return "medium";
  return "low";
}

/**
 * Confidence: 0.9 x min(1, history days / 20) x (1 - CV of the recent
 * window's daily hours, floored at 0.5), clamped to [0.05, 0.95].
 */
export function budgetConfidence(historyDays: number, recentHours: readonly number[]): number {
  const historyFactor = Math.min(1, historyDays / 20);
  const { cv } = meanAndCv(recentHours);
  return round(clamp(0.9 * historyFactor * Math.max(0.5, 1 - cv), 0.05, 0.95));
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function forecastBudgetRunway(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): BudgetRunwayOutcome {
  const { project, now, worklogs } = snapshot;
  const today = startOfUtcDay(now);
  const asOf = toIsoDate(today);
  const rate = project.hourlyRate;
  const budget = project.budgetAmount;

  // Hours per working day (weekend logs count on the previous working day).
  const hoursByDay = new Map<IsoDate, number>();
  let spentHours = 0;
  let firstDay: IsoDate | null = null;
  for (const worklog of worklogs) {
    const hours = worklog.seconds / 3600;
    spentHours += hours;
    const day = workingDayOnOrBefore(dayOf(worklog.startedAt));
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
    if (firstDay === null || day < firstDay) firstDay = day;
  }
  const spent = spentHours * rate;

  // History: every working day from the project (or first log) to yesterday.
  const historyStart =
    firstDay !== null && firstDay < project.startDate ? firstDay : project.startDate;
  const yesterday = toIsoDate(addDays(today, -1));
  const historyDays =
    historyStart <= yesterday
      ? workingDaysOfRange({ start: historyStart, end: yesterday })
      : [];
  const dailyHours = historyDays.map((date) => ({
    date,
    hours: round(hoursByDay.get(date) ?? 0, 4),
  }));
  // Burn history starts at the first day with logged time (pre-kickoff
  // zeros would only drag the average down).
  const firstLogged = dailyHours.findIndex((day) => day.hours > 0);
  const burnHistory = firstLogged < 0 ? [] : dailyHours.slice(firstLogged);
  const burnValues = burnHistory.map((day) => day.hours);

  const dailyBurnHours = ewma(burnValues, options.ewmaAlpha);
  const dailyBurn = dailyBurnHours * rate;
  const recent = burnValues.slice(-options.budgetRecentWorkingDays);
  const earlier = burnValues.slice(0, -options.budgetRecentWorkingDays);

  // Exhaustion.
  let exhaustionDate: IsoDate | null = null;
  let alreadyExhausted = false;
  const remaining = budget - spent;
  if (budget > 0 && remaining <= 0) {
    alreadyExhausted = true;
    let cumulative = 0;
    const sortedDays = [...hoursByDay.keys()].sort();
    for (const day of sortedDays) {
      cumulative += (hoursByDay.get(day) ?? 0) * rate;
      if (cumulative >= budget) {
        exhaustionDate = day;
        break;
      }
    }
    exhaustionDate ??= asOf;
  } else if (budget > 0 && dailyBurn > 0) {
    const daysNeeded = Math.ceil(remaining / dailyBurn - 1e-9);
    if (daysNeeded <= MAX_PROJECTION_WORKING_DAYS) {
      exhaustionDate = workingDaysFrom(today, daysNeeded).at(-1) ?? asOf;
    }
  }

  const endDate = project.endDate;
  const remainingWorkingDaysToEnd =
    endDate >= asOf ? workingDaysOfRange({ start: asOf, end: endDate }).length : 0;
  const projectedSpendAtEnd = spent + dailyBurn * remainingWorkingDaysToEnd;
  const percentOverAtEnd =
    budget > 0 ? round(((projectedSpendAtEnd - budget) / budget) * 100, 1) : null;
  const daysBeforeEnd =
    exhaustionDate === null ? null : calendarDaysBetween(exhaustionDate, endDate);

  // Chart series: start of project to max(end date, exhaustion), working days.
  const seriesEnd =
    exhaustionDate !== null && exhaustionDate > endDate ? exhaustionDate : endDate;
  const seriesStart = project.startDate < historyStart ? project.startDate : historyStart;
  const seriesDays =
    seriesStart <= seriesEnd ? workingDaysOfRange({ start: seriesStart, end: seriesEnd }) : [];
  const planDays = workingDaysOfRange({ start: project.startDate, end: endDate }).length;
  let cumulative = 0;
  let projected = spent;
  let planIndex = 0;
  const series: BudgetSeriesPoint[] = seriesDays.map((date) => {
    if (date >= project.startDate && date <= endDate) planIndex += 1;
    const plan = round(planDays === 0 ? budget : (budget * Math.min(planIndex, planDays)) / planDays);
    if (date < asOf) {
      cumulative += (hoursByDay.get(date) ?? 0) * rate;
      return { date, actual: round(cumulative), projected: null, plan };
    }
    // Today's partial logs are already in `spent`; project from there.
    projected += dailyBurn;
    return { date, actual: null, projected: round(projected), plan };
  });
  // Connect the projection to the last actual point.
  const lastActual = series.findLastIndex((point) => point.actual !== null);
  if (lastActual >= 0 && lastActual < series.length - 1) {
    series[lastActual].projected = series[lastActual].actual;
  }

  const forecast: BudgetRunwayForecast = {
    asOf,
    currency: project.budgetCurrency,
    budget,
    hourlyRate: rate,
    spent: round(spent),
    spentHours: round(spentHours),
    remaining: round(remaining),
    ewmaAlpha: options.ewmaAlpha,
    dailyBurnHours: round(dailyBurnHours),
    dailyBurn: round(dailyBurn),
    recentDailyHours: round(mean(recent)),
    earlierDailyHours: round(mean(earlier)),
    exhaustionDate,
    alreadyExhausted,
    endDate,
    daysBeforeEnd,
    projectedSpendAtEnd: round(projectedSpendAtEnd),
    percentOverAtEnd,
    dailyHours,
    series,
  };
  const inputs = {
    asOf,
    budget,
    hourlyRate: rate,
    startDate: project.startDate,
    endDate,
    ewmaAlpha: options.ewmaAlpha,
    worklogs: worklogs.length,
    spentHours: round(spentHours, 4),
    dailyHours: burnValues,
  };

  if (worklogs.length === 0 || budget <= 0 || rate <= 0) {
    return {
      result: {
        kind: "budget_overrun",
        triggered: false,
        severity: "low",
        confidence: 0.1,
        eta: null,
        drivers: [
          insufficientDataDriver(
            worklogs.length === 0
              ? "Sin partes de horas: no se puede estimar el consumo del presupuesto."
              : "El proyecto no tiene presupuesto ni tarifa por hora.",
          ),
        ],
        evidence: [],
      },
      forecast,
      inputs,
    };
  }

  // An overspent project is over budget even when its end date has passed.
  const triggered =
    alreadyExhausted || (exhaustionDate !== null && exhaustionDate < endDate);
  const currency = project.budgetCurrency;
  const drivers: Driver[] = [
    { key: "budget", label: "Presupuesto total", value: budget, unit: currency },
    { key: "spent", label: "Consumido hasta ahora", value: round(spent), unit: currency },
    {
      key: "spent_share",
      label: "Porcentaje del presupuesto consumido",
      value: Math.round((spent / budget) * 100),
      unit: "%",
    },
    {
      key: "daily_burn",
      label: `Consumo diario (EWMA, alfa ${options.ewmaAlpha})`,
      value: round(dailyBurn),
      unit: `${currency}/día`,
    },
    {
      key: "daily_burn_hours",
      label: "Horas registradas por día hábil (EWMA)",
      value: round(dailyBurnHours, 1),
      unit: "horas/día",
    },
  ];
  if (earlier.length > 0 && mean(earlier) > 0) {
    drivers.push({
      key: "burn_change",
      label: `Consumo de los últimos ${recent.length} días hábiles frente al período anterior`,
      value: Math.round((mean(recent) / mean(earlier) - 1) * 100),
      unit: "%",
    });
  }
  if (daysBeforeEnd !== null) {
    drivers.push({
      key: "exhaustion_days_before_end",
      label: "Días entre el agotamiento del presupuesto y la fecha de fin",
      value: daysBeforeEnd,
      unit: "días",
      detail: `${exhaustionDate} frente a ${endDate}`,
    });
  }
  if (percentOverAtEnd !== null) {
    drivers.push({
      key: "percent_over_at_end",
      label: "Gasto proyectado a la fecha de fin frente al presupuesto",
      value: percentOverAtEnd,
      unit: "%",
    });
  }

  // Evidence: the issues absorbing the most hours recently (then all-time).
  const issuesByKey = new Map<string, Issue>(
    snapshot.issues.map((issue) => [issue.key, issue]),
  );
  const windowStart = recent.length > 0 ? burnHistory[burnHistory.length - recent.length].date : asOf;
  const evidence = topWorklogEvidence(snapshot, issuesByKey, windowStart, recent.length);

  return {
    result: {
      kind: "budget_overrun",
      triggered,
      severity: triggered ? budgetSeverity(daysBeforeEnd ?? 0, alreadyExhausted) : "low",
      confidence: budgetConfidence(burnHistory.length, recent),
      eta: exhaustionDate,
      drivers,
      evidence,
    },
    forecast,
    inputs,
  };
}

function topWorklogEvidence(
  snapshot: ProjectSnapshot,
  issuesByKey: Map<string, Issue>,
  windowStart: IsoDate,
  windowDays: number,
): Evidence[] {
  const aggregate = (from: IsoDate | null) => {
    const totals = new Map<string, { hours: number; last: string }>();
    for (const worklog of snapshot.worklogs) {
      if (from !== null && dayOf(worklog.startedAt) < from) continue;
      const current = totals.get(worklog.issueKey) ?? { hours: 0, last: worklog.startedAt };
      current.hours += worklog.seconds / 3600;
      if (worklog.startedAt > current.last) current.last = worklog.startedAt;
      totals.set(worklog.issueKey, current);
    }
    return [...totals.entries()]
      .filter(([key]) => issuesByKey.has(key))
      .sort((a, b) => b[1].hours - a[1].hours || a[0].localeCompare(b[0]))
      .slice(0, 5);
  };
  let top = aggregate(windowStart);
  let scope = `en los últimos ${windowDays} días hábiles`;
  if (top.length === 0) {
    top = aggregate(null);
    scope = "desde el inicio del proyecto";
  }
  return top.map(([key, total]) =>
    worklogEvidence(
      issuesByKey.get(key) as Issue,
      total.last,
      `${round(total.hours, 1)} h registradas ${scope}`,
    ),
  );
}

export function budgetTitle(forecast: BudgetRunwayForecast): string {
  if (forecast.exhaustionDate === null) return "Presupuesto en curso";
  const when = formatShortDate(forecast.exhaustionDate);
  const end = formatShortDate(forecast.endDate);
  if (forecast.alreadyExhausted) {
    if ((forecast.daysBeforeEnd ?? 0) >= 0) {
      return `Presupuesto agotado el ${when}, antes de la fecha de fin del ${end}`;
    }
    return forecast.percentOverAtEnd === null
      ? `Presupuesto ya agotado, después de la fecha de fin del ${end}`
      : `Presupuesto ya agotado; ${forecast.percentOverAtEnd}% por encima a la fecha de fin del ${end}`;
  }
  const days = forecast.daysBeforeEnd ?? 0;
  return `El presupuesto se agota el ${when}, ${days} día${days === 1 ? "" : "s"} antes de la fecha de fin`;
}

