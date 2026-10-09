import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BarChart3Icon, FileTextIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { getContainer } from "@/composition-root";
import { getProjectDetail } from "@/modules/cockpit/project/application/get-project-detail";
import { AlertsTab } from "@/modules/cockpit/project/ui/alerts-tab";
import { ForecastTab } from "@/modules/cockpit/project/ui/forecast-tab";
import { ProjectHeader } from "@/modules/cockpit/project/ui/project-header";
import {
  ProjectTabs,
  parseProjectTab,
} from "@/modules/cockpit/project/ui/project-tabs";
import { MemoryPanel } from "@/modules/memory/ui/memory-panel";
import {
  StatusBoard,
  parseFeedDays,
  parseFeedTeam,
} from "@/modules/memory/ui/status-board";
import { TeamPanel } from "@/modules/cockpit/project/ui/team-panel";

import { ProjectPageSkeleton } from "./skeleton";

/**
 * Project cockpit. `params` and `searchParams` are awaited inside the
 * suspended subtree so the page shell can be prerendered while the data
 * streams in (Cache Components).
 *
 * Only the active tab is rendered server-side, so an unvisited tab never
 * costs a repository read.
 */

export async function generateMetadata({
  params,
}: PageProps<"/projects/[id]">): Promise<Metadata> {
  const { id } = await params;
  try {
    await connection();
    const { repo } = await getContainer();
    const project = await repo.projects.get(id);
    return { title: project?.name ?? "Proyecto" };
  } catch {
    return { title: "Proyecto" };
  }
}

function PlaceholderTab({ tab }: { tab: "metrics" | "reports" }) {
  if (tab === "metrics") {
    return (
      <EmptyState
        icon={BarChart3Icon}
        title="Métricas del equipo"
        description="Rendimiento, tiempo de ciclo, WIP y tiempo de revisión. Llegan en una etapa posterior."
      />
    );
  }
  return (
    <EmptyState
      icon={FileTextIcon}
      title="Informes"
      description="Informes de avance y para el cliente, con notas de evidencia. Llegan en una etapa posterior."
    />
  );
}

async function ProjectView({
  params,
  searchParams,
}: Pick<PageProps<"/projects/[id]">, "params" | "searchParams">) {
  // Booting the container reads the clock, so this subtree is request-time
  // rendered instead of prerendered (Cache Components).
  await connection();
  const [{ id }, query, { repo, clock }] = await Promise.all([
    params,
    searchParams,
    getContainer(),
  ]);

  const detail = await getProjectDetail(repo, id);
  if (detail === null) notFound();

  const tab = parseProjectTab(query.tab);
  const now = clock.now().toISOString();
  // Active = open + ack: acknowledging an alert does not clear the risk.
  const activeSeverities = detail.alerts
    .filter((alert) => alert.status !== "resolved")
    .map((alert) => alert.severity);

  return (
    <>
      <ProjectHeader
        project={detail.project}
        activeAlertSeverities={activeSeverities}
        syncRuns={detail.syncRuns}
        now={now}
      />
      <ProjectTabs
        projectId={detail.project.id}
        activeTab={tab}
        openAlertCount={detail.openAlertCount}
      >
        {tab === "forecast" ? (
          <ForecastTab sprint={detail.sprint} budget={detail.budget} />
        ) : tab === "alerts" ? (
          <AlertsTab
            alerts={detail.alerts}
            projectId={detail.project.id}
            now={now}
          />
        ) : tab === "memory" ? (
          <div className="space-y-6">
            <StatusBoard
              projectId={detail.project.id}
              days={parseFeedDays(query.days)}
              selectedTeamId={parseFeedTeam(query.team)}
            />
            <MemoryPanel projectId={detail.project.id} />
          </div>
        ) : tab === "team" ? (
          <TeamPanel projectId={detail.project.id} />
        ) : (
          <PlaceholderTab tab={tab} />
        )}
      </ProjectTabs>
    </>
  );
}

export default function ProjectPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<ProjectPageSkeleton />}>
      <ProjectView params={params} searchParams={searchParams} />
    </Suspense>
  );
}
