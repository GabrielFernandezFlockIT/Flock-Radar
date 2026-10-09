import { z } from "zod";

import { getContainer } from "@/composition-root";
import {
  MAX_CHAT_MESSAGES,
  MAX_CHAT_MESSAGE_LENGTH,
  askRadar,
} from "@/modules/chat/application/ask-radar";
import type { ChatEvent } from "@/shared/ports";

/**
 * Ask Flock-Radar streaming endpoint (PROMPT §5.3).
 *
 * Server-sent events, one JSON `ChatEvent` per message, so the client can
 * render text as it arrives and show which tool is running. Without an API
 * key the chat port yields a single `error` event explaining why the chat is
 * disabled — the route still answers 200 and the UI degrades instead of
 * breaking.
 */

const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_CHAT_MESSAGE_LENGTH),
      }),
    )
    .min(1)
    .max(MAX_CHAT_MESSAGES),
  projectId: z.uuid().nullable().default(null),
});

function encodeEvent(event: ChatEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const { repo, llm, clock } = await getContainer();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of askRadar(
          { repo, llm, clock },
          { messages: parsed.data.messages, projectId: parsed.data.projectId },
          request.signal,
        )) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            encodeEvent({
              type: "error",
              message: "Preguntar a Flock-Radar no pudo responder.",
            }),
          ),
        );
        controller.enqueue(
          encoder.encode(encodeEvent({ type: "done", stopReason: null, calls: [] })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
