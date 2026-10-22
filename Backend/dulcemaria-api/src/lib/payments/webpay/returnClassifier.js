/**
 * Clasifica el retorno del navegador desde Webpay a `return_url` (puro).
 *
 * Flujos documentados (https://www.transbankdevelopers.cl/documentacion/webpay-plus,
 * verificado 2026-10-21):
 *   NORMAL      solo `token_ws` (aprobado o rechazado). GET desde la API 1.1.
 *   ABORTED     `TBK_TOKEN` + `TBK_ORDEN_COMPRA` + `TBK_ID_SESION` (el cliente
 *               anuló). GET en producción, POST en integración.
 *   TIMEOUT     `TBK_ORDEN_COMPRA` + `TBK_ID_SESION`, sin token (venció el
 *               formulario: 4 min en producción, 10 en integración).
 *   FORM_ERROR  `token_ws` + `TBK_TOKEN` (+ `TBK_*`): error en el formulario.
 *   INVALID     cualquier otra cosa: no cambia ningún estado.
 *
 * Se leen la query (GET) y el cuerpo urlencoded (POST) a la vez, como el
 * plugin oficial; un mismo parámetro con valores distintos, valores que no son
 * texto (arreglos u objetos), demasiado largos o con caracteres fuera del juego
 * permitido → INVALID. Los parámetros ajenos se ignoran.
 */

const MAX_VALUE_LENGTH = 128;
const KNOWN_KEYS = Object.freeze(["token_ws", "TBK_TOKEN", "TBK_ORDEN_COMPRA", "TBK_ID_SESION"]);
// Token de Webpay: 64 caracteres (hex en la práctica); se acepta un juego seguro más amplio.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
// buy_order según la referencia de Webpay (≤ 26): alfanuméricos y |_=&%.,~:/?[+!@>-
const BUY_ORDER_PATTERN = /^[A-Za-z0-9|_=&%.,~:/?[+!@>-]{1,26}$/;
// session_id ≤ 61 (el nuestro es el UUID del intento).
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,61}$/;

const PATTERNS = Object.freeze({
  token_ws: TOKEN_PATTERN,
  TBK_TOKEN: TOKEN_PATTERN,
  TBK_ORDEN_COMPRA: BUY_ORDER_PATTERN,
  TBK_ID_SESION: SESSION_PATTERN,
});

function invalid(reason) {
  return { variant: "INVALID", token: null, buyOrder: null, sessionId: null, reason };
}

function readSource(source) {
  return source && typeof source === "object" && !Array.isArray(source) ? source : {};
}

/**
 * @param {{ method?: string, query?: object, body?: object, bodyError?: boolean }} input
 * @returns {{ variant: 'NORMAL'|'ABORTED'|'TIMEOUT'|'FORM_ERROR'|'INVALID', token: string|null,
 *             buyOrder: string|null, sessionId: string|null, reason?: string }}
 */
function classifyWebpayReturn({ query, body, bodyError } = {}) {
  if (bodyError) return invalid("BODY_UNREADABLE");
  const sources = [readSource(body), readSource(query)];
  const params = {};
  for (const key of KNOWN_KEYS) {
    for (const source of sources) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const raw = source[key];
      if (raw === undefined || raw === null || raw === "") continue;
      if (typeof raw !== "string") return invalid("NON_STRING_VALUE");
      const value = raw.trim();
      if (!value) continue;
      if (value.length > MAX_VALUE_LENGTH) return invalid("VALUE_TOO_LONG");
      if (!PATTERNS[key].test(value)) return invalid("INVALID_CHARACTERS");
      if (params[key] !== undefined && params[key] !== value) return invalid("CONFLICTING_VALUES");
      params[key] = value;
    }
  }

  const hasToken = params.token_ws !== undefined;
  const hasTbkToken = params.TBK_TOKEN !== undefined;
  const hasOrder = params.TBK_ORDEN_COMPRA !== undefined;
  const hasSession = params.TBK_ID_SESION !== undefined;
  const result = (variant, token) => ({
    variant,
    token: token ?? null,
    buyOrder: params.TBK_ORDEN_COMPRA ?? null,
    sessionId: params.TBK_ID_SESION ?? null,
  });

  if (hasToken && hasTbkToken) {
    if (params.token_ws !== params.TBK_TOKEN) return invalid("TOKEN_MISMATCH");
    return result("FORM_ERROR", params.token_ws);
  }
  if (hasToken) return !hasOrder && !hasSession ? result("NORMAL", params.token_ws) : invalid("UNDOCUMENTED_COMBINATION");
  if (hasTbkToken) return hasOrder && hasSession ? result("ABORTED", params.TBK_TOKEN) : invalid("UNDOCUMENTED_COMBINATION");
  if (hasOrder && hasSession) return result("TIMEOUT", null);
  return invalid(hasOrder || hasSession ? "UNDOCUMENTED_COMBINATION" : "NO_PARAMETERS");
}

module.exports = { classifyWebpayReturn, KNOWN_KEYS, MAX_VALUE_LENGTH };
