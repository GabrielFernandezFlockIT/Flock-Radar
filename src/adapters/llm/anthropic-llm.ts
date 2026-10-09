import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat, betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { checkGrounding, collectGroundingInputs } from "@/shared/domain";
import type {
  ChatEvent,
  ChatRequest,
  ChatTool,
  ExplanationOutcome,
  ExplanationRequest,
  LlmCallRecord,
  LlmPort,
} from "@/shared/ports";

import { estimateCostUsd } from "./pricing";
import { CHAT_SYSTEM_PROMPT, EXPLANATION_SYSTEM_PROMPT } from "./prompts";

/**
 * Anthropic adapter — the ONLY module allowed to import `@anthropic-ai/sdk`
 * (ESLint `radar/*` layering rules).
 *
 * Call shape, per PROMPT §2:
 * - model from config (`claude-opus-5-5`), `output_config.effort` always set
 *   explicitly: `low` for the extraction-shaped explanation, `high` for chat;
 * - structured output through Zod (`betaZodOutputFormat` + `.parse`) for the
 *   explanation, which is machine-consumed;
 * - `tool_choice` is left at its default `auto` (forced tool use is a 400 on
 *   this model); chat tools are `strict: true` instead;
 * - server-side refusal fallbacks (`fallbacks: "default"` + the
 *   `server-side-fallback-2026-07-01` beta), and `stop_reason` is checked
 *   before any content is read;
 * - the system prompt (and, for chat, the tool definitions rendered before it)
 *   carry a cache breakpoint, so every turn after the first reads the prefix
 *   from cache.
 *
 * Nothing here throws at the caller: every failure becomes a `failed` outcome
 * or an `error` event, so the use case can fall back deterministically.
 */

const EXPLANATION_MAX_TOKENS = 2_000;
const CHAT_MAX_TOKENS = 8_000;
const CHAT_MAX_ITERATIONS = 10;
const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The structured-output schema. Mirrors the domain `Explanation` but stays
 * here: this is the wire contract we ask the model for, and it is validated
 * against the domain schema by the caller.
 */
const ExplanationOutputSchema = z.object({
  headline: z
    .string()
    .describe("Exactly two sentences of plain language. No numbers that are not in the input."),
  why: z
    .string()
    .describe("One short paragraph explaining the alert strictly from the drivers given."),
  suggestedActions: z
    .array(
      z.object({
        title: z.string().describe("Short imperative action title."),
        rationale: z.string().describe("One sentence on why this action helps."),
      }),
    )
    .min(2)
    .max(3),
});

type ExplanationOutput = z.infer<typeof ExplanationOutputSchema>;

interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function toCallRecord(
  purpose: string,
  model: string,
  usage: Usage | null | undefined,
  latencyMs: number,
  stopReason: string | null,
): LlmCallRecord {
  const tokens = {
    inputTokens: Math.max(0, usage?.input_tokens ?? 0),
    outputTokens: Math.max(0, usage?.output_tokens ?? 0),
    cacheReadTokens: Math.max(0, usage?.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Math.max(0, usage?.cache_creation_input_tokens ?? 0),
  };
  return {
    purpose,
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    stopReason,
    costUsd: estimateCostUsd(model, tokens),
  };
}

/** Short, non-sensitive failure description. Never echoes an upstream body. */
function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `anthropic: HTTP ${error.status ?? "error"}`;
  if (error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)) return error.name;
  return "unknown error";
}

/** The generated prose the grounding check runs over. */
function explanationText(output: ExplanationOutput): string {
  return [
    output.headline,
    output.why,
    ...output.suggestedActions.flatMap((action) => [action.title, action.rationale]),
  ].join("\n");
}

function explanationUserMessage(request: ExplanationRequest): string {
  return [
    "Explain this alert.",
    "",
    "<alert_input>",
    JSON.stringify(request, null, 2),
    "</alert_input>",
  ].join("\n");
}

function correctiveMessage(ungrounded: readonly string[]): string {
  return [
    "Your previous answer contained values that are not in the input:",
    ungrounded.map((token) => `- ${token}`).join("\n"),
    "",
    "Rewrite the explanation. Use ONLY numbers, dates, and record identifiers that appear in <alert_input>. If you cannot support a statement with a value from the input, write it without any number.",
  ].join("\n");
}

function toRunnableTool(tool: ChatTool) {
  return {
    ...betaZodTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      run: (input: unknown) => tool.run(input),
    }),
    // Forced tool choice is a 400 on this model; `strict` is how we keep the
    // arguments schema-valid instead.
    strict: true,
  };
}

export interface AnthropicLlmOptions {
  apiKey: string;
  model: string;
}

