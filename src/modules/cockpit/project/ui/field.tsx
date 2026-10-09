import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small form primitives shared by the team and status forms: a labelled field
 * wrapper, a native `<select>` styled to match the shadcn `Input`, and an
 * inline status message. Native controls keep the forms accessible and
 * submit-friendly without pulling in a heavier Select dependency.
 */

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[0.7rem] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function FormMessage({
  state,
}: {
  state: { status: "idle" | "ok" | "error"; message: string | null };
}) {
  if (state.status !== "error" || state.message === null) return null;
  return (
    <p role="status" className="text-xs text-red-700 dark:text-red-300">
      {state.message}
    </p>
  );
}
