"use client";

import { useEffect, useRef, useState } from "react";
import { InfoIcon, SendIcon, WrenchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

import { CitedText } from "./citations";

/**
 * Ask Flock-Radar chat (PROMPT §5.3).
 *
 * Streams server-sent `ChatEvent`s from `POST /api/chat` and renders text as
 * it arrives. When no API key is configured the server still answers 200 with
 * a single `error` event; this component disables the composer up front and
 * shows why, so the page never looks broken.
 */

export interface ChatProjectOption {
  id: string;
  name: string;
  jiraKey: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "¿Vamos a cumplir el objetivo del sprint?",
  "¿Qué cerró el equipo esta semana?",
  "¿Qué está bloqueando a Beacon?",
  "Redacte el informe para el cliente del viernes",
] as const;

/** Tool name -> what the user sees while that tool runs. */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  get_portfolio: "el portafolio",
  get_project_status: "el estado del proyecto",
  get_forecast: "el pronóstico",
  search_issues: "las incidencias",
  search_memory: "la memoria del equipo",
  get_pr_activity: "la actividad de pull requests",
  get_alerts: "las alertas",
};

interface StreamEvent {
  type: string;
  text?: string;
  name?: string;
  message?: string;
}

function parseEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const chunks = buffer.split("\n\n");
  const rest = chunks.pop() ?? "";
  for (const chunk of chunks) {
    const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(6)) as StreamEvent);
    } catch {
      // A partial frame is impossible here (we split on the frame separator),
      // so anything unparseable is a server bug, not a truncation. Skip it.
    }
  }
  return { events, rest };
}

export function AskRadarChat({
  projects,
  llmAvailable,
  disabledReason,
}: {
  projects: readonly ChatProjectOption[];
  llmAvailable: boolean;
  disabledReason: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, streaming]);

  async function send(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed.length === 0 || streaming || !llmAvailable) return;

    const history: Turn[] = [...turns, { role: "user", content: trimmed }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          projectId: projectId === "" ? null : projectId,
        }),
      });

      if (!response.ok || response.body === null) {
        setError("No se pudo iniciar Preguntar a Flock-Radar. Intente nuevamente.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseEvents(buffer);
        buffer = parsed.rest;

        for (const event of parsed.events) {
          if (event.type === "text" && event.text !== undefined) {
            answer += event.text;
            setActiveTool(null);
            setTurns([...history, { role: "assistant", content: answer }]);
          } else if (event.type === "tool_use") {
            setActiveTool(event.name ?? "una herramienta");
          } else if (event.type === "error") {
            setError(event.message ?? "Preguntar a Flock-Radar no pudo responder.");
          }
        }
      }

      if (answer.length === 0) {
        // Nothing streamed: drop the empty assistant bubble, keep the error.
        setTurns(history);
      }
    } catch {
      setError("La conexión se cortó antes de que terminara la respuesta.");
    } finally {
      setActiveTool(null);
      setStreaming(false);
    }
  }

  return (
    <div className="space-y-4">
      {!llmAvailable ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex gap-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">El chat está deshabilitado</p>
              <p className="text-muted-foreground">{disabledReason}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="ask-radar-project" className="text-xs text-muted-foreground">
          Alcance
        </label>
        <select
          id="ask-radar-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={streaming}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <option value="">Todos los proyectos</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} ({project.jiraKey})
            </option>
          ))}
        </select>
      </div>

      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="outline"
              size="sm"
              disabled={!llmAvailable || streaming}
              onClick={() => void send(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        {turns.map((turn, index) => (
          <Card
            key={`${turn.role}-${index}`}
            className={turn.role === "user" ? "bg-muted/40" : undefined}
          >
            <CardContent className="space-y-2">
              <Badge variant="outline" className="text-[0.65rem]">
                {turn.role === "user" ? "Usted" : "Flock-Radar"}
              </Badge>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {turn.content.length > 0 ? (
                  <CitedText text={turn.content} />
                ) : (
                  <span className="text-muted-foreground italic">Pensando…</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {activeTool !== null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <WrenchIcon className="size-3" aria-hidden="true" />
            Leyendo {TOOL_LABELS[activeTool] ?? activeTool.replaceAll("_", " ")}…
          </p>
        ) : null}
        {error !== null ? (
          <p className="text-sm text-destructive" role="status">
            {error}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          disabled={!llmAvailable || streaming}
          rows={2}
          placeholder={
            llmAvailable
              ? "Pregunte sobre un sprint, un presupuesto, un bloqueo o el trabajo de esta semana…"
              : "Configure ANTHROPIC_API_KEY para habilitar el chat"
          }
          aria-label="Su pregunta"
        />
        <Button type="submit" disabled={!llmAvailable || streaming || draft.trim().length === 0}>
          <SendIcon className="size-4" aria-hidden="true" />
          Enviar
        </Button>
      </form>
    </div>
  );
}
