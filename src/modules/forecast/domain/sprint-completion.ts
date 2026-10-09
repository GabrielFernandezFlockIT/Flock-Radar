import {
  addDays,
  createRng,
  fromIsoDate,
  startOfUtcDay,
  toIsoDate,
  type DetectorResult,
  type Driver,
  type Evidence,
  type ForecastUnit,
  type IsoDate,
  type Severity,
} from "@/shared/domain";

import {
  clamp,
  dayOf,
  formatShortDate,
  meanAndCv,
  round,
  workingDaysFrom,
} from "./dates";
import { issueEvidence, sprintEvidence } from "./evidence";
import { simulateSprintCompletion } from "./monte-carlo";
import {
  DEFAULT_FORECAST_OPTIONS,
  insufficientDataDriver,
  type ForecastOptions,
  type ProjectSnapshot,
} from "./snapshot";
import { buildSprintScope, type SprintScope } from "./sprint-scope";
import {
  buildCapacityModel,
  capacityFactor,
  issuesResolvedIn,
  lastClosedSprints,
  sprintThroughput,
  type CapacityBaselineSource,
} from "./throughput";

/**
 * Sprint goal risk: P(complete the sprint's remaining scope by its last
 * working day), from a seeded bootstrap Monte Carlo (D-009, D-037, D-038).
 */

export interface BurnUpPoint {
  date: IsoDate;
  /** Scope at the end of the day (committed + changes). */
  scope: number;
  /** Actual cumulative done at the end of an elapsed day. */
  done: number | null;
  /** Projected cumulative done reached by 50% / 85% of runs (remaining days). */
  p50: number | null;
  p85: number | null;
}

export interface SprintCompletionForecast {
  asOf: IsoDate;
  seed: string;
  runs: number;
  unit: ForecastUnit;
  /** Requested `points` but some estimates were missing, so issues are counted. */
  unitFallback: boolean;
  sprint: { id: string; name: string; startDate: IsoDate; endDate: IsoDate } | null;
  committed: number;
  scope: number;
  done: number;
  remaining: number;
  remainingWorkingDays: number;
  probability: number | null;
  expectedCompletionDate: IsoDate | null;
  p50Date: IsoDate | null;
  p85Date: IsoDate | null;
  /** Last simulated day; dates beyond it are reported as `null`. */
  horizonEndDate: IsoDate | null;
  history: {
    sprints: number;
    sampleDays: number;
    meanDailyThroughput: number;
    sprintTotals: number[];
  };
  capacity: {
    baselineHours: number;
    baselineSource: CapacityBaselineSource;
    teamSize: number;
    remainingDays: Array<{ date: IsoDate; availableHours: number | null; factor: number }>;
  };
  burnUp: BurnUpPoint[];
}

export interface SprintCompletionOutcome {
  result: DetectorResult;
  forecast: SprintCompletionForecast;
  /** Exactly what the simulation consumed, for the persisted `inputs`. */
  inputs: {
    asOf: IsoDate;
    seed: string;
    runs: number;
    unit: ForecastUnit;
    remaining: number;
    sprintDays: number;
    samples: number[];
    dayFactors: number[];
  };
  /** Shared with scope creep; `null` without an active sprint. */
  scope: SprintScope | null;
}

const UNIT_LABEL: Record<ForecastUnit, string> = { points: "pts", issues: "incidencias" };

export function unitLabel(unit: ForecastUnit): string {
  return UNIT_LABEL[unit];
}

/** Seed of the day's simulation: stable per project and UTC day (D-009). */
export function sprintSeed(projectId: string, asOf: IsoDate): string {
  return `${projectId}:${asOf}`;
}

/**
 * Severity: P < 0.3 critical, P < 0.5 high (both trigger with the default
 * threshold); otherwise P < 0.7 medium, else low.
 */
export function sprintSeverity(probability: number): Severity {
  if (probability < 0.3) return "critical";
  if (probability < 0.5) return "high";
  if (probability < 0.7) return "medium";
  return "low";
}

/**
 * Confidence: 0.9 x (sprints used / sprints wanted) x (1 - CV of sprint
 * totals, floored at 0.5), minus 0.1 when capacity had to fall back to a
 * nominal baseline or was unavailable; clamped to [0.05, 0.95].
 */
