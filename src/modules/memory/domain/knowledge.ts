import { withEvidence, type MemoryItem } from "@/shared/domain";

import { commentEvidence, docEvidence, issueEvidence } from "./evidence";
import { memoryItemId } from "./ids";
import { issuesByKey } from "./links";
import { type MemorySnapshot } from "./snapshot";

/**
 * Decisions, risks, and next steps WITHOUT an LLM.
 *
 * Phase 4 will add Claude extraction over the same records (see the
 * `MemoryNarrator` seam in the application layer). Until then these rules stay
 * deliberately conservative: a kind stays EMPTY rather than guessing, because
 * an invented "decision" is exactly the kind of claim the evidence rule exists
 * to prevent.
 *
 * - `decision`: a document whose slug or title marks it as an ADR or a
 *   decision record. The doc itself is the evidence.
 * - `risk`: a Jira comment that states the work is blocked, on an issue that
 *   is not done. The comment is the evidence.
 * - `next_step`: nothing in this slice. No record in the data spine states a
 *   future commitment in a form a rule can read without guessing; pending
 *   items already carry the actionable backlog. Phase 4 fills this from the
 *   LLM extraction, grounded in the same records.
 */

const DECISION_MARKERS = [/^adr[-\s]?\d+/i, /^decision[:\s]/i, /\bdecision record\b/i];

const BLOCKED_MARKERS = [/\bblocked on\b/i, /\bblocked by\b/i, /\bwaiting on\b/i];

export function isDecisionDoc(slug: string, title: string): boolean {
  const haystacks = [title.trim(), slug.replace(/-/g, " ").trim()];
  return haystacks.some((text) => DECISION_MARKERS.some((marker) => marker.test(text))) ||
    /(^|-)adr(-|$)/i.test(slug);
}

export function detectDecisions(snapshot: MemorySnapshot): MemoryItem[] {
  const items = snapshot.docs
    .filter((doc) => isDecisionDoc(doc.slug, doc.title))
    .map((doc) => ({
      id: memoryItemId(snapshot.project.id, "decision", "doc", doc.slug),
      projectId: snapshot.project.id,
      kind: "decision" as const,
      summary: `${doc.title} (${doc.slug}).`,
      evidence: [docEvidence(doc, "Registro de decisión")],
      occurredAt: doc.updatedAt,
      status: "resolved" as const,
    }));
  return withEvidence(items);
}

export function statesBlocked(body: string): boolean {
  return BLOCKED_MARKERS.some((marker) => marker.test(body));
}

export function detectRisks(snapshot: MemorySnapshot): MemoryItem[] {
  const byKey = issuesByKey(snapshot.issues);
  const items = snapshot.issueComments.flatMap((comment) => {
    if (!statesBlocked(comment.body)) return [];
    const issue = byKey.get(comment.issueKey);
    if (!issue || issue.statusCategory === "done") return [];
    return [
      {
        id: memoryItemId(
          snapshot.project.id,
          "risk",
          "blocked_comment",
          `${comment.issueKey}:${comment.id}`,
        ),
        projectId: snapshot.project.id,
        kind: "risk" as const,
        summary: `${comment.issueKey} está reportada como bloqueada: ${comment.author} lo señaló mientras la incidencia está en ${issue.status}.`,
        evidence: [
          commentEvidence(comment, "Bloqueada"),
          issueEvidence(issue, issue.status),
        ],
        occurredAt: comment.createdAt,
        status: "open" as const,
      },
    ];
  });
  return withEvidence(items);
}

/**
 * Next steps: intentionally empty in this slice. Kept as a named rule so the
 * pipeline shape does not change when phase 4 fills it.
 */
export function detectNextSteps(): MemoryItem[] {
  return [];
}
