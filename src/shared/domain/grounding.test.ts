import { describe, expect, it } from "vitest";

import type { AlertExplanationInput } from "./alert";
import {
  checkGrounding,
  collectGroundingInputs,
  dateRenderings,
  extractNumbers,
  type GroundingInputs,
} from "./grounding";

/**
 * The grounding check is the only thing standing between a confident model
 * and an invented number on a leadership cockpit, so it is tested hard:
 * formatting variants must pass, and anything the inputs do not back must
 * fail — including numbers that look harmless.
 */

const INPUTS: GroundingInputs = {
  numbers: [0.38, 13, 1200, -5, 2.47],
  identifiers: ["BCN-123", "#42", "a1b2c3d"],
  dates: ["2026-10-22", "2026-11-05"],
  corpus: "Scope added after sprint start P85 burn-up Beacon",
};

function check(text: string) {
  return checkGrounding(text, INPUTS);
}

describe("extractNumbers", () => {
  it("normalizes thousands separators and keeps decimals", () => {
    expect(extractNumbers("1,200 and 2.47 and 38")).toEqual([1200, 2.47, 38]);
  });

  it("does not read a sentence comma as a thousands separator", () => {
    expect(extractNumbers("We closed 38, then 13.")).toEqual([38, 13]);
  });
});

describe("dateRenderings", () => {
  it("covers the common renderings of a day", () => {
    const renderings = dateRenderings("2026-10-22");
    expect(renderings).toContain("2026-10-22");
    expect(renderings).toContain("Oct 22");
    expect(renderings).toContain("October 22, 2026");
    expect(renderings).toContain("22/10/2026");
  });

  it("returns nothing for a non-ISO day", () => {
    expect(dateRenderings("22 October 2026")).toEqual([]);
  });
});

describe("checkGrounding — grounded formatting variants", () => {
  it("accepts a percentage written from a unit-interval input", () => {
    expect(check("The sprint sits at 38%.").grounded).toBe(true);
  });

  it("accepts the unit-interval form of the same value", () => {
    expect(check("Confidence is 0.38.").grounded).toBe(true);
  });

  it("accepts a rounded percentage", () => {
    const rounded = checkGrounding("Roughly 38% likely.", {
      ...INPUTS,
      numbers: [0.3842],
    });
    expect(rounded.grounded).toBe(true);
  });

  it("accepts a thousands separator", () => {
    expect(check("The team burned 1,200 of the budget.").grounded).toBe(true);
  });

  it("accepts the unseparated form of the same number", () => {
    expect(check("The team burned 1200.").grounded).toBe(true);
  });

  it("accepts an unsigned reading of a signed driver", () => {
    expect(check("5 points were removed.").grounded).toBe(true);
  });

  it("accepts rounding at the precision written", () => {
    expect(check("About 2.5 days of slack.").grounded).toBe(true);
  });

  it("accepts every rendering of an allowed date", () => {
    for (const rendering of [
      "2026-10-22",
      "Oct 22",
      "October 22, 2026",
      "22 Oct",
      "22/10/2026",
    ]) {
      expect(check(`The budget runs out on ${rendering}.`).grounded).toBe(true);
    }
  });

  it("reads an ordinal as its number", () => {
    // `13` is a driver value, so the ordinal form of it is grounded...
    expect(check("The 13th item was added late.").grounded).toBe(true);
    // ...while a day-of-month written on its own is not: it is only allowed
    // as part of a full date rendering, never as a bare number.
    expect(check("The budget runs out on the 22nd.").ungrounded).toEqual(["22"]);
  });

  it("accepts identifiers it was given, in either PR form", () => {
    expect(check("See BCN-123, #42 and commit a1b2c3d.").grounded).toBe(true);
  });

  it("ignores digits inside a URL", () => {
    expect(
      check("Details at https://jira.example.com/browse/BCN-123?page=7.").grounded,
    ).toBe(true);
  });

  it("accepts a word with digits that the inputs use", () => {
    expect(check("The P85 date is 2026-10-22.").grounded).toBe(true);
  });
});

describe("checkGrounding — ungrounded claims", () => {
  it("rejects an invented percentage", () => {
    const result = check("The sprint sits at 72%.");
    expect(result.grounded).toBe(false);
    expect(result.ungrounded).toEqual(["72%"]);
  });

  it("rejects an invented plain number", () => {
    expect(check("The team closed 9 issues.").ungrounded).toEqual(["9"]);
  });

  it("rejects a near-miss that rounding does not cover", () => {
    expect(check("Confidence is 0.41.").grounded).toBe(false);
  });

  it("rejects an invented date", () => {
    const result = check("The budget runs out on Dec 3, 2026.");
    expect(result.grounded).toBe(false);
  });

  it("rejects a year that no allowed date contains", () => {
    expect(checkGrounding("Delivery slips to 2027.", INPUTS).grounded).toBe(false);
  });

  it("rejects an issue key it was never given", () => {
    const result = check("Blocked by BCN-999.");
    expect(result.grounded).toBe(false);
    expect(result.ungrounded).toEqual(["BCN-999"]);
  });

  it("rejects a PR number it was never given", () => {
    expect(check("Merged in #77.").ungrounded).toEqual(["#77"]);
  });

  it("rejects a commit SHA it was never given", () => {
    expect(check("Shipped in f00ba12.").ungrounded).toEqual(["f00ba12"]);
  });

  it("rejects a word with digits the inputs never use", () => {
    expect(check("This is a Q4 problem.").ungrounded).toEqual(["Q4"]);
  });

  it("does not let a long digit run pass as a commit SHA", () => {
    expect(check("Ticket 1234567 is blocked.").ungrounded).toEqual(["1234567"]);
  });

  it("reports several ungrounded tokens in order, without duplicates", () => {
    const result = check("9 issues, 9 again, and 72% done by Dec 3, 2026.");
    expect(result.grounded).toBe(false);
    expect(result.ungrounded.slice(0, 2)).toEqual(["9", "72%"]);
  });

  it("does not let a date fragment ground an unrelated number", () => {
    // 22 is only allowed as part of 2026-10-22, never on its own.
    expect(check("We have 22 issues left.").grounded).toBe(false);
  });
});

describe("collectGroundingInputs", () => {
  const input: AlertExplanationInput = {
    kind: "budget_overrun",
    severity: "critical",
    confidence: 0.82,
    eta: "2026-10-22",
    title: "Budget exhausted before the end date",
    drivers: [
      { key: "burn", label: "Daily burn", value: 1200, unit: "EUR" },
      { key: "left", label: "Budget left", value: 9600, unit: "EUR" },
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

  it("grounds driver values, the confidence, the budget, and every date", () => {
    const inputs = collectGroundingInputs(input);
    const text =
      "Cobalt will spend its 120000 EUR budget by 2026-10-22, two weeks before 2026-11-05. Daily burn is 1,200 EUR with 9600 left, at 82% confidence.";
    expect(checkGrounding(text, inputs).grounded).toBe(true);
  });

  it("still rejects a number the detector never produced", () => {
    const inputs = collectGroundingInputs(input);
    expect(checkGrounding("That is 14 days of runway.", inputs).grounded).toBe(false);
  });

  it("grounds the evidence identifier it was given", () => {
    const inputs = collectGroundingInputs(input);
    expect(checkGrounding("Backed by WL-1.", inputs).grounded).toBe(true);
  });
});
