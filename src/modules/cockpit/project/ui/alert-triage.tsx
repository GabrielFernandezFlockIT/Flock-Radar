"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { setAlertStatusAction } from "@/app/projects/[id]/actions";
import { Button } from "@/components/ui/button";
import type { AlertStatus } from "@/shared/domain";

import { STATUS_ACTION_LABELS } from "../../shared/ui/labels";
import { INITIAL_ALERT_STATUS_STATE } from "./alert-status-state";

/**
 * Alert triage controls. The server action validates the transition and
 * returns a message for conflicts (a second active alert of the same kind),
 * which is rendered inline instead of surfacing as an error boundary.
 */

export function AlertTriage({
  alertId,
  projectId,
  transitions,
}: {
  alertId: string;
  projectId: string;
  transitions: readonly AlertStatus[];
}) {
  const [state, formAction, pending] = useActionState(
    setAlertStatusAction,
    INITIAL_ALERT_STATUS_STATE,
  );
  const router = useRouter();

  // `revalidatePath` drops the cached entry, but this route renders at request
  // time behind a Suspense boundary, so the open tab still holds the tree it
  // streamed. Refreshing after a successful transition re-renders the list.
  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);

  if (transitions.length === 0) return null;

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="alertId" value={alertId} />
        <input type="hidden" name="projectId" value={projectId} />
        {transitions.map((status) => (
          <Button
            key={status}
            type="submit"
            name="status"
            value={status}
            size="sm"
            variant={status === "resolved" ? "outline" : "secondary"}
            disabled={pending}
          >
            {STATUS_ACTION_LABELS[status]}
          </Button>
        ))}
      </form>
      {state.status === "error" && state.message !== null ? (
        <p
          role="status"
          className="max-w-xs text-xs text-red-700 sm:text-right dark:text-red-300"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
