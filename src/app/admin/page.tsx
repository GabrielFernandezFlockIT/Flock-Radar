import type { Metadata } from "next";
import { SettingsIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = {
  title: "Administración",
};

export default function AdminPage() {
  return (
    <>
      <PageHeader
        title="Administración"
        description="Sincronizaciones, actualidad de los datos por fuente, y uso y costo del LLM."
      />
      <EmptyState
        icon={SettingsIcon}
        title="Todavía no hay nada para administrar"
        description="El historial de sincronizaciones y el costo del LLM aparecerán aquí cuando lleguen la ingesta y la capa de IA."
      />
    </>
  );
}
