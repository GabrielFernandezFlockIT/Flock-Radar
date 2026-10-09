import { describe, expect, it } from "vitest";

import type {
  Person,
  Project,
  Status,
  Team,
  TeamMember,
} from "@/shared/domain";
import { RepositoryConstraintError } from "@/shared/ports";

import { InMemoryRadarRepository } from "./in-memory-radar-repository";

/** Asserts the STABLE constraint name, never the message text. */
async function violates(
  promise: Promise<unknown>,
  constraint: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: "RepositoryConstraintError",
    constraint,
  });
}

/**
 * The teams/people/statuses half of the repository contract. The adapter must
 * reject exactly what Postgres rejects (D-032), so every case here has a
 * matching constraint in `supabase/migrations/0001_core.sql`.
 */

const PROJECT_ID = "0b6f3f2e-1c1d-5e4a-8b7c-111111111111";
const OTHER_PROJECT_ID = "0b6f3f2e-1c1d-5e4a-8b7c-222222222222";
const TEAM_ID = "0b6f3f2e-1c1d-5e4a-8b7c-000000000001";
const OTHER_TEAM_ID = "0b6f3f2e-1c1d-5e4a-8b7c-000000000002";
const ANA = "0b6f3f2e-1c1d-5e4a-8b7c-00000000000a";
const BRUNO = "0b6f3f2e-1c1d-5e4a-8b7c-00000000000b";
const UNKNOWN = "0b6f3f2e-1c1d-5e4a-8b7c-ffffffffffff";

const INSTANT = "2026-01-05T09:00:00.000Z";

const project: Project = {
  id: PROJECT_ID,
  name: "Beacon",
  jiraKey: "BCN",
  githubRepo: "demo-org/beacon-api",
  clientName: "Globex",
  budgetAmount: 100_000,
  budgetCurrency: "USD",
  hourlyRate: 50,
  startDate: "2026-07-01",
  endDate: "2026-12-31",
  forecastUnit: "points",
  wipLimit: 5,
};

const otherProject: Project = {
  ...project,
  id: OTHER_PROJECT_ID,
  name: "Atlas",
  jiraKey: "ATL",
};

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: TEAM_ID,
    projectId: PROJECT_ID,
    name: "Beacon",
    description: null,
    active: true,
    createdAt: INSTANT,
    updatedAt: INSTANT,
    ...overrides,
  };
}

function person(id: string, fullName: string, email: string | null): Person {
  return {
    id,
    fullName,
    email,
    active: true,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  };
}

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000001a",
    teamId: TEAM_ID,
    personId: ANA,
    role: "lead",
    startedOn: "2026-01-05",
    endedOn: null,
    ...overrides,
  };
}

function status(overrides: Partial<Status> = {}): Status {
  return {
    id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000002a",
    projectId: PROJECT_ID,
    teamId: TEAM_ID,
    personId: ANA,
    reportedOn: "2026-10-08",
    summary: "Avancé con el endpoint de cotizaciones.",
    blockers: null,
    nextSteps: null,
    authorPersonId: ANA,
    source: "manual",
    createdAt: "2026-10-08T17:30:00.000Z",
    updatedAt: "2026-10-08T17:30:00.000Z",
    ...overrides,
  };
}

async function seeded() {
  const repo = new InMemoryRadarRepository();
  await repo.projects.upsert(project);
  await repo.projects.upsert(otherProject);
  await repo.people.upsertMany([
    person(ANA, "Ana Ruiz", "ana@demo-org.test"),
    person(BRUNO, "Bruno Castro", null),
  ]);
  await repo.teams.upsert(team());
  await repo.teams.upsert(
    team({ id: OTHER_TEAM_ID, projectId: OTHER_PROJECT_ID, name: "Atlas" }),
  );
  return repo;
}

