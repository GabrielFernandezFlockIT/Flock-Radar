import type { Evidence, MemoryItem } from "@/shared/domain";

/**
 * SEAM FOR PHASE 4 — Claude extraction. Nothing implements this yet.
 *
 * The rule-based pipeline (this slice) produces every memory item
 * deterministically. Phase 4 adds ONE structured Claude call per project that
 * reads the same records and proposes extra `decision`, `risk`, and
 * `next_step` items plus friendlier summaries for the rule-based ones.
 *
 * Contract when it lands:
 * - The adapter receives `records` (the evidence the snapshot can back) and
 *   the rule-based `items`; it may only cite evidence from `records`.
 * - `buildMemory` passes the result through `restrictEvidenceTo(records)` and
 *   `withEvidence` before any write, so a hallucinated citation is dropped
 *   server-side rather than trusted.
 * - Ids stay deterministic (`memoryItemId`), so an LLM rerun upserts instead
 *   of duplicating.
 *
 * TODO(phase-4): implement in `src/adapters/llm`, wire it in the composition
 * root, and pass it here as an optional dependency. No LLM call happens in
 * this slice.
 */
export interface MemoryNarrator {
  narrate(input: {
    projectId: string;
    /** Every piece of evidence the snapshot can back. The citation allow-list. */
    records: readonly Evidence[];
    /** Deterministic items already produced by the rules. */
    items: readonly MemoryItem[];
  }): Promise<MemoryItem[]>;
}
