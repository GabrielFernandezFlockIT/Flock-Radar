import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeftIcon } from "lucide-react";

import { getContainer } from "@/composition-root";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TEAM_ROLE_LABELS } from "@/modules/cockpit/shared/ui/labels";
import { formatDayWithYear } from "@/modules/cockpit/shared/ui/format";
import type { TeamRole } from "@/shared/domain";

/**
 * Daily-status detail page. It is the target of the internal `status`
 * evidence links (`/projects/{projectId}/statuses/{statusId}`), so an evidence
 * chip resolves to the full entry: person, team, date, and the three fields.
 *
 * Unknown ids render the shared not-found, mirroring the project page.
 */

export const metadata: Metadata = { title: "Status diario" };

async function StatusDetailView({
  params,
}: Pick<PageProps<"/projects/[id]/statuses/[statusId]">, "params">) {
  await connection();
  const [{ id, statusId }, { repo }] = await Promise.all([params, getContainer()]);

  const project = await repo.projects.get(id);
  if (project === null) notFound();

  const statuses = await repo.statuses.byProject(id);
  const status = statuses.find((candidate) => candidate.id === statusId);
  if (status === undefined) notFound();

  const [team, subject, author] = await Promise.all([
    repo.teams.get(status.teamId),
    repo.people.get(status.personId),
    repo.people.get(status.authorPersonId),
  ]);

  const members = await repo.teamMembers.byTeam(status.teamId);
  const role: TeamRole | null =
    members.find((member) => member.personId === status.personId)?.role ?? null;
  const onBehalf = status.authorPersonId !== status.personId;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/projects/${id}?tab=memory`}>
          <ArrowLeftIcon aria-hidden="true" />
          Volver a Memoria
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{subject?.fullName ?? "Persona desconocida"}</CardTitle>
            {role ? <Badge variant="outline">{TEAM_ROLE_LABELS[role]}</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {team?.name ?? "Equipo desconocido"} · {formatDayWithYear(status.reportedOn)}
          </p>
          {onBehalf ? (
            <p className="text-xs text-muted-foreground">
              Cargado por {author?.fullName ?? "otra persona"}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <section className="space-y-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Avances
            </h2>
            <p className="text-sm whitespace-pre-line text-foreground">{status.summary}</p>
          </section>

          <Separator />
          <section className="space-y-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Bloqueos
            </h2>
            {status.blockers === null ? (
              <p className="text-sm text-muted-foreground">Sin bloqueos reportados.</p>
            ) : (
              <p className="text-sm whitespace-pre-line text-foreground">{status.blockers}</p>
            )}
          </section>

          <Separator />
          <section className="space-y-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Próximos pasos
            </h2>
            {status.nextSteps === null ? (
              <p className="text-sm text-muted-foreground">Sin próximos pasos registrados.</p>
            ) : (
              <p className="text-sm whitespace-pre-line text-foreground">{status.nextSteps}</p>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StatusDetailPage({
  params,
}: PageProps<"/projects/[id]/statuses/[statusId]">) {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-muted-foreground">Cargando…</div>}>
      <StatusDetailView params={params} />
    </Suspense>
  );
}
