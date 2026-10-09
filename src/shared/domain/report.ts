import { z } from "zod";

import {
  IsoDateSchema,
  IsoDateTimeSchema,
  UuidSchema,
} from "./primitives";

export const REPORT_KINDS = ["progress", "client", "weekly"] as const;
export const ReportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKindSchema>;

/**
 * A generated report. `content` is the structured, evidence-backed document
 * (shape owned by the reports module, phase 8); `markdown` is its editable
 * rendering.
 */
/** Largest markdown body accepted (bytes), mirrored by a DB check constraint. */
export const MAX_REPORT_MARKDOWN_BYTES = 200_000;

export const ReportFieldsSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  kind: ReportKindSchema,
  periodStart: IsoDateSchema,
  periodEnd: IsoDateSchema,
  content: z.unknown(),
  markdown: z
    .string()
    .refine(
      (markdown) =>
        new TextEncoder().encode(markdown).length <= MAX_REPORT_MARKDOWN_BYTES,
      { message: `Report.markdown must be at most ${MAX_REPORT_MARKDOWN_BYTES} bytes` },
    ),
  /** Auth user id of the author; `null` for system-generated reports. */
  createdBy: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});

/** Refined variant; derive new schemas from `ReportFieldsSchema` (Zod 4). */
export const ReportSchema = ReportFieldsSchema.refine(
  (report) => report.periodStart <= report.periodEnd,
  {
    message: "Report.periodStart must be on or before Report.periodEnd",
    path: ["periodEnd"],
  },
);
export type Report = z.infer<typeof ReportSchema>;