export function createAnthropicLlm(options: AnthropicLlmOptions): LlmPort {
  const client = new Anthropic({ apiKey: options.apiKey });
  const model = options.model;

  async function generate(
    messages: Anthropic.Beta.BetaMessageParam[],
  ): Promise<{
    output: ExplanationOutput | null;
    call: LlmCallRecord;
    stopReason: string | null;
  }> {
    const startedAt = Date.now();
    const message = await client.beta.messages.parse({
      model,
      max_tokens: EXPLANATION_MAX_TOKENS,
      betas: [REFUSAL_FALLBACK_BETA],
      fallbacks: "default",
      output_config: {
        // Extraction-shaped work: the numbers are already computed.
        effort: "low",
        format: betaZodOutputFormat(ExplanationOutputSchema),
      },
      system: [
        {
          type: "text",
          text: EXPLANATION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const stopReason = message.stop_reason ?? null;
    const call = toCallRecord(
      "alert_explanation",
      message.model ?? model,
      message.usage,
      Date.now() - startedAt,
      stopReason,
    );
    // Always check stop_reason before reading content.
    const usable = stopReason === "end_turn" || stopReason === "stop_sequence";
    return { output: usable ? (message.parsed_output ?? null) : null, call, stopReason };
  }

  async function explainAlert(request: ExplanationRequest): Promise<ExplanationOutcome> {
    const calls: LlmCallRecord[] = [];
    const grounding = collectGroundingInputs(request);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      { role: "user", content: explanationUserMessage(request) },
    ];

    let lastUngrounded: string[] = [];

    // One generation, then at most one corrective regeneration (§5.1).
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let result;
      try {
        result = await generate(messages);
      } catch (error) {
        return {
          status: "failed",
          reason: "error",
          detail: describeError(error),
          attempts: attempt,
          calls,
        };
      }
      calls.push(result.call);

      if (result.output === null) {
        const refused = result.stopReason === "refusal";
        return {
          status: "failed",
          reason: refused ? "refused" : "error",
          detail: `stop_reason: ${result.stopReason ?? "unknown"}`,
          attempts: attempt,
          calls,
        };
      }

      const check = checkGrounding(explanationText(result.output), grounding);
      if (check.grounded) {
        return {
          status: "ok",
          explanation: {
            headline: result.output.headline,
            why: result.output.why,
            suggestedActions: result.output.suggestedActions,
          },
          attempts: attempt,
          calls,
        };
      }

      lastUngrounded = check.ungrounded;
      messages.push(
        { role: "assistant", content: JSON.stringify(result.output) },
        { role: "user", content: correctiveMessage(check.ungrounded) },
      );
    }

    return {
      status: "failed",
      reason: "ungrounded",
      detail: `ungrounded values: ${lastUngrounded.slice(0, 5).join(", ")}`,
      attempts: 2,
      calls,
    };
  }

  async function* chat(request: ChatRequest): AsyncIterable<ChatEvent> {
    const startedAt = Date.now();
    const calls: LlmCallRecord[] = [];
    let stopReason: string | null = null;

    const runner = client.beta.messages.toolRunner(
      {
        model,
        max_tokens: CHAT_MAX_TOKENS,
        betas: [REFUSAL_FALLBACK_BETA],
        fallbacks: "default",
        // Narrative, multi-step, tool-using work.
        output_config: { effort: "high" },
        system: [
          { type: "text", text: CHAT_SYSTEM_PROMPT },
          {
            type: "text",
            text: request.scope,
            // Tools render before `system`, so this breakpoint caches the tool
            // definitions and the whole prompt; the question comes after it.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        tools: request.tools.map(toRunnableTool),
        max_iterations: CHAT_MAX_ITERATIONS,
        stream: true,
      },
      request.signal ? { signal: request.signal } : undefined,
    );

    try {
      for await (const stream of runner) {
        for await (const event of stream) {
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "tool_use"
          ) {
            yield { type: "tool_use", name: event.content_block.name };
          }
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          }
        }

        const message = await stream.finalMessage();
        stopReason = message.stop_reason ?? null;
        calls.push(
          toCallRecord("chat", message.model ?? model, message.usage, Date.now() - startedAt, stopReason),
        );

        if (stopReason === "refusal") {
          yield {
            type: "error",
            message: "The model declined to answer that question.",
          };
          break;
        }
        if (stopReason === "pause_turn") {
          // The runner does not auto-resume a paused server-tool turn.
          runner.pushMessages({ role: "assistant", content: message.content });
          continue;
        }
        if (
          stopReason === "max_tokens" &&
          message.content.some((block) => block.type === "tool_use")
        ) {
          yield { type: "error", message: "The answer was cut short. Try a narrower question." };
          break;
        }
      }
    } catch (error) {
      yield { type: "error", message: describeError(error) };
    }

    yield { type: "done", stopReason, calls };
  }

  return { available: true, model, explainAlert, chat };
}
