/**
 * Respuestas de error uniformes: `{ ok: false, error: "<texto en español>" }`.
 *
 * - `error` es SIEMPRE un string legible (todas las UIs lo muestran tal cual).
 *   La información estructurada de validación va aparte, en `details`.
 * - El texto interno de PostgreSQL nunca llega al cliente: se registra en el
 *   log del servidor y se responde un mensaje genérico según el SQLSTATE.
 */

const { z } = require("zod");

const GENERIC_INTERNAL_ERROR = "Error interno del servidor.";

const TYPE_NAMES = {
  string: "texto",
  number: "número",
  integer: "número entero",
  bigint: "número entero",
  boolean: "verdadero o falso",
  array: "lista",
  object: "objeto",
  date: "fecha",
  null: "nulo",
};

function invalidStringMessage(validation) {
  if (validation === "email") return "Correo electrónico inválido.";
  if (validation === "uuid") return "Identificador inválido (UUID).";
  if (validation === "url") return "URL inválida.";
  if (validation === "datetime" || validation === "date" || validation === "time") return "Fecha u hora inválida.";
  return "Formato inválido.";
}

function tooSmallMessage(issue) {
  const n = issue.minimum;
  if (issue.type === "string") {
    if (issue.exact) return `Debe tener exactamente ${n} caracteres.`;
    return Number(n) === 1 ? "No puede estar vacío." : `Debe tener al menos ${n} caracteres.`;
  }
  if (issue.type === "array" || issue.type === "set") {
    return issue.exact ? `Debe tener exactamente ${n} elemento(s).` : `Debe tener al menos ${n} elemento(s).`;
  }
  if (issue.type === "number" || issue.type === "bigint") {
    return issue.inclusive ? `Debe ser mayor o igual a ${n}.` : `Debe ser mayor a ${n}.`;
  }
  return "Valor demasiado pequeño.";
}

function tooBigMessage(issue) {
  const n = issue.maximum;
  if (issue.type === "string") {
    return issue.exact ? `Debe tener exactamente ${n} caracteres.` : `Debe tener a lo más ${n} caracteres.`;
  }
  if (issue.type === "array" || issue.type === "set") {
    return issue.exact ? `Debe tener exactamente ${n} elemento(s).` : `Debe tener a lo más ${n} elemento(s).`;
  }
  if (issue.type === "number" || issue.type === "bigint") {
    return issue.inclusive ? `Debe ser menor o igual a ${n}.` : `Debe ser menor a ${n}.`;
  }
  return "Valor demasiado grande.";
}

/** Mapa de errores de zod en español (los mensajes personalizados de cada esquema tienen prioridad). */
function spanishErrorMap(issue, ctx) {
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined") return { message: "Campo obligatorio." };
      return { message: `Tipo inválido: se esperaba ${TYPE_NAMES[issue.expected] || issue.expected}.` };
    case "invalid_literal":
    case "invalid_union":
    case "invalid_union_discriminator":
    case "invalid_intersection_types":
      return { message: "Valor inválido." };
    case "unrecognized_keys":
      return { message: `Campos no permitidos: ${issue.keys.join(", ")}.` };
    case "invalid_enum_value":
      return { message: `Valor inválido. Opciones: ${issue.options.join(", ")}.` };
    case "invalid_date":
      return { message: "Fecha inválida." };
    case "invalid_string":
      return { message: invalidStringMessage(issue.validation) };
    case "too_small":
      return { message: tooSmallMessage(issue) };
    case "too_big":
      return { message: tooBigMessage(issue) };
    case "not_multiple_of":
      return { message: `Debe ser múltiplo de ${issue.multipleOf}.` };
    case "not_finite":
      return { message: "Debe ser un número finito." };
    default:
      return { message: ctx.defaultError };
  }
}

/** Instala el mapa de errores en español para todos los esquemas zod del proceso. */
function installSpanishErrorMap() {
  z.setErrorMap(spanishErrorMap);
}

