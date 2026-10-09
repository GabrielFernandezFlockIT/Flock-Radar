import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppConfig, getContainer } from "@/composition-root";
import { AskRadarChat } from "@/modules/chat/ui/ask-radar-chat";

export const metadata: Metadata = {
  title: "Preguntar a Flock-Radar",
};

const NO_KEY_REASON =
  "ANTHROPIC_API_KEY no está configurada, así que Flock-Radar no puede llamar al modelo. Todo lo demás sigue funcionando: los pronósticos y las alertas se calculan de forma determinista, y las explicaciones de las alertas se generan con plantillas construidas a partir de los indicadores de cada detector. Configure ANTHROPIC_API_KEY y reinicie para habilitar el chat.";

/**
 * The project selector needs the container, which reads the clock and syncs
 * the demo scenario, so it renders at request time behind a Suspense boundary
 * while the page shell streams immediately (Cache Components).
 */
async function Chat() {
  await connection();
  const { llmAvailable } = getAppConfig();
  const { repo } = await getContainer();
  const projects = await repo.projects.list();

  return (
    <AskRadarChat
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        jiraKey: project.jiraKey,
      }))}
      llmAvailable={llmAvailable}
      disabledReason={NO_KEY_REASON}
    />
  );
}

export default function AskPage() {
  return (
    <>
      <PageHeader
        title="Preguntar a Flock-Radar"
        description="Haga preguntas sobre Jira, GitHub, Calendario y Flocktools. Cada respuesta cita su evidencia."
      />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Chat />
      </Suspense>
    </>
  );
}
