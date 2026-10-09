"use server";

import { revalidatePath } from "next/cache";

import { getContainer } from "@/composition-root";
import { STATUS_LABELS } from "@/modules/cockpit/shared/ui/labels";
import type { AlertStatusState } from "@/modules/cockpit/project/ui/alert-status-state";
import { AlertStatusSchema, canTransitionAlert } from "@/shared/domain";
import { AlertConflictError } from "@/shared/ports";

/**
 * Alert triage from the cockpit.
 *
 * The transition is validated here (the repository and, in live mode, a DB
 * trigger validate it again) and a conflicting reactivation comes back as a
 * message instead of an unhandled rejection. Nothing from the error object is
 * forwarded except the kind of conflict, so internals never reach the client.
 */

export async function setAlertStatusAction(
  _previous: AlertStatusState,
  formData: FormData,
): Promise<AlertStatusState> {
  const projectId = String(formData.get("projectId") ?? "");
  const alertId = String(formData.get("alertId") ?? "");
  const parsedStatus = AlertStatusSchema.safeParse(formData.get("status"));

  if (projectId === "" || alertId === "" || !parsedStatus.success) {
    return { status: "error", message: "No se entendió la solicitud." };
  }
  const nextStatus = parsedStatus.data;

  try {
    const { repo } = await getContainer();
    const alerts = await repo.alerts.byProject(projectId);
    const alert = alerts.find((candidate) => candidate.id === alertId);

    if (alert === undefined) {
      return { status: "error", message: "Esta alerta ya no existe." };
    }
    if (!canTransitionAlert(alert.status, nextStatus)) {
      return {
        status: "error",
        message: `Una alerta ${STATUS_LABELS[alert.status].toLowerCase()} no puede pasar a ${STATUS_LABELS[nextStatus].toLowerCase()}.`,
      };
    }

    const updated = await repo.alerts.setStatus(alertId, nextStatus);
    if (updated === null) {
      return { status: "error", message: "Esta alerta ya no existe." };
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/");
    return { status: "ok", message: null };
  } catch (error) {
    if (error instanceof AlertConflictError) {
      return {
        status: "error",
        message:
          "Ya hay otra alerta activa de este tipo. Resuélvala primero y luego reabra esta.",
      };
    }
    return {
      status: "error",
      message: "No se pudo actualizar la alerta. Intente nuevamente.",
    };
  }
}
