import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubIsolatedEnv } from "@test/helpers/env";

import { isActiveAlert, type Explanation } from "@/shared/domain";
import type { ExplanationOutcome, LlmPort } from "@/shared/ports";

import { clearExplanationCache, explainAlerts } from "./explain-alerts";

/**
 * The AI layer must never be load-bearing for the demo (PROMPT §1, principle
 * 4). These tests boot the real container — demo dataset, real sync, real
 * forecast engine — with NO `ANTHROPIC_API_KEY`, and assert that every
 * triggered alert still ends up explained.
 */

const DEMO_ENV = { DEMO_MODE: "true" };

/** The explanation use case never chats; any call here is a bug in the test. */
async function* unusedChat(): AsyncIterable<never> {
  throw new Error("chat is not used by explainAlerts");
}

/** Stands in for the no-API-key adapter without importing it (layering guard). */
function unavailableLlm(): LlmPort {
  return {
    available: false,
    model: "claude-opus-5-5",
    explainAlert(): Promise<ExplanationOutcome> {
      return Promise.resolve({
        status: "failed",
        reason: "unavailable",
        detail: "ANTHROPIC_API_KEY is not configured",
        attempts: 0,
        calls: [],
      });
    },
    chat: unusedChat,
  };
}

async function loadCompositionRoot(env: Record<string, string>) {
  stubIsolatedEnv(env);
  vi.resetModules();
  clearExplanationCache();
  const compositionRoot = await import("@/composition-root");
  compositionRoot.resetContainer();
  return compositionRoot;
}

beforeEach(() => {
  vi.useRealTimers();
  clearExplanationCache();
});

afterEach(async () => {
  vi.useRealTimers();
  (await import("@/composition-root")).resetContainer();
  clearExplanationCache();
});

describe("demo boot without ANTHROPIC_API_KEY", () => {
  it("builds the container and explains every active alert from a template", async () => {
    const { getContainer, getAppConfig } = await loadCompositionRoot(DEMO_ENV);

    expect(getAppConfig().llmAvailable).toBe(false);

    const { repo, llm } = await getContainer();
    expect(llm.available).toBe(false);

    const projects = await repo.projects.list();
    expect(projects.length).toBeGreaterThan(0);

    const alerts = (
      await Promise.all(
        projects.flatMap((project) => [
          repo.alerts.byProject(project.id, "open"),
          repo.alerts.byProject(project.id, "ack"),
        ]),
      )
    ).flat();

    // The demo scenario is designed to trigger alerts; if it stopped doing so
    // this test would silently prove nothing.
    expect(alerts.length).toBeGreaterThan(0);

    for (const alert of alerts.filter(isActiveAlert)) {
      expect(alert.explanationSource).toBe("template");
      expect(alert.explanation).not.toBeNull();
      expect(alert.explanation?.length ?? 0).toBeGreaterThan(0);
      expect(alert.suggestedActions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("logs no LLM calls when there is no key", async () => {
    const { getContainer } = await loadCompositionRoot(DEMO_ENV);
    const { repo } = await getContainer();
    expect((await repo.llmCalls.totals()).calls).toBe(0);
  });
});

describe("explainAlerts", () => {
  async function demoContainer() {
    const { getContainer } = await loadCompositionRoot(DEMO_ENV);
    return getContainer();
  }

  it("does not call the model again when the inputs have not changed", async () => {
    const { repo, clock } = await demoContainer();

    const explanation: Explanation = {
      headline: "First sentence. Second sentence.",
      why: "Because the drivers say so.",
      suggestedActions: [
        { title: "Do the thing", rationale: "It helps." },
        { title: "Do the other thing", rationale: "It also helps." },
      ],
    };
    let calls = 0;
    const llm: LlmPort = {
      available: true,
      model: "test-model",
      explainAlert(): Promise<ExplanationOutcome> {
        calls += 1;
        return Promise.resolve({ status: "ok", explanation, attempts: 1, calls: [] });
      },
      chat: unusedChat,
    };

    const cache = new Map<string, { explanation: Explanation; source: "llm" }>();
    const first = await explainAlerts({ repo, clock, llm, cache });
    const callsAfterFirst = calls;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(first.projects.some((project) => project.llm > 0)).toBe(true);

    const second = await explainAlerts({ repo, clock, llm, cache });
    expect(calls).toBe(callsAfterFirst);
    expect(second.projects.every((project) => project.llm === 0)).toBe(true);
    expect(second.projects.some((project) => project.unchanged > 0)).toBe(true);
  });

  it("falls back to the template when the model path fails", async () => {
    const { repo, clock } = await demoContainer();
    const llm = unavailableLlm();

    const result = await explainAlerts({ repo, clock, llm, cache: new Map() });

    expect(result.llmAvailable).toBe(false);
    expect(result.projects.every((project) => project.error === null)).toBe(true);
    expect(result.projects.some((project) => project.template > 0)).toBe(true);
  });
});
