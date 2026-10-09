/**
 * Source of "now". Injected everywhere time matters so the demo seed and the
 * forecast engine stay deterministic relative to a controllable date.
 */
export interface Clock {
  now(): Date;
}
