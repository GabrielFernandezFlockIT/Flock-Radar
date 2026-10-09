import type { Person, Team, TeamMember, TeamRole } from "@/shared/domain";
import type { RadarRepository } from "@/shared/ports";

/**
 * Read model for the "Equipo" tab: every team of a project with its members
 * resolved to the person behind each membership, plus the organization-wide
 * directory the "add person" form picks from.
 *
 * Members are ordered lead-first, then by a stable role order, then by name,
 * so the person running the team always reads at the top of the card.
 */

export interface TeamMemberView {
  membershipId: string;
  personId: string;
  fullName: string;
  email: string | null;
  role: TeamRole;
  startedOn: string;
  endedOn: string | null;
}

export interface TeamView {
  team: Team;
  members: TeamMemberView[];
}

export interface TeamOverview {
  teams: TeamView[];
  /** Active organization directory, for the "add existing person" picker. */
  people: Person[];
}

/** Lead first; the rest in a stable order so cards read consistently. */
const ROLE_ORDER: Readonly<Record<TeamRole, number>> = {
  lead: 0,
  functional_analyst: 1,
  business_translator: 2,
  developer: 3,
  ux_ui_designer: 4,
};

function sortMembers(a: TeamMemberView, b: TeamMemberView): number {
  const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  if (byRole !== 0) return byRole;
  return a.fullName.localeCompare(b.fullName, "es");
}

function toMemberView(member: TeamMember, person: Person | undefined): TeamMemberView {
  return {
    membershipId: member.id,
    personId: member.personId,
    fullName: person?.fullName ?? "Persona desconocida",
    email: person?.email ?? null,
    role: member.role,
    startedOn: member.startedOn,
    endedOn: member.endedOn,
  };
}

export async function getTeamOverview(
  repo: RadarRepository,
  projectId: string,
): Promise<TeamOverview> {
  const [teams, people] = await Promise.all([
    repo.teams.byProject(projectId),
    repo.people.list({ active: true }),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));

  const teamViews = await Promise.all(
    teams.map(async (team): Promise<TeamView> => {
      const members = await repo.teamMembers.byTeam(team.id);
      return {
        team,
        members: members
          .map((member) => toMemberView(member, peopleById.get(member.personId)))
          .sort(sortMembers),
      };
    }),
  );

  return { teams: teamViews, people };
}
