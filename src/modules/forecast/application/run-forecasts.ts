import { dedupeEvidence, type AlertKind, type Project } from "@/shared/domain";
import type { Clock, RadarRepository } from "@/shared/ports";

import {
  DEFAULT_FORECAST_OPTIONS,
  evaluateProject,
  type ForecastOptions,
  type ProjectSnapshot,
} from "../domain";

/**
 * Forecast use case: for every project, load a snapshot through the
 * repository port, run every detector (pure), persist the forecasts, upsert
 * triggered alerts, and resolve active alerts whose detector no longer fires.
 *
 * - Idempotent per day: a forecast identical to the latest one of the same
 *   UTC day is not inserted again, and alerts upsert in place (D-022/D-029).
 * - Auto-resolve (D-042): a conclusive, non-triggered detection resolves the
 *   active (`open` or `ack`) alert of its kind. Inconclusive detections leave
 *   alerts untouched: insufficient data, and detectors that fired with no
 *   evidence to cite, are not proof that the problem went away.
 * - Alerts start without an explanation; the AI layer (phase 4) fills it.
 * - A failing project is reported in the summary and does not stop others.
 */

export const FORECAST_KINDS = {
  sprintCompletion: "sprint_completion",
  budgetRunway: "budget_runway",
} as const;

export interface RunForecastsDeps {
  repo: RadarRepository;
  clock: Clock;
  options?: ForecastOptions;
}

export interface ProjectForecastSummary {
  projectId: string;
  projectName: string;
  /** Forecast kinds inserted in this run (identical same-day ones are skipped). */
  forecastsStored: string[];
  forecastsUnchanged: string[];
  sprintProbability: number | null;
  budgetExhaustionDate: string | null;
  /** Alert kinds upserted (triggered detectors). */
  triggered: AlertKind[];
  /** Alert kinds resolved because their detector stopped firing. */
  resolved: AlertKind[];
  /** Detectors without enough data to judge. */
  inconclusive: AlertKind[];
  error: string | null;
}

export interface RunForecastsResult {
  computedAt: string;
  projects: ProjectForecastSummary[];
}

async function loadSnapshot(
  repo: RadarRepository,
  project: Project,
  now: Date,
): Promise<ProjectSnapshot> {
  const [sprints, activeSprint, issues, issueEvents, worklogs, pullRequests, commits, capacity] =
    await Promise.all([
      repo.sprints.byProject(project.id),
      repo.sprints.active(project.id, now),
      repo.issues.byProject(project.id),
      repo.issueEvents.byProject(project.id),
      repo.worklogs.byProject(project.id),
      repo.pullRequests.byProject(project.id),
      repo.commits.byProject(project.id),
      repo.capacity.byProject(project.id),
    ]);
  return {
    project,
    now,
    sprints,
    activeSprint,
    issues,
    issueEvents,
    worklogs,
    pullRequests,
    commits,
    capacity,
  };
}

/** Inserts unless the latest forecast of the kind, same UTC day, is identical. */
async function storeForecast(
  repo: RadarRepository,
  projectId: string,
  kind: string,
  computedAt: string,
  inputs: unknown,
  result: unknown,
): Promise<boolean> {
  const latest = await repo.forecasts.latest(projectId, kind);
  if (
    latest &&
    latest.computedAt.slice(0, 10) === computedAt.slice(0, 10) &&
    JSON.stringify(latest.inputs) === JSON.stringify(inputs) &&
    JSON.stringify(latest.result) === JSON.stringify(result)
  ) {
    return false;
  }
  await repo.forecasts.insert({ projectId, kind, computedAt, inputs, result });
  return true;
}

function describeError(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
    ? `forecast failed: ${error.name}`
    : "forecast failed";
}

async function forecastProject(
  repo: RadarRepository,
  project: Project,
  now: Date,
  options: ForecastOptions,
): Promise<ProjectForecastSummary> {
  const computedAt = now.toISOString();
  const snapshot = await loadSnapshot(repo, project, now);
  const evaluation = evaluateProject(snapshot, options);
  const summary: ProjectForecastSummary = {
    projectId: project.id,
    projectName: project.name,
    forecastsStored: [],
    forecastsUnchanged: [],
    sprintProbability: evaluation.sprint.forecast.probability,
    budgetExhaustionDate: evaluation.budget.forecast.exhaustionDate,
    triggered: [],
    resolved: [],
    inconclusive: [],
    error: null,
  };

  const forecasts = [
    {
      kind: FORECAST_KINDS.sprintCompletion,
      inputs: evaluation.sprint.inputs,
      result: {
        ...evaluation.sprint.forecast,
        detector: evaluation.sprint.result,
      },
    },
    {
      kind: FORECAST_KINDS.budgetRunway,
      inputs: evaluation.budget.inputs,
      result: {
        ...evaluation.budget.forecast,
        detector: evaluation.budget.result,
      },
    },
  ];
  for (const forecast of forecasts) {
    const stored = await storeForecast(
      repo,
      project.id,
      forecast.kind,
      computedAt,
      forecast.inputs,
      forecast.result,
    );
    (stored ? summary.forecastsStored : summary.forecastsUnchanged).push(forecast.kind);
  }

  const active = [
    ...(await repo.alerts.byProject(project.id, "open")),
    ...(await repo.alerts.byProject(project.id, "ack")),
  ];

  for (const { result, title, inconclusive } of evaluation.detections) {
    if (inconclusive) {
      summary.inconclusive.push(result.kind);
      continue;
    }
    // Past the guard above, a triggered result always carries evidence.
    const evidence = dedupeEvidence(result.evidence);
    if (result.triggered) {
      await repo.alerts.upsertForKind(project.id, result.kind, {
        // Every detector of this slice measures the whole project; a
        // team- or person-scoped detector sets the subject here (D-054).
        teamId: null,
        personId: null,
        severity: result.severity,
        confidence: result.confidence,
        eta: result.eta,
        title,
        explanation: null,
        explanationSource: null,
        drivers: result.drivers,
        evidence,
        suggestedActions: [],
        detectedAt: computedAt,
      });
      summary.triggered.push(result.kind);
      continue;
    }
    for (const alert of active.filter((item) => item.kind === result.kind)) {
      await repo.alerts.setStatus(alert.id, "resolved");
      summary.resolved.push(result.kind);
    }
  }

  return summary;
}

export async function runForecasts(deps: RunForecastsDeps): Promise<RunForecastsResult> {
  const { repo, clock } = deps;
  const options = deps.options ?? DEFAULT_FORECAST_OPTIONS;
  const now = clock.now();
  const projects = await repo.projects.list();

  const summaries: ProjectForecastSummary[] = [];
  for (const project of projects) {
    try {
      summaries.push(await forecastProject(repo, project, now, options));
    } catch (error) {
      summaries.push({
        projectId: project.id,
        projectName: project.name,
        forecastsStored: [],
        forecastsUnchanged: [],
        sprintProbability: null,
        budgetExhaustionDate: null,
        triggered: [],
        resolved: [],
        inconclusive: [],
        error: describeError(error),
      });
    }
  }

  return { computedAt: now.toISOString(), projects: summaries };
}

