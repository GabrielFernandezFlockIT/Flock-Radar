import Link from "next/link";
import { NotebookPenIcon } from "lucide-react";

import { getContainer } from "@/composition-root";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { groupStatusesByDay } from "@/modules/cockpit/project/domain/group-statuses";
import { getTeamOverview } from "@/modules/cockpit/project/application/get-team-overview";
import { TEAM_ROLE_LABELS } from "@/modules/cockpit/shared/ui/labels";
import { formatDayWithYear } from "@/modules/cockpit/shared/ui/format";
import {
  addDays,
  startOfUtcDay,
  statusEvidenceUrl,
  toIsoDate,
  type Status,
  type TeamRole,
} from "@/shared/domain";

import {
  StatusEntryForm,
  type EntryFormTeam,
} from "./status-entry-form";

/**
 * Status feed + entry form for the Memoria tab (server component).
 *
 * The feed shows the project's daily statuses (newest first, grouped by day
 * then person) with a team selector and a "últimos N días" window. Both
 * filters are URL-driven (`?tab=memory&team=&days=`) so the server renders
 * only what is asked for, consistent with the tab navigation.
 */

export const STATUS_FEED_DAY_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_STATUS_FEED_DAYS = 14;

export function parseFeedDays(value: unknown): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = typeof candidate === "string" ? Number.parseInt(candidate, 10) : Number.NaN;
  return (STATUS_FEED_DAY_OPTIONS as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_STATUS_FEED_DAYS;
}

export function parseFeedTeam(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate !== "" ? candidate : null;
}

function feedHref(projectId: string, days: number, teamId: string | null): string {
  const team = teamId === null ? "" : `&team=${teamId}`;
  return `/projects/${projectId}?tab=memory&days=${days}${team}`;
}

function StatusCard({
  status,
  projectId,
  role,
  subjectName,
  authorName,
}: {
  status: Status;
  projectId: string;
  role: TeamRole | null;
  subjectName: string;
  authorName: string | null;
}) {
  const onBehalf = status.authorPersonId !== status.personId;
  return (
    <Card>
      <CardContent className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{subjectName}</span>
          {role ? <Badge variant="outline">{TEAM_ROLE_LABELS[role]}</Badge> : null}
          {onBehalf && authorName ? (
            <span className="text-xs text-muted-foreground">cargado por {authorName}</span>
          ) : null}
          <Link
            href={statusEvidenceUrl(projectId, status.id)}
            className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Ver detalle
          </Link>
        </div>

        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground">Avances</p>
          <p className="text-sm whitespace-pre-line text-foreground">{status.summary}</p>
        </div>

        {status.blockers !== null ? (
          <div className="space-y-0.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 dark:border-amber-400/40 dark:bg-amber-400/10">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              Bloqueos
            </p>
            <p className="text-sm whitespace-pre-line text-amber-900 dark:text-amber-100">
              {status.blockers}
            </p>
          </div>
        ) : null}

        {status.nextSteps !== null ? (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">Próximos pasos</p>
            <p className="text-sm whitespace-pre-line text-foreground">{status.nextSteps}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export async function StatusBoard({
  projectId,
  days,
  selectedTeamId,
}: {
  projectId: string;
  days: number;
  selectedTeamId: string | null;
}) {
  const { repo, clock } = await getContainer();
  const [{ teams }, allPeople] = await Promise.all([
    getTeamOverview(repo, projectId),
    repo.people.list(),
  ]);

  const today = startOfUtcDay(clock.now());
  const range = { start: toIsoDate(addDays(today, -(days - 1))), end: toIsoDate(today) };
  const activeTeamId =
    selectedTeamId !== null && teams.some((view) => view.team.id === selectedTeamId)
      ? selectedTeamId
      : null;

  const statuses =
    activeTeamId !== null
      ? await repo.statuses.byTeam(activeTeamId, range)
      : await repo.statuses.byProject(projectId, range);

  const nameById = new Map(allPeople.map((person) => [person.id, person.fullName]));
  const roleByTeamPerson = new Map<string, TeamRole>();
  for (const view of teams) {
    for (const member of view.members) {
      roleByTeamPerson.set(`${view.team.id}:${member.personId}`, member.role);
    }
  }

  const groups = groupStatusesByDay(statuses);
  const entryTeams: EntryFormTeam[] = teams.map((view) => ({
    id: view.team.id,
    name: view.team.name,
    members: view.members.map((member) => ({
      personId: member.personId,
      fullName: member.fullName,
      role: member.role,
    })),
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NotebookPenIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            Status diarios
          </CardTitle>
          <CardDescription>
            Lo que cada persona reportó, de lo más reciente a lo más antiguo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {teams.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Equipo</span>
                <Link
                  href={feedHref(projectId, days, null)}
                  className="rounded-md px-2 py-1 text-xs data-[active=true]:bg-muted data-[active=true]:font-medium"
                  data-active={activeTeamId === null}
                >
                  Todos
                </Link>
                {teams.map((view) => (
                  <Link
                    key={view.team.id}
                    href={feedHref(projectId, days, view.team.id)}
                    className="rounded-md px-2 py-1 text-xs data-[active=true]:bg-muted data-[active=true]:font-medium"
                    data-active={activeTeamId === view.team.id}
                  >
                    {view.team.name}
                  </Link>
                ))}
              </div>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Período</span>
              {STATUS_FEED_DAY_OPTIONS.map((option) => (
                <Link
                  key={option}
                  href={feedHref(projectId, option, activeTeamId)}
                  className="rounded-md px-2 py-1 text-xs data-[active=true]:bg-muted data-[active=true]:font-medium"
                  data-active={option === days}
                >
                  Últimos {option} días
                </Link>
              ))}
            </div>
          </div>

          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay status cargados en este período.
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.day} className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {formatDayWithYear(group.day)}
                  </h3>
                  <div className="space-y-2">
                    {group.items.map((status) => (
                      <StatusCard
                        key={status.id}
                        status={status}
                        projectId={projectId}
                        role={roleByTeamPerson.get(`${status.teamId}:${status.personId}`) ?? null}
                        subjectName={nameById.get(status.personId) ?? "Persona desconocida"}
                        authorName={nameById.get(status.authorPersonId) ?? null}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cargar status</CardTitle>
          <CardDescription>
            Registre el avance de una persona para un día. Fuente: carga manual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatusEntryForm
            projectId={projectId}
            teams={entryTeams}
            todayIso={range.end}
          />
        </CardContent>
      </Card>
    </div>
  );
}