export function sprintConfidence(input: {
  sprintsUsed: number;
  sprintsWanted: number;
  sprintTotals: readonly number[];
  capacitySource: CapacityBaselineSource;
}): number {
  const sampleFactor = Math.min(1, input.sprintsUsed / Math.max(1, input.sprintsWanted));
  const { cv } = meanAndCv(input.sprintTotals);
  const stability = Math.max(0.5, 1 - cv);
  const penalty = input.capacitySource === "elapsed_mean" ? 0 : 0.1;
  return round(clamp(0.9 * sampleFactor * stability - penalty, 0.05, 0.95));
}

function emptyForecast(
  snapshot: ProjectSnapshot,
  asOf: IsoDate,
  seed: string,
  runs: number,
  unit: ForecastUnit,
): SprintCompletionForecast {
  return {
    asOf,
    seed,
    runs,
    unit,
    unitFallback: false,
    sprint: null,
    committed: 0,
    scope: 0,
    done: 0,
    remaining: 0,
    remainingWorkingDays: 0,
    probability: null,
    expectedCompletionDate: null,
    p50Date: null,
    p85Date: null,
    horizonEndDate: null,
    history: { sprints: 0, sampleDays: 0, meanDailyThroughput: 0, sprintTotals: [] },
    capacity: { baselineHours: 0, baselineSource: "none", teamSize: 0, remainingDays: [] },
    burnUp: [],
  };
}

