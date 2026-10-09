import type { ReactNode } from "react";
import Link from "next/link";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Tabs are URL-driven (`?tab=`), so every tab is linkable and shareable and
 * the server renders only the active panel. The triggers are links, which
 * also makes them work without JavaScript and keeps back/forward honest.
 */

export const PROJECT_TABS = [
  { value: "forecast", label: "Pronóstico" },
  { value: "alerts", label: "Alertas" },
  { value: "memory", label: "Memoria" },
  { value: "team", label: "Equipo" },
  { value: "metrics", label: "Métricas" },
  { value: "reports", label: "Informes" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["value"];

const TAB_VALUES = new Set<string>(PROJECT_TABS.map((tab) => tab.value));

export const DEFAULT_PROJECT_TAB: ProjectTab = "forecast";

/** Unknown or missing `?tab=` falls back to the forecast tab. */
export function parseProjectTab(value: unknown): ProjectTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && TAB_VALUES.has(candidate)
    ? (candidate as ProjectTab)
    : DEFAULT_PROJECT_TAB;
}

export function ProjectTabs({
  projectId,
  activeTab,
  openAlertCount,
  children,
}: {
  projectId: string;
  activeTab: ProjectTab;
  openAlertCount: number;
  children: ReactNode;
}) {
  return (
    <Tabs value={activeTab} activationMode="manual" className="gap-4">
      <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-fit">
        {PROJECT_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} asChild>
            <Link
              href={`/projects/${projectId}?tab=${tab.value}`}
              scroll={false}
              prefetch={false}
            >
              {tab.label}
              {tab.value === "alerts" && openAlertCount > 0 ? (
                <span className="ml-1 rounded-4xl bg-muted px-1.5 text-[0.7rem] tabular-nums">
                  {openAlertCount}
                </span>
              ) : null}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={activeTab}>{children}</TabsContent>
    </Tabs>
  );
}
