import { describe, expect, it } from "vitest";

import {
  PersonSchema,
  TEAM_ROLES,
  TeamMemberFieldsSchema,
  TeamMemberSchema,
  TeamSchema,
  isActiveMembership,
} from "./team";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ID = "44444444-4444-4444-8444-444444444444";

const team = {
  id: TEAM_ID,
  projectId: PROJECT_ID,
  name: "Beacon",
  description: null,
  active: true,
  createdAt: "2026-01-05T09:00:00.000Z",
  updatedAt: "2026-01-05T09:00:00.000Z",
};

const member = {
  id: MEMBER_ID,
  teamId: TEAM_ID,
  personId: PERSON_ID,
  role: "lead" as const,
  startedOn: "2026-01-05",
  endedOn: null,
};

describe("TeamSchema", () => {
  it("accepts a team with no description", () => {
    expect(TeamSchema.parse(team)).toEqual(team);
  });

  it("rejects a blank name", () => {
    expect(TeamSchema.safeParse({ ...team, name: "  " }).success).toBe(false);
  });
});

describe("PersonSchema", () => {
  const person = {
    id: PERSON_ID,
    fullName: "Nicolás Vega",
    email: "nicolas-vega@demo-org.test",
    active: true,
    createdAt: "2026-01-05T09:00:00.000Z",
    updatedAt: "2026-01-05T09:00:00.000Z",
  };

  it("accepts a person with or without an email", () => {
    expect(PersonSchema.parse(person)).toEqual(person);
    expect(PersonSchema.parse({ ...person, email: null }).email).toBeNull();
  });

  it("rejects a malformed email", () => {
    expect(PersonSchema.safeParse({ ...person, email: "nope" }).success).toBe(false);
  });

  it("has no role: the role lives on the membership", () => {
    expect(Object.keys(PersonSchema.shape)).not.toContain("role");
  });
});

describe("TeamMemberSchema", () => {
  it("accepts every stable role identifier", () => {
    for (const role of TEAM_ROLES) {
      expect(TeamMemberSchema.parse({ ...member, role }).role).toBe(role);
    }
  });

  it("rejects a membership that ends before it starts", () => {
    expect(
      TeamMemberSchema.safeParse({ ...member, endedOn: "2026-01-04" }).success,
    ).toBe(false);
  });

  it("derives from the plain Fields variant (Zod 4 refinement rule, D-035)", () => {
    const draft = TeamMemberFieldsSchema.omit({ id: true });
    expect(draft.parse({ ...member, id: undefined })).not.toHaveProperty("id");
  });
});

describe("isActiveMembership", () => {
  it("is true from the start day and stays true while it has not ended", () => {
    expect(isActiveMembership(member, "2026-01-04")).toBe(false);
    expect(isActiveMembership(member, "2026-01-05")).toBe(true);
    expect(isActiveMembership(member, "2030-01-01")).toBe(true);
  });

  it("is inclusive of the end day", () => {
    const ended = { ...member, endedOn: "2026-03-10" };
    expect(isActiveMembership(ended, "2026-03-10")).toBe(true);
    expect(isActiveMembership(ended, "2026-03-11")).toBe(false);
  });
});