export function forecastSprintCompletion(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): SprintCompletionOutcome {
  const { project, now } = snapshot;
  const today = startOfUtcDay(now);
  const asOf = toIsoDate(today);
  const seed = sprintSeed(project.id, asOf);
  const runs = options.runs;
  const sprint = snapshot.activeSprint;

  const inconclusive = (
    detail: string,
    forecast: SprintCompletionForecast,
    scope: SprintScope | null,
    extra: Driver[] = [],
  ): SprintCompletionOutcome => ({
    result: {
      kind: "sprint_goal_risk",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta: forecast.sprint?.endDate ?? null,
      drivers: [insufficientDataDriver(detail), ...extra],
      evidence: [],
    },
    forecast,
    inputs: {
      asOf,
      seed,
      runs,
      unit: forecast.unit,
      remaining: forecast.remaining,
      sprintDays: forecast.remainingWorkingDays,
      samples: [],
      dayFactors: [],
    },
    scope,
  });

  if (!sprint || sprint.state !== "active") {
    return inconclusive(
      "No hay un sprint activo para pronosticar.",
      emptyForecast(snapshot, asOf, seed, runs, project.forecastUnit),
      null,
    );
  }

  // --- Unit (D-007): fall back to issue count when any estimate is missing.
  const history = lastClosedSprints(snapshot.sprints, options.historySprints);
  const members = snapshot.issues.filter((issue) => issue.sprintId === sprint.id);
  const historyDone = issuesResolvedIn(history, snapshot.issues);
  const unestimated =
    members.filter((issue) => issue.points === null).length +
    historyDone.filter((issue) => issue.points === null).length;
  const unitFallback = project.forecastUnit === "points" && unestimated > 0;
  const unit: ForecastUnit = unitFallback ? "issues" : project.forecastUnit;

  const scope = buildSprintScope({
    sprint,
    unit,
    issues: snapshot.issues,
    events: snapshot.issueEvents,
    now,
  });

  // --- History.
  const throughput = sprintThroughput(history, snapshot.issues, unit);
  const samples = throughput.flatMap((item) => item.daily);
  const sprintTotals = throughput.map((item) => item.total);
  const meanDaily =
    samples.length === 0 ? 0 : samples.reduce((sum, value) => sum + value, 0) / samples.length;

  // --- Days and capacity.
  const elapsedDays = scope.days.filter((day) => day < asOf);
  const remainingDays = scope.days.filter((day) => day >= asOf);
  const lastSprintDay = scope.days.at(-1) ?? dayOf(sprint.endAt);
  const extensionStart =
    remainingDays.length > 0 ? addDays(fromIsoDate(lastSprintDay), 1) : today;
  const projectedDays = [
    ...remainingDays,
    ...workingDaysFrom(extensionStart, options.horizonWorkingDaysAfterSprint),
  ];
  const capacity = buildCapacityModel(
    snapshot.capacity,
    elapsedDays,
    options.hoursPerPersonDay,
  );
  const dayFactors = projectedDays.map((day) => round(capacityFactor(capacity, day), 6));

  const unitFallbackDriver: Driver[] = unitFallback
    ? [
        {
          key: "unit_fallback",
          label:
            "Incidencias sin estimación (el pronóstico cuenta incidencias en lugar de puntos)",
          value: unestimated,
          unit: "incidencias",
        },
      ]
    : [];

  const baseForecast: SprintCompletionForecast = {
    ...emptyForecast(snapshot, asOf, seed, runs, unit),
    unitFallback,
    sprint: {
      id: sprint.id,
      name: sprint.name,
      startDate: dayOf(sprint.startAt),
      endDate: lastSprintDay,
    },
    committed: scope.committed,
    scope: scope.current,
    done: scope.done,
    remaining: scope.remaining,
    remainingWorkingDays: remainingDays.length,
    history: {
      sprints: throughput.length,
      sampleDays: samples.length,
      meanDailyThroughput: round(meanDaily),
      sprintTotals,
    },
    capacity: {
      baselineHours: round(capacity.baselineHours),
      baselineSource: capacity.source,
      teamSize: capacity.teamSize,
      remainingDays: remainingDays.map((day, index) => ({
        date: day,
        availableHours: capacity.hoursByDay.get(day) ?? null,
        factor: dayFactors[index],
      })),
    },
    burnUp: scope.days.map((day, index) => ({
      date: day,
      scope: scope.scopeByDay[index],
      done: scope.doneByDay[index],
      p50: null,
      p85: null,
    })),
  };

  if (scope.remaining > 0) {
    if (history.length < options.minHistorySprints) {
      return inconclusive(
        `Solo ${history.length} sprint(s) cerrado(s); se necesitan al menos ${options.minHistorySprints}.`,
        baseForecast,
        scope,
        unitFallbackDriver,
      );
    }
    if (samples.every((value) => value === 0)) {
      return inconclusive(
        "No hay trabajo completado en los sprints muestreados.",
        baseForecast,
        scope,
        unitFallbackDriver,
      );
    }
  }

  // --- Simulation.
  const simulation = simulateSprintCompletion({
    remaining: scope.remaining,
    samples,
    dayFactors,
    sprintDays: remainingDays.length,
    runs,
    rng: createRng(seed),
  });
  const dateOf = (day: number | null): IsoDate | null => {
    if (day === null) return null;
    if (day === 0) return asOf;
    return projectedDays[day - 1] ?? null;
  };
  const probability = round(simulation.probability, 4);

  // Cone: anchored on the last actual point, then the projected days.
  const burnUp = baseForecast.burnUp.map((point) => ({ ...point }));
  const firstRemaining = burnUp.findIndex((point) => point.date >= asOf);
  if (firstRemaining > 0) {
    const anchor = burnUp[firstRemaining - 1];
    anchor.p50 = anchor.done;
    anchor.p85 = anchor.done;
  }
  if (firstRemaining >= 0) {
    for (let index = 0; index < remainingDays.length; index += 1) {
      const point = burnUp[firstRemaining + index];
      point.p50 = round(scope.done + simulation.cumulativeP50[index]);
      point.p85 = round(scope.done + simulation.cumulativeP85[index]);
    }
  }

  const forecast: SprintCompletionForecast = {
    ...baseForecast,
    probability,
    expectedCompletionDate: dateOf(simulation.expectedDay),
    p50Date: dateOf(simulation.p50Day),
    p85Date: dateOf(simulation.p85Day),
    horizonEndDate: projectedDays.at(-1) ?? null,
    burnUp,
  };

  // --- Drivers.
  const label = unitLabel(unit);
  const remainingFactors = dayFactors.slice(0, remainingDays.length);
  const capacityRatio =
    remainingFactors.length === 0
      ? 1
      : remainingFactors.reduce((sum, value) => sum + value, 0) / remainingFactors.length;
  const remainingSet = new Set(remainingDays);
  const absences = snapshot.capacity.filter(
    (entry) =>
      remainingSet.has(entry.date) && (entry.reason === "pto" || entry.reason === "holiday"),
  );
  const absentPeople = [...new Set(absences.map((entry) => entry.person))].sort();
  const netScopeChange = scope.current - scope.committed;

  const drivers: Driver[] = [
    {
      key: "probability",
      label: "Probabilidad de terminar el alcance del sprint antes de su cierre",
      value: Math.round(probability * 100),
      unit: "%",
    },
    { key: "remaining_work", label: "Trabajo restante", value: round(scope.remaining), unit: label },
    { key: "done_work", label: "Trabajo completado hasta ahora", value: round(scope.done), unit: label },
    {
      key: "remaining_working_days",
      label: "Días hábiles restantes en el sprint",
      value: remainingDays.length,
      unit: "días",
    },
    {
      key: "historical_daily_throughput",
      label: `Rendimiento diario promedio de los últimos ${throughput.length} sprints`,
      value: round(meanDaily),
      unit: `${label}/día`,
    },
    {
      key: "remaining_capacity",
      label: "Capacidad del equipo en los días restantes frente a un día normal",
      value: Math.round(capacityRatio * 100),
      unit: "%",
    },
  ];
  if (absences.length > 0) {
    drivers.push({
      key: "pto_person_days",
      label: "Persona-días de licencia o feriado en los días restantes del sprint",
      value: absences.length,
      unit: "persona-días",
      detail: absentPeople.join(", "),
    });
  }
  if (netScopeChange !== 0) {
    drivers.push({
      key: "scope_change",
      label: "Variación neta del alcance desde el inicio del sprint",
      value: round(netScopeChange),
      unit: label,
    });
  }
  if (forecast.p85Date === null && scope.remaining > 0) {
    drivers.push({
      key: "beyond_horizon",
      label:
        "Días hábiles simulados después del cierre del sprint sin que termine el 85% de las corridas",
      value: options.horizonWorkingDaysAfterSprint,
      unit: "días",
    });
  }
  if (capacity.source !== "elapsed_mean") {
    drivers.push({
      key: capacity.source === "none" ? "capacity_unavailable" : "capacity_baseline_nominal",
      label:
        capacity.source === "none"
          ? "Sin datos de capacidad del calendario; cada día cuenta como un día normal"
          : "Sin capacidad de días transcurridos; la base es tamaño del equipo x horas por día",
      value: capacity.source === "none" ? 1 : round(capacity.baselineHours),
      unit: capacity.source === "none" ? undefined : "horas/día",
    });
  }
  drivers.push(...unitFallbackDriver);

  // --- Evidence: the sprint and the work still open.
  const triggered = probability < options.sprintRiskThreshold;
  const open = scope.members
    .filter((issue) => issue.statusCategory !== "done")
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || a.key.localeCompare(b.key));
  const evidence: Evidence[] = [];
  const sprintRef = sprintEvidence(sprint, project, scope.members, `${sprint.name}`);
  if (sprintRef) evidence.push(sprintRef);
  for (const issue of open) {
    evidence.push(
      issueEvidence(
        issue,
        `${issue.status}${unit === "points" && issue.points !== null ? `, ${issue.points} pts` : ""}`,
      ),
    );
  }

  return {
    result: {
      kind: "sprint_goal_risk",
      triggered,
      severity: sprintSeverity(probability),
      confidence: sprintConfidence({
        sprintsUsed: throughput.length,
        sprintsWanted: options.historySprints,
        sprintTotals,
        capacitySource: capacity.source,
      }),
      eta: lastSprintDay,
      drivers,
      evidence,
    },
    forecast,
    inputs: {
      asOf,
      seed,
      runs,
      unit,
      remaining: scope.remaining,
      sprintDays: remainingDays.length,
      samples,
      dayFactors,
    },
    scope,
  };
}

export function sprintRiskTitle(forecast: SprintCompletionForecast): string {
  const percent = Math.round((forecast.probability ?? 0) * 100);
  const end = forecast.sprint ? formatShortDate(forecast.sprint.endDate) : "cierre del sprint";
  return `Objetivo del sprint en riesgo: ${percent}% de probabilidad de terminar para el ${end}`;
}
