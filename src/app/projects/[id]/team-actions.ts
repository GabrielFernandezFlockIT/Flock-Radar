"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getContainer } from "@/composition-root";
import type { TeamFormState } from "@/modules/cockpit/project/ui/team-form-state";
import {
  NonEmptyStringSchema,
  TeamRoleSchema,
  toIsoDate,
  type Person,
  type Status,
  type Team,
  type TeamMember,
} from "@/shared/domain";
import { RepositoryConstraintError } from "@/shared/ports";

/**
 * Server actions for team, people, and daily-status management.
 *
 * Every action validates its input with Zod (mirroring the domain schemas),
 * builds the full domain record, and lets the repository enforce the same
 * constraints Postgres would. A `RepositoryConstraintError` is translated into
 * a friendly Spanish message per constraint, so an internal name or stack
 * never reaches the client. Both the project page and the active tab are
 * revalidated so the streamed subtree repaints after `router.refresh()`.
 */

const error = (message: string): TeamFormState => ({ status: "error", message });
const ok = (): TeamFormState => ({ status: "ok", message: null });

/** Empty, whitespace, or missing form field becomes `null`. */
function optionalText(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

function nowIso(now: Date): string {
  return now.toISOString();
}

/** Human message for the constraints these actions can trip. */
function constraintMessage(constraint: string): string {
  switch (constraint) {
    case "teams_project_name_key":
      return "Ya existe un equipo con ese nombre en este proyecto.";
    case "people_email_key":
      return "Ese email ya pertenece a otra persona.";
    case "team_members_team_person_start_key":
    case "team_members_pkey":
      return "Esa persona ya integra el equipo.";
    case "statuses_person_day_key":
      return "Esa persona ya cargó un status para ese día.";
    default:
      return "No se pudo guardar por una restricción de datos. Revise los datos e intente nuevamente.";
  }
}

function toFormState(caught: unknown, fallback: string): TeamFormState {
  if (caught instanceof RepositoryConstraintError) {
    return error(constraintMessage(caught.constraint));
  }
  return error(fallback);
}

// --- Teams -----------------------------------------------------------------

const CreateTeamSchema = z.object({
  projectId: z.uuid(),
  name: NonEmptyStringSchema,
  description: NonEmptyStringSchema.nullable(),
});

export async function createTeamAction(
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = CreateTeamSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    description: optionalText(formData.get("description")),
  });
  if (!parsed.success) {
    return error("El nombre del equipo es obligatorio.");
  }

  try {
    const { repo, clock } = await getContainer();
    const timestamp = nowIso(clock.now());
    const team: Team = {
      id: globalThis.crypto.randomUUID(),
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await repo.teams.upsert(team);

    revalidatePath(`/projects/${parsed.data.projectId}`);
    revalidatePath("/");
    return ok();
  } catch (caught) {
    return toFormState(caught, "No se pudo crear el equipo. Intente nuevamente.");
  }
}

const SetTeamActiveSchema = z.object({
  projectId: z.uuid(),
  teamId: z.uuid(),
  active: z.enum(["true", "false"]),
});

export async function setTeamActiveAction(
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = SetTeamActiveSchema.safeParse({
    projectId: formData.get("projectId"),
    teamId: formData.get("teamId"),
    active: formData.get("active"),
  });
  if (!parsed.success) {
    return error("No se entendió la solicitud.");
  }

  try {
    const { repo } = await getContainer();
    const updated = await repo.teams.setActive(
      parsed.data.teamId,
      parsed.data.active === "true",
    );
    if (updated === null) {
      return error("Este equipo ya no existe.");
    }

    revalidatePath(`/projects/${parsed.data.projectId}`);
    revalidatePath("/");
    return ok();
  } catch (caught) {
    return toFormState(caught, "No se pudo actualizar el equipo. Intente nuevamente.");
  }
}

// --- Memberships -----------------------------------------------------------

const AddMemberSchema = z
  .object({
    projectId: z.uuid(),
    teamId: z.uuid(),
    role: TeamRoleSchema,
    // Either an existing person...
    personId: z.uuid().nullable(),
    // ...or a new one to create inline.
    newFullName: NonEmptyStringSchema.nullable(),
    newEmail: z.email().nullable(),
  })
  .refine((value) => value.personId !== null || value.newFullName !== null, {
    message: "Elija una persona existente o cargue una nueva.",
  });

