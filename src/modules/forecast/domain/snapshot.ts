import type {
  CapacityEntry,
  Commit,
  Driver,
  Issue,
  IssueEvent,
  Project,
  PullRequest,
  Sprint,
  Worklog,
} from "@/shared/domain";

/**
 * Everything the detectors read for one project, loaded by the application
 * layer. Detectors are pure functions of a snapshot plus options: "now" is a
 * field, never a clock read.
 */
export interface ProjectSnapshot {
  project: Project;
  now: Date;
  /** Every sprint of the project, any state. */
  sprints: readonly Sprint[];
  /** The sprint the repository considers current (`sprints.active`), if any. */
  activeSprint: Sprint | null;
  issues: readonly Issue[];
  issueEvents: readonly IssueEvent[];
  worklogs: readonly Worklog[];
  pullRequests: readonly PullRequest[];
  commits: readonly Commit[];
  capacity: readonly CapacityEntry[];
}

/** Tunable knobs; `DEFAULT_FORECAST_OPTIONS` documents each default. */
export interface ForecastOptions {
  /** Monte Carlo runs per sprint forecast. */
  runs: number;
  /** Closed sprints whose daily throughput feeds the simulation. */
  historySprints: number;
  /** Fewer closed sprints than this means "insufficient history". */
  minHistorySprints: number;
  /** Working days simulated past the sprint end to find P50/P85 dates. */
  horizonWorkingDaysAfterSprint: number;
  /** Sprint goal risk fires when P(complete) is below this. */
  sprintRiskThreshold: number;
  /** Hours per person per day used when no elapsed-day capacity exists. */
  hoursPerPersonDay: number;
  /** EWMA smoothing factor for the daily budget burn (0 < alpha <= 1). */
  ewmaAlpha: number;
  /** Working days of the "recent burn" window used for evidence and stability. */
  budgetRecentWorkingDays: number;
  /** Scope creep fires when net scope added / committed exceeds this. */
  scopeCreepThreshold: number;
  /** A PR without a first review for longer than this is stale. */
  staleReviewHours: number;
  /** In-progress issue without a linked commit for this many full working days is stalled. */
  stalledWorkingDays: number;
  /** Window of the reopen-rate signal, in working days ending today. */
  reopenWindowWorkingDays: number;
  /** Reopen rate fires above this share of resolutions in the window. */
  reopenRateThreshold: number;
  /** Fewer resolutions than this in the window means "insufficient data". */
  reopenMinResolutions: number;
}

export const DEFAULT_FORECAST_OPTIONS: ForecastOptions = {
  runs: 10_000,
  historySprints: 6,
  minHistorySprints: 2,
  horizonWorkingDaysAfterSprint: 30,
  sprintRiskThreshold: 0.5,
  hoursPerPersonDay: 8,
  ewmaAlpha: 0.3,
  budgetRecentWorkingDays: 15,
  scopeCreepThreshold: 0.15,
  staleReviewHours: 48,
  stalledWorkingDays: 5,
  reopenWindowWorkingDays: 20,
  reopenRateThreshold: 0.15,
  reopenMinResolutions: 5,
};

/**
 * Driver key marking a result as inconclusive (not enough data to judge).
 * Inconclusive results never trigger and never auto-resolve an open alert.
 */
export const INSUFFICIENT_DATA_DRIVER = "insufficient_data";

export function insufficientDataDriver(detail: string): Driver {
  return {
    key: INSUFFICIENT_DATA_DRIVER,
    label: "Datos insuficientes",
    value: 1,
    detail,
  };
}

export function isInconclusive(result: { drivers: readonly Driver[] }): boolean {
  return result.drivers.some((driver) => driver.key === INSUFFICIENT_DATA_DRIVER);
}

/**
 * Driver key marking a detector that fired but found no source record to cite.
 * "Evidence or it didn't happen": such a result may not raise an alert, and it
 * is NOT proof that the problem went away, so it never resolves one either.
 */
export const MISSING_EVIDENCE_DRIVER = "missing_evidence";

export function missingEvidenceDriver(detail: string): Driver {
  return {
    key: MISSING_EVIDENCE_DRIVER,
    label: "Se activó sin evidencia citable",
    value: 1,
    detail,
  };
}

/** A detector that triggered but carries no evidence to show for it. */
export function hasEvidenceGap(result: {
  triggered: boolean;
  evidence: readonly unknown[];
}): boolean {
  return result.triggered && result.evidence.length === 0;
}
