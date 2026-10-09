import type { ProjectSpec } from "./spec";

/**
 * Spanish copy for the demo's daily statuses.
 *
 * Status text is USER-AUTHORED product content and the cockpit is in Spanish,
 * so it is written in Spanish on purpose — unlike every identifier, comment,
 * and document in this repository.
 *
 * The copy is not decoration: it is what the future LLM pass analyses, so the
 * scenario's signals have to be IN the text. `expectations.ts` records what
 * each project's statuses encode, so a later detector can be calibrated
 * against it:
 * - Beacon: repeated blockers on BCN-306 and BCN-307, the scope added mid
 *   sprint, and the upcoming PTO.
 * - Cobalt: effort and overtime, consistent with the accelerating burn.
 * - Atlas: healthy, no blockers at all.
 *
 * `summaries` and `nextSteps` rotate over the window (oldest day first) and
 * an empty `nextSteps` entry becomes `null`. `blocker` and `note` apply to the
 * LAST N working days, so they always end on today.
 */

export interface PersonStatusScript {
  /** Index into `ProjectSpec.people`. */
  person: number;
  /** "Avances", rotated by day. At least one. */
  summaries: readonly string[];
  /** "Próximos pasos", rotated by day. An empty string becomes `null`. */
  nextSteps: readonly string[];
  /** "Bloqueos", repeated on the last `days` working days. */
  blocker?: { text: string; days: number };
  /** Appended to the summary on the last `days` working days. */
  note?: { text: string; days: number };
}

/** Markers a later detector can calibrate on; each note below contains one. */
export const STATUS_SIGNAL_MARKERS = {
  pto: "licencia",
  scope: "alcance",
  overtime: "horas extra",
} as const;

const ATLAS_SCRIPTS: readonly PersonStatusScript[] = [
  {
    person: 0,
    summaries: [
      "Cerré la exportación de facturas a CSV con el desglose de impuestos por línea que pidió finanzas de Northwind.",
      "Revisé los PR del equipo y acompañé la salida de checkout como invitado a staging.",
      "Roté el secreto del webhook del proveedor de pagos y verifiqué que las confirmaciones sigan llegando.",
      "Armé la planificación del próximo sprint con el PO y repasamos las prioridades de la tienda.",
      "Hice seguimiento del tablero: no hay nada trabado y el objetivo del sprint sigue en pie.",
    ],
    nextSteps: [
      "Revisar el PR de la línea de tiempo de seguimiento de pedidos.",
      "Preparar la demo para Northwind del viernes.",
      "",
      "Repasar el checklist de release con el equipo.",
    ],
  },
  {
    person: 1,
    summaries: [
      "Terminé el checkout como invitado con el mail de confirmación y quedó aprobado por marketing de Northwind.",
      "Avancé con los carritos guardados para clientes registrados: ya persiste y se recupera en la sesión.",
      "Ajusté el formulario de checkout después del feedback de accesibilidad.",
      "Sumé tests al flujo de carritos guardados y dejé el esquema listo para revisión.",
      "Empecé a mirar el autocompletado de direcciones para arrancarlo apenas se libere.",
    ],
    nextSteps: [
      "Definir con Lucía la expiración de los carritos guardados.",
      "Abrir el PR de carritos guardados.",
      "Arrancar el autocompletado de direcciones.",
      "",
    ],
  },
  {
    person: 2,
    summaries: [
      "Dejé el campo de código promocional con validación en línea y mensajes claros de error.",
      "Avancé con la línea de tiempo de seguimiento del pedido; el PR ya está en revisión.",
      "Corregí el formato de precios para los casos de descuento por porcentaje.",
      "Sumé los estados intermedios de envío a la línea de tiempo con datos reales de staging.",
      "Atendí comentarios de revisión y actualicé los snapshots visuales.",
    ],
    nextSteps: [
      "Esperar la revisión de la línea de tiempo y mergear.",
      "Documentar los estados del seguimiento de pedidos.",
      "",
      "Tomar la próxima historia del sprint.",
    ],
  },
  {
    person: 3,
    summaries: [
      "Resolví el redondeo del total del carrito con descuentos porcentuales y sumé tests de regresión.",
      "Arreglé el botón de checkout que quedaba deshabilitado al editar la dirección.",
      "Corregí la expiración de sesión durante la redirección de pago.",
      "Revisé los logs de errores de checkout y no aparecieron casos nuevos.",
      "Pasé a apoyar la división del bundle de checkout con mediciones de carga.",
    ],
    nextSteps: [
      "Validar los tres bugs en staging con QA.",
      "Sumar alertas para el redireccionamiento de pago.",
      "Tomar el próximo bug del tablero.",
      "",
    ],
  },
  {
    person: 4,
    summaries: [
      "Armé con el equipo los escenarios de prueba de punta a punta del checkout como invitado.",
      "Revisé la accesibilidad del modal de guía de talles y pasé las observaciones a desarrollo.",
      "Entregué el diseño de la línea de tiempo de seguimiento de pedidos con los estados vacíos incluidos.",
      "Ajusté el sistema de componentes del checkout para reducir variantes duplicadas.",
      "Acompañé la división del bundle de checkout verificando que no cambie la experiencia visual.",
    ],
    nextSteps: [
      "Revisar el contraste de los banners promocionales.",
      "Entregar los estados de carga del autocompletado de direcciones.",
      "",
      "Preparar los materiales de la demo para Northwind.",
    ],
  },
];

