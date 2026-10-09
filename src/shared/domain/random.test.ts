import { describe, expect, it } from "vitest";

import { createRng, hashSeed } from "./random";

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng("beacon");
    const b = createRng("beacon");
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it("differs across seeds", () => {
    expect(createRng("atlas").next()).not.toBe(createRng("beacon").next());
    expect(hashSeed("atlas")).not.toBe(hashSeed("beacon"));
  });

  it("keeps values inside the requested bounds", () => {
    const rng = createRng(42);
    for (let index = 0; index < 1_000; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const integer = rng.int(3, 5);
      expect([3, 4, 5]).toContain(integer);
    }
  });

  it("shuffles without losing or duplicating items", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const shuffled = createRng("shuffle").shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
