import type { DetectorResult } from "@/shared/domain";

import { budgetTitle, forecastBudgetRunway, type BudgetRunwayOutcome } from "./budget";
import {
  detectReopenRate,
  detectStaleReviews,
  detectStalledIssues,
  detectWipOverLimit,
  inProgressIssues,
  reopenTitle,
  staleReviewTitle,
  stalledTitle,
  wipTitle,
} from "./flow";
import { detectScopeCreep, scopeCreepTitle } from "./scope-creep";
import {
  DEFAULT_FORECAST_OPTIONS,
  hasEvidenceGap,
  isInconclusive,
  missingEvidenceDriver,
  type ForecastOptions,
  type ProjectSnapshot,
} from "./snapshot";
import {
  forecastSprintCompletion,
  sprintRiskTitle,
  type SprintCompletionOutcome,
} from "./sprint-completion";

/**
 * Runs every detector on one project snapshot. Pure: the same snapshot and
 * options always produce the same evaluation (seeded Monte Carlo).
 */

export interface Detection {
  result: DetectorResult;
  /** Deterministic alert title (the LLM layer may add an explanation later). */
  title: string;
  /**
   * Not enough to act on: either insufficient data, or triggered without any
   * evidence to cite. Never raises an alert and never auto-resolves one.
   */
  inconclusive: boolean;
}

export interface ProjectEvaluation {
  sprint: SprintCompletionOutcome;
  budget: BudgetRunwayOutcome;
  detections: Detection[];
}

/** Keeps exactly the `DetectorResult` fields (detectors may return extras). */
function strip(result: DetectorResult): DetectorResult {
  const { kind, triggered, severity, confidence, eta, drivers, evidence } = result;
  return { kind, triggered, severity, confidence, eta, drivers, evidence };
}

function detection(result: DetectorResult, title: string): Detection {
  const stripped = strip(result);
  if (!hasEvidenceGap(stripped)) {
    return { result: stripped, title, inconclusive: isInconclusive(stripped) };
  }
  // Triggered with nothing to cite: treat it like missing data, not like a
  // cleared condition (see decision D-042).
  return {
    result: {
      ...stripped,
      drivers: [
        ...stripped.drivers,
        missingEvidenceDriver(
          `Ningún registro de origen respalda la señal ${stripped.kind}; la alerta no se puede mostrar con evidencia.`,
        ),
      ],
    },
    title,
    inconclusive: true,
  };
}

export function evaluateProject(
  snapshot: ProjectSnapshot,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): ProjectEvaluation {
  const sprint = forecastSprintCompletion(snapshot, options);
  const budget = forecastBudgetRunway(snapshot, options);
  const scopeCreep = detectScopeCreep(snapshot, sprint.scope, options);
  const wip = detectWipOverLimit(snapshot);
  const stale = detectStaleReviews(snapshot, options);
  const stalled = detectStalledIssues(snapshot, options);
  const reopen = detectReopenRate(snapshot, options);

  return {
    sprint,
    budget,
    detections: [
      detection(sprint.result, sprintRiskTitle(sprint.forecast)),
      detection(budget.result, budgetTitle(budget.forecast)),
      detection(
        scopeCreep,
        sprint.scope ? scopeCreepTitle(sprint.scope) : "Crecimiento del alcance",
      ),
      detection(
        wip,
        wipTitle(inProgressIssues(snapshot).length, snapshot.project.wipLimit),
      ),
      detection(stale, staleReviewTitle(stale.stale, options.staleReviewHours)),
      detection(stalled, stalledTitle(stalled.stalled, options.stalledWorkingDays)),
      detection(reopen, reopenTitle(reopen.rate ?? 0, options.reopenWindowWorkingDays)),
    ],
  };
}
