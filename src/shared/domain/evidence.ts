import { z } from "zod";

import {
  IsoDateTimeSchema,
  LinkSchema,
  NonEmptyStringSchema,
} from "./primitives";

/**
 * Evidence: a pointer to the source record that backs a claim.
 *
 * Principle "evidence or it didn't happen": every alert, memory item, and
 * report bullet carries at least one `Evidence`. Items without it are dropped
 * server-side with `withEvidence`.
 */

export const EVIDENCE_SOURCE_TYPES = [
  "jira_issue",
  "jira_transition",
  "jira_comment",
  "jira_worklog",
  "jira_sprint",
  "github_pr",
  "github_review",
  "github_commit",
  "calendar_event",
  "doc",
  /** A daily status entry authored in this app; its URL is INTERNAL. */
  "status",
] as const;

export const EvidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const EvidenceSchema = z.object({
  sourceType: EvidenceSourceTypeSchema,
  /** Human-facing id: `BCN-123`, `#42`, a short commit SHA, a doc slug. */
  externalId: NonEmptyStringSchema,
  /**
   * An absolute http(s) URL for external records, or a root-relative app path
   * for records that live here (`status`). Both forms are safe to render.
   */
  url: LinkSchema,
  occurredAt: IsoDateTimeSchema,
  label: NonEmptyStringSchema.optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * The INTERNAL link a `status` evidence entry points at, under the existing
 * `/projects/{id}` route (D-057). The page itself is not built in this slice.
 */
export function statusEvidenceUrl(projectId: string, statusId: string): string {
  return `/projects/${projectId}/statuses/${statusId}`;
}

/** At least one piece of evidence; used by every evidence-backed entity. */
export const EvidenceListSchema = z.array(EvidenceSchema).min(1);

/**
 * Keeps only the items that carry at least one VALID piece of evidence.
 * Invalid entries (bad URL, unknown source type, malformed date) are removed
 * first, so an item whose evidence is all invalid is dropped too. Generic so
 * it works for alerts, memory items, report bullets, and drafts.
 */
export function withEvidence<T extends { evidence: readonly Evidence[] }>(
  items: readonly T[],
): T[] {
  return items.flatMap((item) => {
    const valid = item.evidence.filter(
      (entry) => EvidenceSchema.safeParse(entry).success,
    );
    if (valid.length === 0) return [];
    return [valid.length === item.evidence.length ? item : { ...item, evidence: valid }];
  });
}

function evidenceIdentity(evidence: Evidence): string {
  return `${evidence.sourceType}\u0000${evidence.externalId}\u0000${evidence.url}`;
}

/**
 * Removes duplicate evidence (same source type, external id, and URL),
 * keeping the first occurrence and the original order.
 */
export function dedupeEvidence(evidence: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const unique: Evidence[] = [];
  for (const item of evidence) {
    const identity = evidenceIdentity(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(item);
  }
  return unique;
}

/**
 * Grounds generated claims in the records they were built from: drops every
 * evidence entry that is not in `allowedEvidence` (matched on source type,
 * external id, and URL), then drops items left without evidence. Use it on
 * LLM output so the model cannot cite records it was never given.
 */
export function restrictEvidenceTo<T extends { evidence: readonly Evidence[] }>(
  items: readonly T[],
  allowedEvidence: readonly Evidence[],
): T[] {
  const allowed = new Set(allowedEvidence.map(evidenceIdentity));
  return items.flatMap((item) => {
    const kept = item.evidence.filter((entry) => allowed.has(evidenceIdentity(entry)));
    if (kept.length === 0) return [];
    return [kept.length === item.evidence.length ? item : { ...item, evidence: kept }];
  });
}
