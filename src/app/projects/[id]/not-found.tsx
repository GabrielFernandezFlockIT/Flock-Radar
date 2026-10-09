import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState
        icon={SearchXIcon}
        title="Proyecto no encontrado"
        description="Este proyecto no existe o no forma parte del espacio de trabajo actual."
      />
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <Link href="/">Volver al portafolio</Link>
        </Button>
      </div>
    </div>
  );
}
