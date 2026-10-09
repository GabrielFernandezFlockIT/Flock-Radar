import type {
  AlertExplanationInput,
  AlertKind,
  Driver,
  Explanation,
  SuggestedAction,
} from "@/shared/domain";

/**
 * Deterministic fallback explanation.
 *
 * Used whenever the LLM path is unavailable (no API key, an API error, a
 * refusal) or produced ungrounded prose twice. It is built only from the
 * detector's own drivers, so it can never contain a number the engine did not
 * compute — the same guarantee the grounding check enforces on generated text.
 *
 * Pure: no clock, no IO, no randomness. Same input, same sentences.
 */

const KIND_SUBJECT: Readonly<Record<AlertKind, string>> = {
  sprint_goal_risk: "el objetivo del sprint está en riesgo",
  budget_overrun: "el presupuesto se encamina a agotarse",
  scope_creep: "se agregó alcance después del inicio del sprint",
  wip_over_limit: "hay demasiado trabajo en curso al mismo tiempo",
  stale_review: "las pull requests esperan demasiado por una revisión",
  stalled_issue: "el trabajo en curso dejó de avanzar",
  reopen_rate: "se está reabriendo demasiado trabajo ya terminado",
};

const KIND_ACTIONS: Readonly<Record<AlertKind, readonly SuggestedAction[]>> = {
  sprint_goal_risk: [
    {
      title: "Replantear el alcance del sprint con el equipo",
      rationale: "Quitar o posponer los ítems de menor valor para que el objetivo comprometido siga siendo alcanzable.",
    },
    {
      title: "Confirmar la capacidad restante",
      rationale: "Revisar las licencias planificadas y las interrupciones antes de comprometer el alcance actual.",
    },
  ],
  budget_overrun: [
    {
      title: "Revisar el consumo con el cliente antes de la fecha de fin",
      rationale: "Una conversación sobre presupuesto cuesta menos ahora que una vez consumido.",
    },
    {
      title: "Replanificar el alcance restante según el dinero disponible",
      rationale: "Decidir qué sigue entrando en lugar de descubrir la brecha en la entrega.",
    },
  ],
  scope_creep: [
    {
      title: "Mover el trabajo agregado al próximo sprint",
      rationale: "Proteger el compromiso que el equipo asumió en la planificación del sprint.",
    },
    {
      title: "Acordar una regla de cambio de alcance con quien lo solicita",
      rationale: "Todo lo que se agregue a mitad de sprint debe desplazar otra cosa.",
    },
  ],
  wip_over_limit: [
    {
      title: "Terminar antes de empezar",
      rationale: "No tomar trabajo nuevo hasta que el trabajo en curso vuelva a estar por debajo del límite.",
    },
    {
      title: "Trabajar de a pares en el ítem en curso más antiguo",
      rationale: "Despejar primero el ítem más antiguo acorta el tiempo de ciclo de todo lo que viene detrás.",
    },
  ],
  stale_review: [
    {
      title: "Asignar una persona revisora a cada pull request en espera",
      rationale: "Una revisión sin asignar no tiene responsable y sigue esperando.",
    },
    {
      title: "Agregar un espacio diario de revisión",
      rationale: "Un espacio fijo mantiene acotado el tiempo de revisión en lugar de dejarlo librado al mejor esfuerzo.",
    },
  ],
  stalled_issue: [
    {
      title: "Preguntar a la persona asignada qué está bloqueando el ítem",
      rationale: "El trabajo en curso sin commits suele esconder un bloqueo no declarado.",
    },
    {
      title: "Sacar de en curso el trabajo bloqueado",
      rationale: "Mantenerlo en curso oculta el estado real del sprint.",
    },
  ],
  reopen_rate: [
    {
      title: "Revisar la definición de terminado",
      rationale: "Las reaperturas repetidas suelen indicar que el trabajo se da por terminado demasiado pronto.",
    },
    {
      title: "Agregar un paso de verificación antes de cerrar",
      rationale: "Detectar la brecha antes de cerrar cuesta menos que reabrir.",
    },
  ],
};

/** `13 pts` / `48 horas` / `4`, using the driver's own unit. */
function formatDriver(driver: Driver): string {
  const value = Number.isInteger(driver.value)
    ? String(driver.value)
    : String(Number(driver.value.toFixed(2)));
  const unit = driver.unit ? ` ${driver.unit}` : "";
  return `${driver.label}: ${value}${unit}`;
}

/**
 * Builds the two-sentence headline, the why, and 2 actions from the drivers.
 * Every number it prints comes from `input`, so the result is grounded by
 * construction.
 */
export function templateExplanation(input: AlertExplanationInput): Explanation {
  const subject = KIND_SUBJECT[input.kind];
  const when = input.eta === null ? "" : ` La fecha proyectada es ${input.eta}.`;
  const headline = `${input.project.name}: ${subject}.${when}`.trim();

  const drivers = input.drivers.map(formatDriver);
  // Evidence is cited by external id, never counted: a count would be a
  // number that is not in the inputs, which is exactly what this template
  // exists to avoid.
  const cited = input.evidence.map((evidence) => evidence.externalId).join(", ");
  const why =
    drivers.length > 0
      ? `Detectado a partir de ${drivers.join("; ")}. Respaldado por ${cited}.`
      : `Detectado por la verificación ${input.title}. Respaldado por ${cited}.`;

  return {
    headline,
    why,
    suggestedActions: [...KIND_ACTIONS[input.kind]],
  };
}
