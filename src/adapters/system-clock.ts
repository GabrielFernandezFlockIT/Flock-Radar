import type { Clock } from "@/shared/ports/clock";

/** Production clock backed by the host system time. */
export const systemClock: Clock = {
  now: () => new Date(),
};
