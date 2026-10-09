"use client";

import { useEffect } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Error boundary for the project cockpit. It never renders the error message
 * or the stack: those can carry internals (ids, upstream reasons). Only the
 * digest is shown, which is the handle to the server-side log entry.
 */
export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Project page failed to render", error.digest ?? "no digest");
  }, [error]);

  return (
    <Card className="border-destructive/40">
      <CardHeader className="items-center py-10 text-center">
        <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10">
          <TriangleAlertIcon
            className="size-5 text-destructive"
            aria-hidden="true"
          />
        </div>
        <CardTitle>No se pudo cargar este proyecto</CardTitle>
        <CardDescription>
          Ocurrió un error al leer los datos del proyecto. El equipo tiene los
          detalles.
          {error.digest ? ` Referencia: ${error.digest}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-10">
        <Button onClick={reset} variant="outline">
          Reintentar
        </Button>
      </CardContent>
    </Card>
  );
}
