import { z } from "zod";

import { EvidenceListSchema } from "./evidence";
import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  UuidSchema,
} from "./primitives";

export const MEMORY_ITEM_KINDS = [
  "done",
  "pending",
  "decision",
  "risk",
  "next_step",
] as const;
export const MemoryItemKindSchema = z.enum(MEMORY_ITEM_KINDS);
export type MemoryItemKind = z.infer<typeof MemoryItemKindSchema>;

export const MEMORY_ITEM_STATUSES = ["open", "resolved"] as const;
export const MemoryItemStatusSchema = z.enum(MEMORY_ITEM_STATUSES);
export type MemoryItemStatus = z.infer<typeof MemoryItemStatusSchema>;

/** A remembered fact about the team's work. Never stored without evidence. */
export const MemoryItemSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  kind: MemoryItemKindSchema,
  summary: NonEmptyStringSchema,
  evidence: EvidenceListSchema,
  occurredAt: IsoDateTimeSchema,
  status: MemoryItemStatusSchema,
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

/** Embedding dimensions shared by every embedder and the pgvector column (D-003). */
export const EMBEDDING_DIMENSIONS = 1024;
