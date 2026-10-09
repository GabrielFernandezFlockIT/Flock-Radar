import type { Rng } from "@/shared/domain";

/**
 * Bootstrap Monte Carlo of sprint completion (decision D-037).
 *
 * Each run walks the projected working days in order. On every day it draws
 * one historical daily throughput uniformly at random (with replacement,
 * zero days included) and scales it by that day's capacity factor; the run
 * completes on the first day its cumulative throughput reaches the
 * remaining work. Runs continue past the sprint end (up to the horizon) only
 * to date the P50/P85 completion; the probability counts runs that finish
 * within the sprint's remaining days.
 */

export interface MonteCarloInput {
  /** Work left, in the forecast unit. */
  remaining: number;
  /** Historical daily throughput samples (working days, zeros included). */
  samples: readonly number[];
  /**
   * Capacity factor of each projected working day, in order. The first
   * `sprintDays` are inside the sprint; the rest extend the horizon.
   */
  dayFactors: readonly number[];
  /** Remaining working days of the sprint (<= `dayFactors.length`). */
  sprintDays: number;
  runs: number;
  rng: Rng;
}

export interface MonteCarloResult {
  runs: number;
  /** Share of runs that complete within `sprintDays`. */
  probability: number;
  /**
   * 1-based index into `dayFactors` of the completion day reached by 50% /
   * 85% of runs; 0 when nothing remains; `null` beyond the horizon.
   */
  p50Day: number | null;
  p85Day: number | null;
  /** Mean completion day of the runs that complete, when the median does. */
  expectedDay: number | null;
  /**
   * Per remaining sprint day: cumulative throughput reached by at least 50%
   * (median) and at least 85% of runs (15th percentile). Drives the cone.
   */
  cumulativeP50: number[];
  cumulativeP85: number[];
}

/** Tolerance for floating-point sums of scaled samples. */
const EPSILON = 1e-9;

/** Smallest value reached by at least `share` of the sorted (ascending) runs. */
function reachedBy(sorted: ArrayLike<number>, share: number): number {
  const index = Math.max(0, Math.floor((1 - share) * sorted.length + EPSILON));
  return sorted[Math.min(index, sorted.length - 1)];
}

/** Value at quantile `q` of sorted (ascending) runs: the ceil(q*n)-th smallest. */
function quantile(sorted: ArrayLike<number>, q: number): number {
  const index = Math.max(0, Math.ceil(q * sorted.length - EPSILON) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function simulateSprintCompletion(input: MonteCarloInput): MonteCarloResult {
  const { remaining, samples, dayFactors, runs, rng } = input;
  const horizon = dayFactors.length;
  const sprintDays = Math.max(0, Math.min(input.sprintDays, horizon));
  if (!Number.isInteger(runs) || runs <= 0) {
    throw new Error("simulateSprintCompletion: runs must be a positive integer.");
  }

  if (remaining <= EPSILON) {
    return {
      runs,
      probability: 1,
      p50Day: 0,
      p85Day: 0,
      expectedDay: 0,
      cumulativeP50: Array<number>(sprintDays).fill(0),
      cumulativeP85: Array<number>(sprintDays).fill(0),
    };
  }

  if (samples.length === 0 || horizon === 0) {
    return {
      runs,
      probability: 0,
      p50Day: null,
      p85Day: null,
      expectedDay: null,
      cumulativeP50: Array<number>(sprintDays).fill(0),
      cumulativeP85: Array<number>(sprintDays).fill(0),
    };
  }

  const sampleCount = samples.length;
  const target = remaining - EPSILON;
  const completion = new Float64Array(runs);
  // Day-major layout so each day's runs are contiguous for sorting.
  const cumulative = new Float64Array(runs * sprintDays);
  let completedInSprint = 0;

  for (let run = 0; run < runs; run += 1) {
    let total = 0;
    let doneDay = Number.POSITIVE_INFINITY;
    for (let day = 0; day < horizon; day += 1) {
      if (day >= sprintDays && doneDay !== Number.POSITIVE_INFINITY) break;
      const draw = samples[Math.floor(rng.next() * sampleCount)];
      total += draw * dayFactors[day];
      if (day < sprintDays) cumulative[day * runs + run] = total;
      if (doneDay === Number.POSITIVE_INFINITY && total >= target) doneDay = day + 1;
    }
    completion[run] = doneDay;
    if (doneDay <= sprintDays) completedInSprint += 1;
  }

  completion.sort();
  const p50 = quantile(completion, 0.5);
  const p85 = quantile(completion, 0.85);

  let expectedDay: number | null = null;
  if (Number.isFinite(p50)) {
    let sum = 0;
    let count = 0;
    for (const day of completion) {
      if (!Number.isFinite(day)) break; // sorted: the rest are infinite too
      sum += day;
      count += 1;
    }
    expectedDay = Math.max(1, Math.round(sum / count));
  }

  const cumulativeP50: number[] = [];
  const cumulativeP85: number[] = [];
  for (let day = 0; day < sprintDays; day += 1) {
    const slice = cumulative.subarray(day * runs, (day + 1) * runs).sort();
    cumulativeP50.push(quantile(slice, 0.5));
    cumulativeP85.push(reachedBy(slice, 0.85));
  }

  return {
    runs,
    probability: completedInSprint / runs,
    p50Day: Number.isFinite(p50) ? p50 : null,
    p85Day: Number.isFinite(p85) ? p85 : null,
    expectedDay,
    cumulativeP50,
    cumulativeP85,
  };
}