const BEACON_SCRIPTS: readonly PersonStatusScript[] = [
  {
    person: 0,
    summaries: [
      "Cerré el bug del rate limiter que contaba los OPTIONS y lo validé contra el sandbox.",
      "Terminé los campos de declaración aduanera para pedidos internacionales (BCN-313) y quedó en Done.",
      "Acompañé al equipo con las revisiones y ordené el tablero del sprint.",
      "Revisé el estado del objetivo del sprint con el PO y repasamos qué entra y qué no.",
      "Hice seguimiento de los pendientes del sprint y de las dependencias con Globex.",
    ],
    nextSteps: [
      "Replanificar lo que no entra en el sprint.",
      "Escalar a Globex las credenciales del sandbox del carrier.",
      "Revisar con el PO el impacto del alcance agregado.",
      "",
    ],
    note: {
      text: "El alcance creció a mitad de sprint: entraron BCN-313 y BCN-314 después del arranque, 8 puntos por encima de lo comprometido.",
      days: 4,
    },
  },
  {
    person: 1,
    summaries: [
      "Dejé los reintentos de webhooks con backoff exponencial funcionando y cubiertos con tests.",
      "Avancé con la cancelación parcial de pedidos; la reestimación de 2 a 5 puntos refleja el trabajo real.",
      "Separé la cancelación parcial en dos etapas para poder entregar la primera esta semana.",
      "Sumé los casos de reembolso parcial y los validé contra el sandbox del carrier.",
      "Documenté el comportamiento de la cancelación parcial para los integradores.",
    ],
    nextSteps: [
      "Terminar la segunda etapa de la cancelación parcial.",
      "Dejar documentado el traspaso antes de ausentarme.",
      "",
      "Revisar con Tomás qué queda para el próximo sprint.",
    ],
    note: {
      text: "Aviso que la semana que viene me tomo dos días de licencia; dejo todo documentado y traspasado.",
      days: 2,
    },
  },
  {
    person: 2,
    summaries: [
      "Sumé los índices de base de datos para la búsqueda de envíos y bajó la latencia p95.",
      "Intenté avanzar con el endpoint de cotizaciones del carrier (BCN-306) pero no pude ejecutar nada contra el sandbox.",
      "Dejé escrita la integración de cotizaciones del carrier, sin poder probarla de punta a punta.",
      "Corregí el PDF de etiqueta que se cortaba con direcciones largas y abrí el PR.",
      "Volví a revisar BCN-306 por si podía simular el carrier, pero los contratos no coinciden con la documentación.",
    ],
    nextSteps: [
      "Retomar BCN-306 apenas lleguen las credenciales.",
      "Dejar documentado el traspaso antes de ausentarme.",
      "Insistir con Globex por el acceso al sandbox.",
      "",
    ],
    blocker: {
      text: "Sigo bloqueado en BCN-306: esperamos las credenciales del sandbox del carrier que Globex todavía no nos consiguió.",
      days: 6,
    },
    note: {
      text: "Además la semana que viene me tomo dos días de licencia, así que dejo el contexto escrito.",
      days: 2,
    },
  },
  {
    person: 3,
    summaries: [
      "Terminé las claves de idempotencia para POST /orders y quedó mergeado.",
      "Dejé listo el endpoint de creación masiva de envíos (BCN-307) y abrí el PR.",
      "Avancé con la documentación de códigos de error de webhooks en la referencia de la API.",
      "Sumé los tests de contrato del endpoint masivo mientras espero la revisión.",
      "Revisé los PR de los demás y completé la documentación de errores.",
    ],
    nextSteps: [
      "Conseguir revisión del PR de BCN-307.",
      "Publicar la referencia de errores actualizada.",
      "",
      "Tomar la próxima historia del sprint.",
    ],
    blocker: {
      text: "El PR de BCN-307 sigue sin primera revisión desde hace más de dos días y no puedo mergear ni seguir con lo que depende de él.",
      days: 3,
    },
  },
  {
    person: 4,
    summaries: [
      "Cerré la paginación por cursor de /shipments y la validé con los integradores de Globex.",
      "Corrí la prueba de carga de /orders a 500 rps y documenté los resultados.",
      "Avancé con la exportación de métricas de uso para la facturación de Globex (BCN-314).",
      "Traduje a requisitos lo que pidió Globex en la reunión de seguimiento y lo bajé al equipo.",
      "Ajusté la exportación de métricas al formato que necesita el área de facturación de Globex.",
    ],
    nextSteps: [
      "Validar el formato de exportación con facturación de Globex.",
      "Cerrar la exportación antes del fin de mes.",
      "Revisar con Tomás la prioridad de lo agregado.",
      "",
    ],
    note: {
      text: "El alcance se movió a mitad de sprint: BCN-314 entró después del arranque y me corrió el resto de lo planificado.",
      days: 4,
    },
  },
];

