"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createStatusAction } from "@/app/projects/[id]/team-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FormMessage,
  Select,
} from "@/modules/cockpit/project/ui/field";
import {
  INITIAL_TEAM_FORM_STATE,
} from "@/modules/cockpit/project/ui/team-form-state";
import { TEAM_ROLE_LABELS } from "@/modules/cockpit/shared/ui/labels";
import type { TeamRole } from "@/shared/domain";

export interface EntryFormMember {
  personId: string;
  fullName: string;
  role: TeamRole;
}

export interface EntryFormTeam {
  id: string;
  name: string;
  members: EntryFormMember[];
}

/**
 * Load (or update) a daily status. The subject person and "cargado por" lists
 * follow the selected team. Upserting the same (person, day) replaces the
 * entry, which the copy makes explicit.
 */
export function StatusEntryForm({
  projectId,
  teams,
  todayIso,
}: {
  projectId: string;
  teams: readonly EntryFormTeam[];
  todayIso: string;
}) {
  const [state, formAction, pending] = useActionState(
    createStatusAction,
    INITIAL_TEAM_FORM_STATE,
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");

  const members = useMemo(
    () => teams.find((team) => team.id === teamId)?.members ?? [],
    [teams, teamId],
  );

  // Keep the selected team after a successful load (the user often enters
  // several statuses for the same team); only the free-text fields reset.
  useEffect(() => {
    if (state.status === "ok") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  if (teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Cree un equipo y sume integrantes para poder cargar status.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />

      {teams.length > 1 ? (
        <Field label="Equipo" htmlFor="status-team">
          <Select
            id="status-team"
            name="teamId"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="teamId" value={teamId} />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Persona" htmlFor="status-person">
          <Select id="status-person" name="personId" defaultValue="" required>
            <option value="" disabled>
              Elegir persona…
            </option>
            {members.map((member) => (
              <option key={member.personId} value={member.personId}>
                {member.fullName} · {TEAM_ROLE_LABELS[member.role]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha" htmlFor="status-date">
          <Input
            id="status-date"
            name="reportedOn"
            type="date"
            defaultValue={todayIso}
            max={todayIso}
            required
          />
        </Field>
      </div>

      <Field label="Avances" htmlFor="status-summary">
        <Textarea id="status-summary" name="summary" rows={2} required maxLength={2000} />
      </Field>
      <Field label="Bloqueos (opcional)" htmlFor="status-blockers">
        <Textarea id="status-blockers" name="blockers" rows={2} maxLength={2000} />
      </Field>
      <Field label="Próximos pasos (opcional)" htmlFor="status-next">
        <Textarea id="status-next" name="nextSteps" rows={2} maxLength={2000} />
      </Field>

      <Field
        label="Cargado por (opcional)"
        htmlFor="status-author"
        hint="Si ya existe un status de esa persona para ese día, se actualizará el status del día."
      >
        <Select id="status-author" name="authorPersonId" defaultValue="">
          <option value="">La misma persona</option>
          {members.map((member) => (
            <option key={member.personId} value={member.personId}>
              {member.fullName}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Cargar status
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
