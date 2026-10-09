import type {
  ChatEvent,
  ChatMessage,
  Clock,
  LlmCallRecord,
  LlmPort,
  RadarRepository,
} from "@/shared/ports";

import { buildRadarTools } from "./chat-tools";

/**
 * Ask Flock-Radar use case (PROMPT §5.3).
 *
 * Owns the parts that must not live in an adapter: which projects are in
 * scope, which read-only tools exist, and the LLM-call log. The adapter owns
 * the SDK; this owns the policy.
 */

export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_LENGTH = 4_000;

export interface AskRadarDeps {
  repo: RadarRepository;
  llm: LlmPort;
  clock: Clock;
}

export interface AskRadarRequest {
  messages: readonly ChatMessage[];
  /** `null` asks across the whole portfolio. */
  projectId: string | null;
}

/**
 * Operator-authored scope note. Only project names, keys, and today's date —
 * never ingested text, which always travels inside a tool result's
 * `<untrusted_data>` block instead.
 */
async function buildScope(
  repo: RadarRepository,
  projectId: string | null,
  now: Date,
): Promise<string> {
  const projects = await repo.projects.list();
  const scoped =
    projectId === null ? projects : projects.filter((project) => project.id === projectId);

  const list = scoped
    .map((project) => `- ${project.name} (${project.jiraKey}), client ${project.clientName}`)
    .join("\n");

  return [
    `Today is ${now.toISOString().slice(0, 10)} (UTC).`,
    projectId === null
      ? "The question may concern any of these projects:"
      : "The question concerns only this project:",
    list.length > 0 ? list : "- (no projects are configured)",
  ].join("\n");
}

export async function* askRadar(
  deps: AskRadarDeps,
  request: AskRadarRequest,
  signal?: AbortSignal,
): AsyncIterable<ChatEvent> {
  const { repo, llm, clock } = deps;
  const now = clock.now();

  const messages = request.messages
    .slice(-MAX_CHAT_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_CHAT_MESSAGE_LENGTH),
    }));

  const scope = await buildScope(repo, request.projectId, now);
  const tools = buildRadarTools(repo, { projectId: request.projectId }, now);

  const calls: LlmCallRecord[] = [];
  for await (const event of llm.chat({ messages, scope, tools, signal })) {
    if (event.type === "done") calls.push(...event.calls);
    yield event;
  }

  // Logged after the stream so a disconnect never leaves a half-written row.
  const at = clock.now().toISOString();
  for (const call of calls) {
    try {
      await repo.llmCalls.insert({ ...call, createdAt: at });
    } catch {
      // Usage logging must never break an answer the user already received.
    }
  }
}