const COBALT_SCRIPTS: readonly PersonStatusScript[] = [
  {
    person: 0,
    summaries: [
      "Cerré el reporte de conciliación contra el ERP de origen y cuadran los totales.",
      "Terminé el spike de formatos de tabla abierta y dejé la recomendación escrita.",
      "Coordiné el plan de cut-over de facturas e inventario con Initech.",
      "Revisé el avance del equipo y reordené las prioridades hacia la migración.",
      "Seguí el consumo del warehouse y lo crucé con el plan de cut-over.",
    ],
    nextSteps: [
      "Confirmar la ventana de cut-over con Initech.",
      "Revisar el consumo del warehouse de la semana.",
      "",
      "Preparar el repaso de avance con el cliente.",
    ],
    note: {
      text: "Seguimos sosteniendo el ritmo con horas extra para llegar al cut-over en fecha.",
      days: 5,
    },
  },
  {
    person: 1,
    summaries: [
      "Arreglé el scheduler que se salteaba corridas después del cambio de horario y lo apliqué directo sobre main.",
      "Avancé con el monitoreo de SLA de frescura por tabla y ya reporta las primeras métricas.",
      "Sumé las alertas de frescura para las tablas críticas de facturas.",
      "Dejé corriendo la carga nocturna y revisé los resultados a la mañana siguiente.",
      "Ajusté los umbrales de frescura con lo que vimos en producción.",
    ],
    nextSteps: [
      "Abrir el PR de seguimiento del fix del scheduler con tests.",
      "Terminar el monitoreo de frescura por tabla.",
      "Revisar la carga nocturna de mañana.",
      "",
    ],
    note: {
      text: "Otra jornada larga: sumé horas extra para dejar la carga nocturna corriendo.",
      days: 5,
    },
  },
  {
    person: 2,
    summaries: [
      "Dejé configuradas las alertas de DAGs fallidos y ya avisan por el canal del equipo.",
      "Avancé con el enmascarado de datos personales en las tablas de staging y abrí el PR.",
      "Atendí los comentarios de revisión del enmascarado de PII.",
      "Revisé el impacto del enmascarado sobre los tiempos de carga y lo ajusté.",
      "Completé la documentación del enmascarado para el equipo de datos.",
    ],
    nextSteps: [
      "Mergear el enmascarado de PII.",
      "Validar el enmascarado con el área de cumplimiento.",
      "",
      "Tomar la próxima historia de la migración.",
    ],
    note: {
      text: "Me quedé fuera de hora otra vez; vengo sumando horas extra para cerrar el enmascarado.",
      days: 5,
    },
  },
  {
    person: 3,
    summaries: [
      "Terminé el pipeline de fotos de inventario y quedó validado contra el origen.",
      "Avancé con la migración de los cron heredados al orquestador.",
      "Fui entendiendo el modelo de capas de datos y migré los primeros jobs.",
      "Revisé con Paula las convenciones del proyecto y rehíce dos transformaciones.",
      "Dejé migrados los jobs nocturnos y documenté lo que falta.",
    ],
    nextSteps: [
      "Terminar la migración de los cron heredados.",
      "Repasar con el equipo las convenciones de transformación.",
      "Revisar la documentación de capas de datos.",
      "",
    ],
    note: {
      text: "Sigo poniéndome al día con la plataforma y compensando con horas extra para no frenar al equipo.",
      days: 5,
    },
  },
  {
    person: 4,
    summaries: [
      "Limpié las tablas temporales huérfanas que quedaban después de las fallas.",
      "Relevé con finanzas de Initech qué necesita el mart de ingresos diario.",
      "Escribí los criterios de aceptación de la atribución de costos por pipeline.",
      "Repasé las reglas de negocio del mart de facturas con el área usuaria.",
      "Documenté los controles de calidad que tiene que pasar la migración.",
    ],
    nextSteps: [
      "Cerrar los criterios de aceptación de atribución de costos.",
      "Validar las reglas del mart de ingresos con finanzas.",
      "",
      "Revisar los controles de calidad con Paula.",
    ],
    note: {
      text: "Arranqué hace poco en el equipo y sumo horas extra para acortar la curva de aprendizaje.",
      days: 5,
    },
  },
];

const SCRIPTS_BY_SLUG: Readonly<
  Record<ProjectSpec["slug"], readonly PersonStatusScript[]>
> = {
  atlas: ATLAS_SCRIPTS,
  beacon: BEACON_SCRIPTS,
  cobalt: COBALT_SCRIPTS,
};

export function statusScriptsOf(
  slug: ProjectSpec["slug"],
): readonly PersonStatusScript[] {
  return SCRIPTS_BY_SLUG[slug];
}
