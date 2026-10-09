"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { FormMessage } from "./field";
import { INITIAL_TEAM_FORM_STATE, type TeamFormState } from "./team-form-state";

type ButtonVariant = "secondary" | "outline" | "destructive" | "ghost";

/**
 * A confirm-then-submit control for the destructive and state-changing team
 * actions (remove a member, disband or restore a team). The dialog guards the
 * action; on success it closes and refreshes the streamed subtree.
 */
export function ConfirmAction({
  action,
  fields,
  triggerLabel,
  triggerVariant = "outline",
  title,
  description,
  confirmLabel,
  confirmVariant = "destructive",
}: {
  action: (previous: TeamFormState, formData: FormData) => Promise<TeamFormState>;
  fields: Readonly<Record<string, string>>;
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_TEAM_FORM_STATE);
  const router = useRouter();

  // `revalidatePath` drops the cache, but the open tab holds the streamed
  // subtree, so a refresh repaints it after the action succeeds. The dialog is
  // closed natively by the confirm/cancel `DialogClose`, so no state is set
  // here (a successful close happens on click).
  useEffect(() => {
    if (state.status === "ok") router.refresh();
  }, [state, router]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={triggerVariant}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <FormMessage state={state} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <DialogClose asChild>
              <Button type="submit" variant={confirmVariant} disabled={pending}>
                {confirmLabel}
              </Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
