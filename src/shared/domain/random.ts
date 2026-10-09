/**
 * Seeded pseudo-random numbers (decision D-009). Deterministic for a given
 * seed, so simulations and the demo scenario are reproducible. Not for
 * cryptographic use.
 */

/** 32-bit FNV-1a hash of a string, used to derive numeric seeds. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in the inclusive range [min, max]. */
  int(min: number, max: number): number;
  /** Float in [min, max). */
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  /** Returns a shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: string | number): Rng {
  const next = mulberry32(typeof seed === "number" ? seed : hashSeed(seed));
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    float: (min, max) => min + next() * (max - min),
    pick: (items) => {
      if (items.length === 0) throw new Error("Cannot pick from an empty list.");
      return items[int(0, items.length - 1)];
    },
    chance: (probability) => next() < probability,
    shuffle: (items) => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = int(0, index);
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }
      return copy;
    },
  };
}
