import { UsersIcon } from "lucide-react";

import { getContainer } from "@/composition-root";
import { EmptyState } from "@/components/app-shell/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getTeamOverview, type TeamMemberView } from "@/modules/cockpit/project/application/get-team-overview";
import { TEAM_ROLE_LABELS } from "@/modules/cockpit/shared/ui/labels";
import { formatDayWithYear } from "@/modules/cockpit/shared/ui/format";

import { AddMemberForm } from "./add-member-form";
import { ConfirmAction } from "./confirm-action";
import { CreateTeamForm } from "./create-team-form";
import { removeTeamMemberAction, setTeamActiveAction } from "@/app/projects/[id]/team-actions";

/**
 * "Equipo" tab (server component): the project's teams with their members,
 * plus the forms to create a team, add people, remove a membership, and
 * disband or restore a team. Data loading reads the container directly, like
 * the memory panel; every mutation goes through a server action.
 */

function MembershipPeriod({ member }: { member: TeamMemberView }) {
  return (
    <span className="text-xs text-muted-foreground">
      Desde {formatDayWithYear(member.startedOn)}
      {member.endedOn === null
        ? " · actual"
        : ` · hasta ${formatDayWithYear(member.endedOn)}`}
    </span>
  );
}

function MemberRow({
  member,
  projectId,
}: {
  member: TeamMemberView;
  projectId: string;
}) {
  const isLead = member.role === "lead";
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{member.fullName}</span>
          <Badge variant={isLead ? "secondary" : "outline"}>
            {TEAM_ROLE_LABELS[member.role]}
          </Badge>
        </div>
        <MembershipPeriod member={member} />
      </div>
      <ConfirmAction
        action={removeTeamMemberAction}
        fields={{ projectId, memberId: member.membershipId }}
        triggerLabel="Quitar"
        triggerVariant="ghost"
        title={`Quitar a ${member.fullName}`}
        description="Se eliminará su membresía en este equipo. Los status que haya cargado se conservan."
        confirmLabel="Quitar"
      />
    </li>
  );
}

function TeamCard({
  view,
  projectId,
  directory,
}: {
  view: Awaited<ReturnType<typeof getTeamOverview>>["teams"][number];
  projectId: string;
  directory: { id: string; fullName: string }[];
}) {
  const { team, members } = view;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2">
              {team.name}
              <Badge variant={team.active ? "secondary" : "outline"}>
                {team.active ? "Activo" : "Inactivo"}
              </Badge>
            </CardTitle>
            {team.description ? (
              <CardDescription>{team.description}</CardDescription>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {members.length === 0
                ? "Sin integrantes"
                : `${members.length} ${members.length === 1 ? "integrante" : "integrantes"}`}
            </p>
          </div>
          <ConfirmAction
            action={setTeamActiveAction}
            fields={{
              projectId,
              teamId: team.id,
              active: team.active ? "false" : "true",
            }}
            triggerLabel={team.active ? "Desactivar" : "Reactivar"}
            triggerVariant="outline"
            title={team.active ? `Desactivar ${team.name}` : `Reactivar ${team.name}`}
            description={
              team.active
                ? "El equipo quedará inactivo. Conserva sus integrantes, su historial y sus status."
                : "El equipo volverá a estar activo."
            }
            confirmLabel={team.active ? "Desactivar" : "Reactivar"}
            confirmVariant={team.active ? "destructive" : "secondary"}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este equipo todavía no tiene integrantes. Agregue a la primera persona.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <MemberRow key={member.membershipId} member={member} projectId={projectId} />
            ))}
          </ul>
        )}

        <Separator />
        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Agregar persona
          </h3>
          <AddMemberForm projectId={projectId} teamId={team.id} people={directory} />
        </section>
      </CardContent>
    </Card>
  );
}

export async function TeamPanel({ projectId }: { projectId: string }) {
  const { repo } = await getContainer();
  const { teams, people } = await getTeamOverview(repo, projectId);
  const directory = people.map((person) => ({ id: person.id, fullName: person.fullName }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Nuevo equipo</CardTitle>
          <CardDescription>
            Cree un equipo para este proyecto y luego sume a sus integrantes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTeamForm projectId={projectId} />
        </CardContent>
      </Card>

      {teams.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Este proyecto no tiene equipos"
          description="Cree el primer equipo con el formulario de arriba para empezar a sumar personas y cargar status."
        />
      ) : (
        <div className="space-y-4">
          {teams.map((view) => (
            <TeamCard
              key={view.team.id}
              view={view}
              projectId={projectId}
              directory={directory}
            />
          ))}
        </div>
      )}
    </div>
  );
}
