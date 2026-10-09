/** USD per million tokens, per model. */
interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Published list prices. Unknown models fall back to the default row so a
 * model override never makes cost logging throw — an approximate cost is more
 * useful on the admin page than no cost at all.
 */
const PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

const DEFAULT_PRICE = PRICES["claude-opus-5-5"]!;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Cost estimate in USD, never negative, never NaN. */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model] ?? DEFAULT_PRICE;
  const cost =
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite) /
    1_000_000;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}
