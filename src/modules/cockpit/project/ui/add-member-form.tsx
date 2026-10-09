"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { addTeamMemberAction } from "@/app/projects/[id]/team-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEAM_ROLE_LABELS } from "@/modules/cockpit/shared/ui/labels";
import { TEAM_ROLES } from "@/shared/domain";

import { Field, FormMessage, Select } from "./field";
import { INITIAL_TEAM_FORM_STATE } from "./team-form-state";

interface DirectoryPerson {
  id: string;
  fullName: string;
}

/**
 * Add a person to a team: pick someone from the organization directory, or
 * create a new person inline (full name + optional email). The role comes from
 * the `TeamRole` enum rendered with Spanish labels.
 */
export function AddMemberForm({
  projectId,
  teamId,
  people,
}: {
  projectId: string;
  teamId: string;
  people: readonly DirectoryPerson[];
}) {
  const [state, formAction, pending] = useActionState(
    addTeamMemberAction,
    INITIAL_TEAM_FORM_STATE,
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"existing" | "new">(
    people.length > 0 ? "existing" : "new",
  );

  useEffect(() => {
    if (state.status === "ok") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="teamId" value={teamId} />

      {people.length > 0 ? (
        <div
          role="radiogroup"
          aria-label="Origen de la persona"
          className="flex gap-2 text-xs"
        >
          <Button
            type="button"
            size="sm"
            variant={mode === "existing" ? "secondary" : "ghost"}
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
          >
            Persona existente
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "new" ? "secondary" : "ghost"}
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            Nueva persona
          </Button>
        </div>
      ) : null}

      {mode === "existing" ? (
        <Field label="Persona" htmlFor={`member-person-${teamId}`}>
          <Select id={`member-person-${teamId}`} name="personId" defaultValue="" required>
            <option value="" disabled>
              Elegir persona…
            </option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="space-y-3">
          <Field label="Nombre y apellido" htmlFor={`member-name-${teamId}`}>
            <Input
              id={`member-name-${teamId}`}
              name="newFullName"
              autoComplete="off"
              maxLength={120}
            />
          </Field>
          <Field label="Email (opcional)" htmlFor={`member-email-${teamId}`}>
            <Input
              id={`member-email-${teamId}`}
              name="newEmail"
              type="email"
              autoComplete="off"
              maxLength={160}
            />
          </Field>
        </div>
      )}

      <Field label="Rol en el equipo" htmlFor={`member-role-${teamId}`}>
        <Select id={`member-role-${teamId}`} name="role" defaultValue="developer">
          {TEAM_ROLES.map((role) => (
            <option key={role} value={role}>
              {TEAM_ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Agregar persona
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
