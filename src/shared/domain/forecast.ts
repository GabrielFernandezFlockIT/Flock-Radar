import { z } from "zod";

import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  UuidSchema,
} from "./primitives";

/**
 * A persisted forecast run. `inputs` and `result` are JSON documents whose
 * shape is owned by the forecast module (phase 3); the spine stores them
 * opaquely so the engine can evolve without migrations.
 */
export const ForecastSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  /** e.g. `sprint_completion`, `budget_burn` (defined by the forecast module). */
  kind: NonEmptyStringSchema,
  computedAt: IsoDateTimeSchema,
  inputs: z.unknown(),
  result: z.unknown(),
});
export type Forecast = z.infer<typeof ForecastSchema>;
