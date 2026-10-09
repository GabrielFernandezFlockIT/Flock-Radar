import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { CalendarEventFieldsSchema, CalendarEventSchema } from "./calendar";
import {
  ProjectFieldsSchema,
  ProjectSchema,
  SprintFieldsSchema,
  SprintSchema,
} from "./project";
import { ReportFieldsSchema, ReportSchema } from "./report";
import { DateRangeFieldsSchema, DateRangeSchema } from "./time";

// Zod 4 throws when `.omit/.pick/.partial` are called on refined objects, so
// every refined entity exposes a plain Fields schema to derive from.
describe("Fields schemas", () => {
  it.each([
    ["Project", ProjectFieldsSchema, "id"],
    ["Sprint", SprintFieldsSchema, "id"],
    ["CalendarEvent", CalendarEventFieldsSchema, "title"],
    ["Report", ReportFieldsSchema, "id"],
    ["DateRange", DateRangeFieldsSchema, "end"],
  ] as const)("%s supports omit, pick, and partial", (_name, fields, key) => {
    const schema = fields as unknown as z.ZodObject<z.ZodRawShape>;
    const shapeKeys = Object.keys(schema.shape);
    expect(Object.keys(schema.omit({ [key]: true }).shape)).toEqual(
      shapeKeys.filter((field) => field !== key),
    );
    expect(Object.keys(schema.pick({ [key]: true }).shape)).toEqual([key]);
    expect(schema.partial().safeParse({}).success).toBe(true);
  });

  it("keeps the cross-field rules on the refined variants", () => {
    expect(
      DateRangeSchema.safeParse({ start: "2026-10-09", end: "2026-10-08" }).success,
    ).toBe(false);
    expect(
      CalendarEventSchema.safeParse({
        person: "ana",
        kind: "pto",
        title: "PTO",
        start: "2026-10-09T00:00:00Z",
        end: "2026-10-08T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(ProjectSchema).not.toBe(ProjectFieldsSchema);
    expect(SprintSchema).not.toBe(SprintFieldsSchema);
    expect(ReportSchema).not.toBe(ReportFieldsSchema);
  });
});