export async function addTeamMemberAction(
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const emailRaw = optionalText(formData.get("newEmail"));
  const parsed = AddMemberSchema.safeParse({
    projectId: formData.get("projectId"),
    teamId: formData.get("teamId"),
    role: formData.get("role"),
    personId: optionalText(formData.get("personId")),
    newFullName: optionalText(formData.get("newFullName")),
    newEmail: emailRaw,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? "Revise los datos del formulario.";
    return error(issue);
  }

  try {
    const { repo, clock } = await getContainer();
    const timestamp = nowIso(clock.now());

    // Resolve the person: an existing selection, or a new directory entry.
    let personId = parsed.data.personId;
    if (personId === null) {
      const person: Person = {
        id: globalThis.crypto.randomUUID(),
        fullName: parsed.data.newFullName as string,
        email: parsed.data.newEmail,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await repo.people.upsertMany([person]);
      personId = person.id;
    }

    // Reject a second active membership of the same person in the same team.
    const existing = await repo.teamMembers.byTeam(parsed.data.teamId);
    if (existing.some((member) => member.personId === personId && member.endedOn === null)) {
      return error("Esa persona ya integra el equipo.");
    }

    const member: TeamMember = {
      id: globalThis.crypto.randomUUID(),
      teamId: parsed.data.teamId,
      personId,
      role: parsed.data.role,
      startedOn: toIsoDate(clock.now()),
      endedOn: null,
    };
    await repo.teamMembers.upsertMany([member]);

    revalidatePath(`/projects/${parsed.data.projectId}`);
    return ok();
  } catch (caught) {
    return toFormState(caught, "No se pudo agregar la persona. Intente nuevamente.");
  }
}

const RemoveMemberSchema = z.object({
  projectId: z.uuid(),
  memberId: z.uuid(),
});

export async function removeTeamMemberAction(
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = RemoveMemberSchema.safeParse({
    projectId: formData.get("projectId"),
    memberId: formData.get("memberId"),
  });
  if (!parsed.success) {
    return error("No se entendió la solicitud.");
  }

  try {
    const { repo } = await getContainer();
    const removed = await repo.teamMembers.remove(parsed.data.memberId);
    if (!removed) {
      return error("Esta membresía ya no existe.");
    }

    revalidatePath(`/projects/${parsed.data.projectId}`);
    return ok();
  } catch (caught) {
    return toFormState(caught, "No se pudo quitar a la persona. Intente nuevamente.");
  }
}

// --- Statuses --------------------------------------------------------------

const CreateStatusSchema = z.object({
  projectId: z.uuid(),
  teamId: z.uuid(),
  personId: z.uuid(),
  authorPersonId: z.uuid(),
  reportedOn: z.iso.date(),
  summary: NonEmptyStringSchema,
  blockers: NonEmptyStringSchema.nullable(),
  nextSteps: NonEmptyStringSchema.nullable(),
});

export async function createStatusAction(
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const authorRaw = optionalText(formData.get("authorPersonId"));
  const personId = optionalText(formData.get("personId"));
  const parsed = CreateStatusSchema.safeParse({
    projectId: formData.get("projectId"),
    teamId: formData.get("teamId"),
    personId,
    // "Cargado por" defaults to the subject person.
    authorPersonId: authorRaw ?? personId,
    reportedOn: formData.get("reportedOn"),
    summary: formData.get("summary"),
    blockers: optionalText(formData.get("blockers")),
    nextSteps: optionalText(formData.get("nextSteps")),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "summary") return error("Los avances son obligatorios.");
    if (field === "reportedOn") return error("La fecha no es válida.");
    return error("Revise los datos del formulario.");
  }

  try {
    const { repo, clock } = await getContainer();
    const timestamp = nowIso(clock.now());

    // Upserting the same (person, day) REPLACES the entry, but the id is never
    // overwritten, so reuse the stored id and createdAt when one exists.
    const sameDay = await repo.statuses.byPerson(parsed.data.personId, {
      start: parsed.data.reportedOn,
      end: parsed.data.reportedOn,
    });
    const previous = sameDay[0];

    const status: Status = {
      id: previous?.id ?? globalThis.crypto.randomUUID(),
      projectId: parsed.data.projectId,
      teamId: parsed.data.teamId,
      personId: parsed.data.personId,
      reportedOn: parsed.data.reportedOn,
      summary: parsed.data.summary,
      blockers: parsed.data.blockers,
      nextSteps: parsed.data.nextSteps,
      authorPersonId: parsed.data.authorPersonId,
      source: "manual",
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await repo.statuses.upsert(status);

    revalidatePath(`/projects/${parsed.data.projectId}`);
    return ok();
  } catch (caught) {
    return toFormState(caught, "No se pudo cargar el status. Intente nuevamente.");
  }
}