function joinProblems(parts, total) {
  if (!parts.length) return "Datos inválidos.";
  const extra = total > parts.length ? ` (y ${total - parts.length} más)` : "";
  return `Datos inválidos — ${parts.map((p) => String(p).replace(/\.$/, "")).join("; ")}${extra}.`;
}

/** ZodError → `{ error: string, details }` (máximo tres problemas en el texto). */
function formatZodError(zodError) {
  const issues = Array.isArray(zodError?.issues) ? zodError.issues : [];
  const parts = issues.slice(0, 3).map((issue) => {
    const where = Array.isArray(issue.path) && issue.path.length ? `${issue.path.join(".")}: ` : "";
    return where + (issue.message || "Valor inválido");
  });
  const details = typeof zodError?.flatten === "function" ? zodError.flatten() : undefined;
  return { error: joinProblems(parts, issues.length), details };
}

/** Responde 400 con el error de validación en el formato estándar. */
function validationError(res, zodError) {
  return res.status(400).json({ ok: false, ...formatZodError(zodError), code: "VALIDATION_ERROR" });
}

/**
 * Error de dominio con un código estable para los clientes (`code`, p. ej.
 * OUT_OF_STOCK) además del mensaje en español. `extra` agrega campos a la
 * respuesta (nunca pisa ok/error/code). Un AppError 5xx se enmascara igual
 * que cualquier error interno.
 */
class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.name = "AppError";
    this.statusCode = status;
    this.errorCode = code;
    if (extra && typeof extra === "object") this.extra = extra;
  }
}

function appError(status, code, message, extra) {
  return new AppError(status, code, message, extra);
}

/**
 * 503 con mensaje y código escritos por la app (p. ej. el medio de pago no
 * responde): el cliente necesita el `code` para ofrecer otra vía (WhatsApp).
 * Es opt-in: un AppError 5xx común se sigue enmascarando.
 */
function unavailableError(code, message, extra) {
  const error = new AppError(503, code, message, extra);
  error.exposeMessage = true;
  return error;
}

function isDatabaseError(err) {
  return Boolean(
    err && typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code) && typeof err.severity === "string"
  );
}

/** Violación de UNIQUE (23505), opcionalmente de una restricción/índice concreto. */
function isUniqueViolation(err, constraint) {
  return isDatabaseError(err) && err.code === "23505" && (!constraint || err.constraint === constraint);
}

/** SQLSTATE → `{ status, error }` con un mensaje genérico (nunca el texto del motor). */
function mapDatabaseError(err) {
  const code = String(err?.code || "");
  if (code === "23505") return { status: 409, error: "Ya existe un registro con esos datos." };
  if (code === "23503") return { status: 409, error: "La operación afecta registros relacionados que lo impiden." };
  if (code === "23514") return { status: 400, error: "Uno de los valores no cumple las reglas de los datos." };
  if (code === "23502") return { status: 400, error: "Falta un valor obligatorio." };
  if (code === "22001") return { status: 400, error: "Un texto supera el largo permitido." };
  if (code === "22003") return { status: 400, error: "Un valor numérico está fuera del rango permitido." };
  if (code.startsWith("22")) return { status: 400, error: "Uno de los datos tiene un formato inválido." };
  if (code === "40001" || code === "40P01") {
    return { status: 409, error: "Conflicto por operaciones simultáneas; intenta nuevamente." };
  }
  if (code === "55P03" || code === "57014" || code.startsWith("53") || code.startsWith("08") || code.startsWith("57P")) {
    return { status: 503, error: "La base de datos está ocupada o no disponible; intenta nuevamente." };
  }
  return { status: 500, error: GENERIC_INTERNAL_ERROR };
}

