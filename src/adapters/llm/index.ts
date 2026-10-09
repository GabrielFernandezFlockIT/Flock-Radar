import type { LlmPort } from "@/shared/ports";

import { createAnthropicLlm } from "./anthropic-llm";
import { createUnavailableLlm } from "./unavailable-llm";

export { LLM_UNAVAILABLE_MESSAGE } from "./unavailable-llm";

/**
 * Picks the LLM adapter for the running configuration. Without an API key the
 * app keeps working on deterministic paths; see `unavailable-llm.ts`.
 */
export function createLlm(options: {
  apiKey: string | undefined;
  model: string;
}): LlmPort {
  return options.apiKey
    ? createAnthropicLlm({ apiKey: options.apiKey, model: options.model })
    : createUnavailableLlm(options.model);
}
