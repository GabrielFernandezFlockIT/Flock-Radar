/**
 * Shared result shape for the team and status server actions.
 *
 * It lives outside the `"use server"` module on purpose: that file may only
 * export async functions, so the state type and its initial value belong here,
 * where both the actions and the client forms can import them.
 */
export interface TeamFormState {
  status: "idle" | "ok" | "error";
  message: string | null;
}

export const INITIAL_TEAM_FORM_STATE: TeamFormState = {
  status: "idle",
  message: null,
};