/**
 * Decide qué responder ante un error capturado en una ruta.
 * - Error de PostgreSQL → mensaje genérico según SQLSTATE (y se registra).
 * - Error con statusCode/status 4xx explícito → su mensaje (escrito por la app).
 * - `new Error("...")` simple → `defaultStatus` si es 4xx (convención de rutas
 *   con errores de negocio, p. ej. "Stock insuficiente"); si no, 500 genérico.
 * - Cualquier otro tipo (TypeError, etc.) → 500 genérico (y se registra).
 */
function describeRouteError(err, { defaultStatus = 500 } = {}) {
  if (isDatabaseError(err)) return { ...mapDatabaseError(err), log: true };
  if (err instanceof AppError) {
    const status = Number(err.statusCode);
    if ((Number.isInteger(status) && status >= 400 && status < 500) || (status === 503 && err.exposeMessage === true)) {
      const described = { status, error: String(err.message || "Solicitud inválida."), code: err.errorCode };
      if (err.extra) described.extra = err.extra;
      return { ...described, log: false };
    }
    return { status: 500, error: GENERIC_INTERNAL_ERROR, log: true };
  }
  const explicit = Number(err?.statusCode ?? err?.status);
  if (Number.isInteger(explicit) && explicit >= 400 && explicit < 500) {
    return { status: explicit, error: String(err.message || "Solicitud inválida."), log: false };
  }
  if (Number.isInteger(explicit) && explicit >= 500) {
    return { status: explicit, error: GENERIC_INTERNAL_ERROR, log: true };
  }
  if (err instanceof Error && err.constructor === Error && defaultStatus < 500 && err.message) {
    return { status: defaultStatus, error: err.message, log: false };
  }
  return { status: 500, error: GENERIC_INTERNAL_ERROR, log: true };
}

/** Registra un error del servidor sin datos sensibles (nunca `detail`, que puede traer valores de filas). */
function logServerError(context, err) {
  if (isDatabaseError(err)) {
    const extra = err.constraint ? ` (restricción ${err.constraint})` : "";
    console.error(`[error] ${context}: postgres ${err.code}: ${err.message}${extra}`);
  } else if (err instanceof Error) {
    console.error(`[error] ${context}:`, err.stack || err.message);
  } else {
    console.error(`[error] ${context}:`, String(err));
  }
}

function sendError(res, err, { defaultStatus = 500, context } = {}) {
  const described = describeRouteError(err, { defaultStatus });
  if (described.log) {
    const req = res.req || {};
    logServerError(context || `${req.method || "?"} ${String(req.originalUrl || "").split("?")[0]}`, err);
  }
  const body = { ...(described.extra || {}), ok: false, error: described.error };
  if (described.code) body.code = described.code;
  return res.status(described.status).json(body);
}

function summarizeFlattened(flat) {
  const parts = [];
  for (const message of flat?.formErrors || []) parts.push(String(message));
  for (const [field, messages] of Object.entries(flat?.fieldErrors || {})) {
    if (Array.isArray(messages) && messages.length) parts.push(`${field}: ${messages[0]}`);
  }
  return joinProblems(parts.slice(0, 3), parts.length);
}

/**
 * Red de seguridad para el contrato `error: string`: si una respuesta trae un
 * objeto en `error` (p. ej. un `flatten()` olvidado), lo resume en texto y lo
 * mueve a `details`.
 */
function coerceErrorBody(body) {
  if (!body || typeof body !== "object" || body.error === undefined || typeof body.error === "string") return body;
  if (body.error instanceof Error) return { ...body, error: GENERIC_INTERNAL_ERROR };
  if (body.error && typeof body.error === "object") {
    return { ...body, error: summarizeFlattened(body.error), details: body.error };
  }
  return { ...body, error: String(body.error) };
}

module.exports = {
  GENERIC_INTERNAL_ERROR,
  spanishErrorMap,
  installSpanishErrorMap,
  formatZodError,
  validationError,
  isDatabaseError,
  isUniqueViolation,
  mapDatabaseError,
  describeRouteError,
  logServerError,
  sendError,
  coerceErrorBody,
  AppError,
  appError,
  unavailableError,
};
