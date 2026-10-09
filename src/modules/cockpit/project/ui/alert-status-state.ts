/**
 * Result of the alert-triage server action.
 *
 * It lives outside the `"use server"` module on purpose: that file may only
 * export async functions, so the state type and its initial value belong
 * here, where both the action and the form can import them.
 */
export interface AlertStatusState {
  status: "idle" | "ok" | "error";
  message: string | null;
}

export const INITIAL_ALERT_STATUS_STATE: AlertStatusState = {
  status: "idle",
  message: null,
};
