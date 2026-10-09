import type { Alert, Project, Severity } from "@/shared/domain";
import type { RadarRepository } from "@/shared/ports";

import {
  readBudgetRunway,
  readSprintCompletion,
  type BudgetRunwayView,
  type SprintCompletionView,
} from "../../shared/domain/stored-forecast";

/**
 * Portfolio read model: one row per project with everything a card shows.
 *
 * Health is derived from the ACTIVE alerts — `open` and `ack` — because
 * acknowledging an alert means someone saw it, not that the risk went away
 * (see the lifecycle on `ALERT_STATUS_TRANSITIONS`); a critical risk must not
 * turn green on a click. The top alert and the tab count stay open-only: they
 * are the triage queue, which is what still needs a first look.
 */

/** Forecast kinds the cockpit reads; mirrors `FORECAST_KINDS` of the engine. */
export const SPRINT_FORECAST_KIND = "sprint_completion";
export const BUDGET_FORECAST_KIND = "budget_runway";

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface PortfolioRow {
  project: Project;
  openAlerts: Alert[];
  /** `open` + `ack`: everything that is still a live risk. */
  activeAlerts: Alert[];
  topAlert: Alert | null;
  sprint: SprintCompletionView | null;
  budget: BudgetRunwayView | null;
}

/** Most severe first; same severity, soonest ETA first; then oldest. */
export function rankAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (bySeverity !== 0) return bySeverity;
    if (left.eta !== right.eta) {
      if (left.eta === null) return 1;
      if (right.eta === null) return -1;
      return left.eta < right.eta ? -1 : 1;
    }
    return left.createdAt < right.createdAt ? -1 : 1;
  });
}

async function buildRow(
  repo: RadarRepository,
  project: Project,
): Promise<PortfolioRow> {
  const [openAlerts, ackAlerts, sprintForecast, budgetForecast] = await Promise.all([
    repo.alerts.byProject(project.id, "open"),
    repo.alerts.byProject(project.id, "ack"),
    repo.forecasts.latest(project.id, SPRINT_FORECAST_KIND),
    repo.forecasts.latest(project.id, BUDGET_FORECAST_KIND),
  ]);

  const ranked = rankAlerts(openAlerts);

  return {
    project,
    openAlerts: ranked,
    activeAlerts: rankAlerts([...openAlerts, ...ackAlerts]),
    topAlert: ranked[0] ?? null,
    sprint: sprintForecast ? readSprintCompletion(sprintForecast.result) : null,
    budget: budgetForecast ? readBudgetRunway(budgetForecast.result) : null,
  };
}

/** Every project, in repository order (by name), with its cockpit summary. */
export async function getPortfolio(
  repo: RadarRepository,
): Promise<PortfolioRow[]> {
  const projects = await repo.projects.list();
  return Promise.all(projects.map((project) => buildRow(repo, project)));
}
