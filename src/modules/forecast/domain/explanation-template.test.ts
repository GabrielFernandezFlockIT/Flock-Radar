import { describe, expect, it } from "vitest";

import {
  ExplanationSchema,
  checkGrounding,
  collectGroundingInputs,
  type AlertExplanationInput,
} from "@/shared/domain";

import { templateExplanation } from "./explanation-template";

const INPUT: AlertExplanationInput = {
  kind: "budget_overrun",
  severity: "critical",
  confidence: 0.82,
  eta: "2026-10-22",
  title: "Budget exhausted before the end date",
  drivers: [
    { key: "burn", label: "Daily burn", value: 1200, unit: "EUR" },
    { key: "left", label: "Budget left", value: 9600.456, unit: "EUR" },
  ],
  evidence: [
    {
      sourceType: "jira_worklog",
      externalId: "WL-1",
      url: "https://jira.example.com/browse/BCN-1",
      occurredAt: "2026-09-30T10:00:00.000Z",
    },
  ],
  project: {
    name: "Cobalt",
    clientName: "Northwind",
    startDate: "2026-06-01",
    endDate: "2026-11-05",
    budgetAmount: 120000,
    budgetCurrency: "EUR",
  },
};

describe("templateExplanation", () => {
  it("produces a valid Explanation", () => {
    expect(ExplanationSchema.safeParse(templateExplanation(INPUT)).success).toBe(true);
  });

  it("is grounded by construction — it passes the same check the LLM must pass", () => {
    const explanation = templateExplanation(INPUT);
    const text = [
      explanation.headline,
      explanation.why,
      ...explanation.suggestedActions.flatMap((action) => [action.title, action.rationale]),
    ].join("\n");

    expect(checkGrounding(text, collectGroundingInputs(INPUT)).grounded).toBe(true);
  });

  it("names the project, the ETA, and every driver", () => {
    const explanation = templateExplanation(INPUT);
    expect(explanation.headline).toContain("Cobalt");
    expect(explanation.headline).toContain("2026-10-22");
    expect(explanation.why).toContain("Daily burn: 1200 EUR");
    expect(explanation.why).toContain("WL-1");
  });

  it("is deterministic", () => {
    expect(templateExplanation(INPUT)).toEqual(templateExplanation(INPUT));
  });

  it("omits the date sentence when the alert has no ETA", () => {
    const explanation = templateExplanation({ ...INPUT, eta: null });
    expect(explanation.headline).not.toContain("projected date");
  });

  it("works for every alert kind, with or without drivers", () => {
    const kinds = [
      "sprint_goal_risk",
      "budget_overrun",
      "scope_creep",
      "wip_over_limit",
      "stale_review",
      "stalled_issue",
      "reopen_rate",
    ] as const;

    for (const kind of kinds) {
      const explanation = templateExplanation({ ...INPUT, kind, drivers: [] });
      expect(ExplanationSchema.safeParse(explanation).success).toBe(true);
      expect(explanation.suggestedActions.length).toBeGreaterThanOrEqual(2);
    }
  });
});
