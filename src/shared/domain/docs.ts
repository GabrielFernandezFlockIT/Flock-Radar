import { z } from "zod";

import {
  HttpUrlSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  UuidSchema,
} from "./primitives";

/** A reference to a project document (Flocktools ADR, runbook, checklist). */
export const DocRefSchema = z.object({
  projectId: UuidSchema,
  /** Unique per project; used as the evidence external id. */
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: NonEmptyStringSchema,
  url: HttpUrlSchema,
  updatedAt: IsoDateTimeSchema,
  /** Short plain-text excerpt; untrusted content when sent to the LLM. */
  excerpt: z.string(),
});
export type DocRef = z.infer<typeof DocRefSchema>;
