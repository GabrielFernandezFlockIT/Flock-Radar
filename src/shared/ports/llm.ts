import type { z } from "zod";

import type { AlertExplanationInput, Explanation } from "@/shared/domain";

/**
 * LLM port.
 *
 * The SDK lives in `src/adapters/llm/**` only (enforced by ESLint). Domain and
 * application code depend on this interface, which is why it speaks in domain
 * types and plain events rather than in SDK shapes.
 *
 * Two capabilities, one port, because both are the same dependency (one
 * client, one key, one model) and both must degrade the same way when no key
 * is configured: `available === false`, and every call returns a
 * non-exceptional "unavailable" outcome instead of throwing.
 */

/** Everything an alert explanation may be built from. Also the grounding allow-list. */
export type ExplanationRequest = AlertExplanationInput;

/** Two-sentence headline, the why, and 2–3 concrete actions. */
export type ExplanationResult = Explanation;

/**
 * Usage of one API call, for `repo.llmCalls.insert`. The port reports calls
 * instead of writing them, so adapters stay free of the repository and every
 * caller logs the same way.
 */
export interface LlmCallRecord {
  /** `alert_explanation`, `chat`, ... */
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  stopReason: string | null;
  costUsd: number;
}

export type ExplanationFailureReason =
  | "unavailable"
  | "ungrounded"
  | "refused"
  | "error";

export type ExplanationOutcome =
  | {
      status: "ok";
      explanation: ExplanationResult;
      /** Generation attempts spent, including the corrective retry. */
      attempts: number;
      calls: LlmCallRecord[];
    }
  | {
      status: "failed";
      reason: ExplanationFailureReason;
      /** Short, non-sensitive description for logs and the summary. */
      detail: string;
      attempts: number;
      calls: LlmCallRecord[];
    };

/**
 * A read-only tool the chat may call. `run` receives the already-validated
 * input and returns the tool result text; build these with `defineChatTool`
 * so validation and the schema never drift apart.
 */
export interface ChatTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run(input: unknown): Promise<string>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Conversation so far, oldest first; the last entry is the new question. */
  messages: readonly ChatMessage[];
  /**
   * Operator-authored scope description (which projects are in view). Trusted
   * text assembled by the application layer — never ingested content.
   */
  scope: string;
  /** Read-only tools. The adapter must not add write capabilities. */
  tools: readonly ChatTool[];
  signal?: AbortSignal;
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string }
  | { type: "error"; message: string }
  | { type: "done"; stopReason: string | null; calls: LlmCallRecord[] };

export interface LlmPort {
  /** False when no API key is configured; every call then degrades gracefully. */
  readonly available: boolean;
  readonly model: string;
  explainAlert(request: ExplanationRequest): Promise<ExplanationOutcome>;
  chat(request: ChatRequest): AsyncIterable<ChatEvent>;
}
