import { describe, expect, it } from "vitest";

import { alertSubjectKey } from "./alert";
import { StatusSchema, hasBlockers, isReportedOnBehalf } from "./status";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";

const status = {
  id: "55555555-5555-4555-8555-555555555555",
  projectId: PROJECT_ID,
  teamId: TEAM_ID,
  personId: PERSON_ID,
  reportedOn: "2026-10-08",
  summary: "Avancé con el endpoint de cotizaciones del carrier.",
  blockers: null,
  nextSteps: null,
  authorPersonId: PERSON_ID,
  source: "manual" as const,
  createdAt: "2026-10-08T17:30:00.000Z",
  updatedAt: "2026-10-08T17:30:00.000Z",
};

describe("StatusSchema", () => {
  it("accepts an entry with only the required summary", () => {
    expect(StatusSchema.parse(status)).toEqual(status);
  });

  it("rejects an empty summary: avances are always required", () => {
    expect(StatusSchema.safeParse({ ...status, summary: "   " }).success).toBe(false);
  });

  it("rejects an empty blocker instead of storing a blank one", () => {
    expect(StatusSchema.safeParse({ ...status, blockers: "" }).success).toBe(false);
  });

  it("rejects an instant where a calendar day belongs", () => {
    expect(
      StatusSchema.safeParse({ ...status, reportedOn: "2026-10-08T00:00:00Z" }).success,
    ).toBe(false);
  });
});

describe("status helpers", () => {
  it("detects an entry loaded by someone else", () => {
    expect(isReportedOnBehalf(status)).toBe(false);
    expect(isReportedOnBehalf({ ...status, authorPersonId: LEAD_ID })).toBe(true);
  });

  it("detects a blocking day", () => {
    expect(hasBlockers(status)).toBe(false);
    expect(hasBlockers({ blockers: "Faltan las credenciales." })).toBe(true);
  });
});

describe("alertSubjectKey", () => {
  it("keeps alerts about different people apart", () => {
    const a = { teamId: TEAM_ID, personId: PERSON_ID };
    const b = { teamId: TEAM_ID, personId: LEAD_ID };
    expect(alertSubjectKey(a)).not.toBe(alertSubjectKey(b));
  });

  it("uses a sentinel for a project-wide alert, never an empty segment", () => {
    expect(alertSubjectKey({ teamId: null, personId: null })).toBe("-:-");
  });
});
