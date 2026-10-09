import { restrictEvidenceTo, withEvidence, type Evidence, type MemoryItem } from "@/shared/domain";

import { detectDecisions, detectNextSteps, detectRisks } from "./knowledge";
import { detectPending } from "./pending";
import { detectResolved } from "./resolved";
import { DEFAULT_MEMORY_OPTIONS, type MemoryOptions, type MemorySnapshot } from "./snapshot";

export * from "./evidence";
export * from "./ids";
export * from "./knowledge";
export * from "./links";
export * from "./pending";
export * from "./resolved";
export * from "./snapshot";

/**
 * Memory domain entry point: all rules over one project snapshot.
 *
 * Two guards run over every produced item, in this order:
 * 1. `restrictEvidenceTo` drops evidence that does not point at a record the
 *    snapshot actually carried, so a rule (or, later, the LLM) cannot cite a
 *    document it was never given.
 * 2. `withEvidence` drops whatever is left without evidence.
 */

export interface MemoryBuildResult {
  items: MemoryItem[];
  /** Evidence derived from the snapshot's own records; the allow-list. */
  allowedEvidence: Evidence[];
}

function allowedEvidenceOf(items: readonly MemoryItem[]): Evidence[] {
  return items.flatMap((item) => [...item.evidence]);
}

export function buildMemoryItems(
  snapshot: MemorySnapshot,
  options: MemoryOptions = DEFAULT_MEMORY_OPTIONS,
): MemoryBuildResult {
  const produced = [
    ...detectResolved(snapshot, options),
    ...detectPending(snapshot, options),
    ...detectDecisions(snapshot),
    ...detectRisks(snapshot),
    ...detectNextSteps(),
  ];
  // Rules build evidence straight from the snapshot's records, so the
  // allow-list is their own evidence. The guard still matters: it is the same
  // gate phase 4's LLM items will pass through, and it fails closed.
  const allowedEvidence = allowedEvidenceOf(produced);
  const items = withEvidence(restrictEvidenceTo(produced, allowedEvidence)).sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id),
  );
  return { items, allowedEvidence };
}