describe("teams", () => {
  it("lists a project's teams by name and can filter by active", async () => {
    const repo = await seeded();
    await repo.teams.upsert(
      team({
        id: "0b6f3f2e-1c1d-5e4a-8b7c-000000000003",
        name: "Alpha",
        active: false,
      }),
    );

    expect(
      (await repo.teams.byProject(PROJECT_ID)).map((item) => item.name),
    ).toEqual(["Alpha", "Beacon"]);
    expect(
      (await repo.teams.byProject(PROJECT_ID, { active: true })).map(
        (item) => item.name,
      ),
    ).toEqual(["Beacon"]);
  });

  it("rejects an unknown project and a duplicate name in one project", async () => {
    const repo = await seeded();
    await expect(
      repo.teams.upsert(team({ id: UNKNOWN, projectId: UNKNOWN })),
    ).rejects.toBeInstanceOf(RepositoryConstraintError);
    await violates(
      repo.teams.upsert(team({ id: UNKNOWN, name: "Beacon" })),
      "teams_project_name_key",
    );
    // The same name in ANOTHER project is fine.
    await expect(
      repo.teams.upsert(team({ id: UNKNOWN, projectId: OTHER_PROJECT_ID })),
    ).resolves.toMatchObject({ name: "Beacon" });
  });

  it("soft-deletes and restores through setActive", async () => {
    const repo = await seeded();
    expect(await repo.teams.setActive(UNKNOWN, false)).toBeNull();
    expect(await repo.teams.setActive(TEAM_ID, false)).toMatchObject({
      active: false,
    });
    expect(await repo.teams.setActive(TEAM_ID, true)).toMatchObject({
      active: true,
    });
  });
});

describe("people", () => {
  it("orders by full name and searches case- and accent-insensitively", async () => {
    const repo = await seeded();
    await repo.people.upsertMany([person(UNKNOWN, "Nicolás Vega", null)]);

    expect((await repo.people.list()).map((item) => item.fullName)).toEqual([
      "Ana Ruiz",
      "Bruno Castro",
      "Nicolás Vega",
    ]);
    expect(
      (await repo.people.search("nicolas")).map((item) => item.fullName),
    ).toEqual(["Nicolás Vega"]);
    expect(await repo.people.search("   ")).toEqual([]);
  });

  it("keeps emails unique but allows many people without one", async () => {
    const repo = await seeded();
    await violates(
      repo.people.upsertMany([person(UNKNOWN, "Clon", "ana@demo-org.test")]),
      "people_email_key",
    );
    await expect(
      repo.people.upsertMany([person(UNKNOWN, "Sin mail", null)]),
    ).resolves.toBeUndefined();
  });
});

