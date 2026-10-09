import { CheckCircle2Icon, ClockAlertIcon, LightbulbIcon } from "lucide-react";

import { getContainer } from "@/composition-root";
import { summarizeMemory } from "@/modules/memory/application/build-memory";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  MEMORY_KIND_LABELS,
  SOURCE_TYPE_SHORT_LABELS,
} from "@/modules/cockpit/shared/ui/labels";
import { toIsoDate, type Evidence, type MemoryItem } from "@/shared/domain";

/**
 * Memory tab of a project page (server component).
 *
 * Renders what the memory pipeline remembered: what got DONE with its full
 * evidence chain, what is PENDING grouped by the rule that found it, and the
 * decisions and next steps. Every bullet shows its evidence as clickable
 * chips — a claim with no chip cannot exist, because evidence-less items are
 * dropped before they are stored.
 */

function EvidenceChip({ evidence }: { evidence: Evidence }) {
  return (
    <Badge asChild variant="outline">
      <a
        href={evidence.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${SOURCE_TYPE_SHORT_LABELS[evidence.sourceType]}${evidence.label ? `: ${evidence.label}` : ""}`}
      >
        {evidence.externalId}
      </a>
    </Badge>
  );
}

/** Evidence as a flat chip row: order is not meaningful here. */
function EvidenceChips({ evidence }: { evidence: readonly Evidence[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {evidence.map((entry) => (
        <li key={`${entry.sourceType}:${entry.externalId}`}>
          <EvidenceChip evidence={entry} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Evidence as an ordered trail: issue -> PR -> merge commit. The order of
 * `MemoryItem.evidence` IS the chain, so it is rendered as given.
 */
function EvidenceTrail({ evidence }: { evidence: readonly Evidence[] }) {
  return (
    <ol className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {evidence.map((entry, index) => (
        <li key={`${entry.sourceType}:${entry.externalId}`} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              &rarr;
            </span>
          ) : null}
          <EvidenceChip evidence={entry} />
        </li>
      ))}
    </ol>
  );
}

function ItemRow({
  item,
  chain = false,
}: {
  item: MemoryItem;
  chain?: boolean;
}) {
  return (
    <li className="py-2.5">
      <p className="text-sm text-foreground">{item.summary}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {toIsoDate(new Date(item.occurredAt))}
      </p>
      {chain ? (
        <EvidenceTrail evidence={item.evidence} />
      ) : (
        <EvidenceChips evidence={item.evidence} />
      )}
    </li>
  );
}

function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

export async function MemoryPanel({ projectId }: { projectId: string }) {
  const { repo } = await getContainer();
  const items = await repo.memory.byProject(projectId);
  const { done, pending, decisions, risks, nextSteps } = summarizeMemory(items);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {MEMORY_KIND_LABELS.done}
            <Badge variant="secondary">{done.length}</Badge>
          </CardTitle>
          <CardDescription>
            Trabajo terminado con su cadena de evidencia: incidencia &rarr; pull request
            &rarr; commit de merge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done.length === 0 ? (
            <SectionEmpty>Nada resuelto en el período recordado.</SectionEmpty>
          ) : (
            <ul className="divide-y divide-border">
              {done.map((item) => (
                <ItemRow key={item.id} item={item} chain />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClockAlertIcon className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            {MEMORY_KIND_LABELS.pending}
            <Badge variant="secondary">
              {pending.reduce((total, group) => total + group.items.length, 0)}
            </Badge>
          </CardTitle>
          <CardDescription>Agrupados por la regla que los detectó.</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <SectionEmpty>
              No hay pendientes. Nada se está quedando sin seguimiento.
            </SectionEmpty>
          ) : (
            <div className="space-y-4">
              {pending.map((group, index) => (
                <section key={group.ruleId}>
                  {index > 0 ? <Separator className="mb-4" /> : null}
                  <h3 className="text-sm font-medium text-foreground">
                    {group.label}{" "}
                    <span className="text-muted-foreground">({group.items.length})</span>
                  </h3>
                  <p className="text-xs text-muted-foreground">{group.why}</p>
                  <ul className="divide-y divide-border">
                    {group.items.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LightbulbIcon className="size-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            Decisiones y próximos pasos
            <Badge variant="secondary">{decisions.length + risks.length + nextSteps.length}</Badge>
          </CardTitle>
          <CardDescription>
            Registros de decisión, riesgos señalados y próximos pasos acordados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <section>
            <h3 className="text-sm font-medium text-foreground">
              {MEMORY_KIND_LABELS.decision}
            </h3>
            {decisions.length === 0 ? (
              <SectionEmpty>No se encontraron registros de decisión.</SectionEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {decisions.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
          <Separator />
          <section>
            <h3 className="text-sm font-medium text-foreground">
              {MEMORY_KIND_LABELS.risk}
            </h3>
            {risks.length === 0 ? (
              <SectionEmpty>No se reportó ningún riesgo en el tracker.</SectionEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {risks.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
          <Separator />
          <section>
            <h3 className="text-sm font-medium text-foreground">
              {MEMORY_KIND_LABELS.next_step}
            </h3>
            {nextSteps.length === 0 ? (
              <SectionEmpty>
                Todavía no hay próximos pasos que se puedan citar desde los registros;
                la lista de pendientes es el backlog accionable.
              </SectionEmpty>
            ) : (
              <ul className="divide-y divide-border">
                {nextSteps.map((item) => (
                  <ItemRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
