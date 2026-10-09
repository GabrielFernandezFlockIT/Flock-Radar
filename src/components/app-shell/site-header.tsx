import Link from "next/link";
import { RadarIcon } from "lucide-react";

import { getAppConfig } from "@/composition-root";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { MainNav } from "./main-nav";

function ModeBadge({ mode }: { mode: "demo" | "live" }) {
  if (mode === "live") {
    return <Badge variant="outline">Datos en vivo</Badge>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="secondary" tabIndex={0}>
          Datos de demo
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Escenario precargado relativo a hoy. No se llama a ningún sistema externo.
      </TooltipContent>
    </Tooltip>
  );
}

export function SiteHeader() {
  // Config only: the header is part of the static shell and must not boot data.
  const { mode } = getAppConfig();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      {/* Mobile: brand + badge on the first row, nav below. sm+: one row. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:h-14 sm:flex-nowrap sm:px-6 sm:py-0">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <RadarIcon className="size-5" aria-hidden="true" />
          Flock-Radar
        </Link>
        <div className="ml-auto sm:order-last">
          <ModeBadge mode={mode} />
        </div>
        <MainNav className="order-last -mx-3 w-[calc(100%+1.5rem)] sm:order-none sm:mx-0 sm:w-auto" />
      </div>
    </header>
  );
}
