import type { Alert, AlertStatus, Project, SyncRun } from "@/shared/domain";
import type { RadarRepository } from "@/shared/ports";

import {
  BUDGET_FORECAST_KIND,
  SPRINT_FORECAST_KIND,
  rankAlerts,
} from "../../portfolio/application/get-portfolio";
import {
  readBudgetRunway,
  readSprintCompletion,
  type BudgetRunwayView,
  type SprintCompletionView,
} from "../../shared/domain/stored-forecast";

/**
 * Project read model for the cockpit page: the project, its freshness per
 * source, its alerts (open, then acknowledged, then resolved — each group
 * ranked by severity), and the latest forecast of each kind.
 */

const STATUS_ORDER: readonly AlertStatus[] = ["open", "ack", "resolved"];

export interface ProjectDetail {
  project: Project;
  alerts: Alert[];
  openAlertCount: number;
  syncRuns: SyncRun[];
  sprint: SprintCompletionView | null;
  budget: BudgetRunwayView | null;
  sprintComputedAt: string | null;
  budgetComputedAt: string | null;
}

/** `null` when the id is unknown, so the route can render `notFound()`. */
export async function getProjectDetail(
  repo: RadarRepository,
  projectId: string,
): Promise<ProjectDetail | null> {
  const project = await repo.projects.get(projectId);
  if (project === null) return null;

  const [byStatus, syncRuns, sprintForecast, budgetForecast] = await Promise.all([
    Promise.all(STATUS_ORDER.map((status) => repo.alerts.byProject(project.id, status))),
    repo.syncRuns.latestBySource(project.id),
    repo.forecasts.latest(project.id, SPRINT_FORECAST_KIND),
    repo.forecasts.latest(project.id, BUDGET_FORECAST_KIND),
  ]);

  const alerts = byStatus.flatMap((group) => rankAlerts(group));

  return {
    project,
    alerts,
    openAlertCount: byStatus[0].length,
    syncRuns,
    sprint: sprintForecast ? readSprintCompletion(sprintForecast.result) : null,
    budget: budgetForecast ? readBudgetRunway(budgetForecast.result) : null,
    sprintComputedAt: sprintForecast?.computedAt ?? null,
    budgetComputedAt: budgetForecast?.computedAt ?? null,
  };
}
