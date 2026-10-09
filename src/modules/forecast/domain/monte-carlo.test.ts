import { describe, expect, it } from "vitest";

import { createRng } from "@/shared/domain";

import { simulateSprintCompletion, type MonteCarloInput } from "./monte-carlo";

function run(overrides: Partial<MonteCarloInput> = {}) {
  return simulateSprintCompletion({
    remaining: 10,
    samples: [0, 1, 2, 3, 4, 5],
    dayFactors: Array(35).fill(1),
    sprintDays: 5,
    runs: 10_000,
    rng: createRng("seed"),
    ...overrides,
  });
}

describe("simulateSprintCompletion", () => {
  it("is deterministic for the same seed", () => {
    expect(run()).toEqual(run());
    expect(run({ rng: createRng("other") }).probability).not.toBe(run().probability);
  });

  it("gives a deterministic outcome for constant throughput", () => {
    const enough = run({ samples: [2], remaining: 10 });
    expect(enough.probability).toBe(1);
    expect(enough.p50Day).toBe(5);
    expect(enough.p85Day).toBe(5);
    expect(enough.expectedDay).toBe(5);
    expect(enough.cumulativeP50).toEqual([2, 4, 6, 8, 10]);
    expect(enough.cumulativeP85).toEqual([2, 4, 6, 8, 10]);

    const short = run({ samples: [2], remaining: 11 });
    expect(short.probability).toBe(0);
    expect(short.p50Day).toBe(6);
  });

  it("returns P = 1 and day 0 when nothing remains", () => {
    const result = run({ remaining: 0 });
    expect(result).toMatchObject({ probability: 1, p50Day: 0, p85Day: 0, expectedDay: 0 });
  });

  it("returns P = 0 with no remaining sprint days but still dates the completion", () => {
    const result = run({ sprintDays: 0, samples: [5] });
    expect(result.probability).toBe(0);
    expect(result.p50Day).toBe(2);
    expect(result.cumulativeP50).toEqual([]);
  });

  it("reports dates beyond the horizon as null for all-zero throughput", () => {
    const result = run({ samples: [0, 0, 0] });
    expect(result.probability).toBe(0);
    expect(result.p50Day).toBeNull();
    expect(result.p85Day).toBeNull();
    expect(result.expectedDay).toBeNull();
  });

  it("returns P = 0 without samples", () => {
    expect(run({ samples: [] }).probability).toBe(0);
  });

  it("never completes on zero-capacity days", () => {
    const result = run({ samples: [10], remaining: 10, dayFactors: [0, 0, 0, 0, 1, ...Array(30).fill(1)] });
    expect(result.probability).toBe(1);
    expect(result.p50Day).toBe(5);
    expect(result.cumulativeP50.slice(0, 4)).toEqual([0, 0, 0, 0]);
  });

  it("gives a higher probability with more capacity", () => {
    const low = run({ dayFactors: Array(35).fill(0.8) });
    const normal = run();
    const high = run({ dayFactors: Array(35).fill(1.2) });
    expect(low.probability).toBeLessThan(normal.probability);
    expect(normal.probability).toBeLessThan(high.probability);
  });

  it("orders the quantiles: P85 date not before P50, cone P85 not above P50", () => {
    const result = run();
    expect(result.p85Day ?? Infinity).toBeGreaterThanOrEqual(result.p50Day ?? 0);
    result.cumulativeP85.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(result.cumulativeP50[index]);
    });
  });

  it("matches the analytic probability of a two-valued throughput", () => {
    // 0 or 2 per day, need 6 in 5 days: P(at least 3 successes of 5) = 0.5.
    const result = run({ samples: [0, 2], remaining: 6 });
    expect(result.probability).toBeCloseTo(0.5, 1);
  });

  it("rejects a non-positive run count", () => {
    expect(() => run({ runs: 0 })).toThrow(/runs/);
  });

  it("runs 10,000 simulations in well under 50 ms", () => {
    const samples = Array.from({ length: 60 }, (_, index) => index % 7);
    run({ samples }); // warm up
    const started = performance.now();
    run({ samples, remaining: 17 });
    expect(performance.now() - started).toBeLessThan(50);
  });
});