describe("team members", () => {
  it("rejects an unknown team or person, and a duplicate natural key in a batch", async () => {
    const repo = await seeded();
    await violates(
      repo.teamMembers.upsertMany([member({ teamId: UNKNOWN })]),
      "team_members_team_id_fkey",
    );
    await violates(
      repo.teamMembers.upsertMany([member({ personId: UNKNOWN })]),
      "team_members_person_id_fkey",
    );
    await violates(
      repo.teamMembers.upsertMany([
        member(),
        member({ id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000001b" }),
      ]),
      "team_members_natural_key",
    );
  });

  it("lets the same person hold different roles in different teams", async () => {
    const repo = await seeded();
    await repo.teamMembers.upsertMany([
      member(),
      member({
        id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000001c",
        teamId: OTHER_TEAM_ID,
        role: "developer",
      }),
    ]);
    expect(
      (await repo.teamMembers.byPerson(ANA)).map((item) => item.role),
    ).toEqual(["lead", "developer"]);
  });

  it("removes a membership by id", async () => {
    const repo = await seeded();
    await repo.teamMembers.upsertMany([member()]);
    expect(await repo.teamMembers.remove(UNKNOWN)).toBe(false);
    expect(await repo.teamMembers.remove(member().id)).toBe(true);
    expect(await repo.teamMembers.byTeam(TEAM_ID)).toEqual([]);
  });
});

describe("statuses", () => {
  it("replaces the entry when the same person reports the same day again", async () => {
    const repo = await seeded();
    await repo.statuses.upsert(status());
    const replaced = await repo.statuses.upsert(
      status({ summary: "Segunda carga", authorPersonId: BRUNO }),
    );

    expect(replaced.summary).toBe("Segunda carga");
    expect(await repo.statuses.byPerson(ANA)).toHaveLength(1);
  });

  it("rejects a team that belongs to another project (composite foreign key)", async () => {
    const repo = await seeded();
    await violates(
      repo.statuses.upsert(status({ teamId: OTHER_TEAM_ID })),
      "statuses_project_team_fkey",
    );
  });

  it("rejects an unknown person, an unknown author, and a reused id", async () => {
    const repo = await seeded();
    await violates(
      repo.statuses.upsert(status({ personId: UNKNOWN })),
      "statuses_person_id_fkey",
    );
    await violates(
      repo.statuses.upsert(status({ authorPersonId: UNKNOWN })),
      "statuses_author_person_id_fkey",
    );

    await repo.statuses.upsert(status());
    // Same id, different day: ids are never moved to another natural key.
    await violates(
      repo.statuses.upsert(status({ reportedOn: "2026-10-09" })),
      "statuses_pkey",
    );
  });

  it("reads by team, person, and project, ordered by day and limited by range", async () => {
    const repo = await seeded();
    await repo.statuses.upsertMany([
      status({ reportedOn: "2026-10-07" }),
      status({
        id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000002b",
        reportedOn: "2026-10-08",
        personId: BRUNO,
        authorPersonId: BRUNO,
      }),
      status({
        id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000002c",
        reportedOn: "2026-10-09",
      }),
    ]);

    expect(
      (await repo.statuses.byTeam(TEAM_ID)).map((item) => item.reportedOn),
    ).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(
      (
        await repo.statuses.byProject(PROJECT_ID, {
          start: "2026-10-08",
          end: "2026-10-08",
        })
      ).map((item) => item.personId),
    ).toEqual([BRUNO]);
    expect(await repo.statuses.byPerson(BRUNO)).toHaveLength(1);
  });

  it("deletes by id", async () => {
    const repo = await seeded();
    await repo.statuses.upsert(status());
    expect(await repo.statuses.delete(UNKNOWN)).toBe(false);
    expect(await repo.statuses.delete(status().id)).toBe(true);
    expect(await repo.statuses.byProject(PROJECT_ID)).toEqual([]);
  });
});

describe("alerts with a subject", () => {
  const draft = (
    overrides: Partial<
      Parameters<InMemoryRadarRepository["alerts"]["upsertForKind"]>[2]
    > = {},
  ) => ({
    teamId: null,
    personId: null,
    severity: "medium" as const,
    confidence: 0.7,
    eta: null,
    title: "Trabajo detenido",
    explanation: null,
    explanationSource: null,
    drivers: [],
    evidence: [
      {
        sourceType: "status" as const,
        externalId: "Ana Ruiz 2026-10-08",
        url: `/projects/${PROJECT_ID}/statuses/${status().id}`,
        occurredAt: "2026-10-08T17:30:00.000Z",
      },
    ],
    suggestedActions: [],
    detectedAt: "2026-10-09T07:00:00.000Z",
    ...overrides,
  });

  it("keeps one active alert per subject, not per kind", async () => {
    const repo = await seeded();
    const forAna = await repo.alerts.upsertForKind(
      PROJECT_ID,
      "stalled_issue",
      {
        ...draft({ teamId: TEAM_ID, personId: ANA }),
      },
    );
    const forBruno = await repo.alerts.upsertForKind(
      PROJECT_ID,
      "stalled_issue",
      {
        ...draft({ teamId: TEAM_ID, personId: BRUNO }),
      },
    );
    expect(forAna.id).not.toBe(forBruno.id);

    // Re-detecting Ana's problem updates HER alert in place.
    const again = await repo.alerts.upsertForKind(PROJECT_ID, "stalled_issue", {
      ...draft({ teamId: TEAM_ID, personId: ANA, severity: "high" }),
    });
    expect(again.id).toBe(forAna.id);
    expect(again.severity).toBe("high");
    expect(await repo.alerts.byProject(PROJECT_ID)).toHaveLength(2);
  });

  it("rejects a subject that does not belong to the project", async () => {
    const repo = await seeded();
    await violates(
      repo.alerts.upsertForKind(PROJECT_ID, "stalled_issue", {
        ...draft({ teamId: OTHER_TEAM_ID }),
      }),
      "alerts_project_team_fkey",
    );
    await violates(
      repo.alerts.upsertForKind(PROJECT_ID, "stalled_issue", {
        ...draft({ personId: UNKNOWN }),
      }),
      "alerts_person_id_fkey",
    );
  });
});
