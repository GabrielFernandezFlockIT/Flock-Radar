"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createTeamAction } from "@/app/projects/[id]/team-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { Field, FormMessage } from "./field";
import { INITIAL_TEAM_FORM_STATE } from "./team-form-state";

/**
 * Create a team for the current project. On success the form clears and the
 * streamed server subtree repaints via `router.refresh()`, the same approach
 * the alert triage uses.
 */
export function CreateTeamForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(
    createTeamAction,
    INITIAL_TEAM_FORM_STATE,
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Nombre del equipo" htmlFor="team-name">
        <Input id="team-name" name="name" required maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Descripción (opcional)" htmlFor="team-description">
        <Textarea id="team-description" name="description" rows={2} maxLength={400} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Crear equipo
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
