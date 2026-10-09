import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Button } from "@/components/ui/button";

export default function StatusNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState
        icon={SearchXIcon}
        title="Status no encontrado"
        description="Este status no existe o pertenece a otro proyecto."
      />
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <Link href="/">Volver al portafolio</Link>
        </Button>
      </div>
    </div>
  );
}
