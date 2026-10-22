/**
 * Transporte HTTP hacia los proveedores (payments-design §3.7).
 *
 * - `fetch` inyectable (las pruebas usan uno falso; en producción es el global
 *   de Node 20/22) con timeout duro por operación (AbortSignal.timeout).
 * - Lista blanca de hosts: la URL se valida ANTES de enviar; https obligatorio
 *   salvo hosts de desarrollo declarados explícitamente. Sin redirecciones.
 * - Taxonomía de errores (ProviderHttpError.kind):
 *     HTTP_4XX        definitivo (el proveedor procesó y dijo que no), salvo 408/429;
 *     HTTP_5XX, TIMEOUT, NETWORK, INVALID_RESPONSE   ambiguos: NUNCA se asume
 *                     un fracaso (el cobro pudo ocurrir) → status o conciliación;
 *     HOST_NOT_ALLOWED  nada se envió.
 * - Los errores nunca incluyen headers de la solicitud (secretos) ni el texto
 *   de errores de red; el mensaje del proveedor se sanea (≤ 200, sin tokens).
 */

const { sanitizeErrorText } = require("./sanitize");

const MAX_RESPONSE_BYTES = 1024 * 1024;

class ProviderHttpError extends Error {
  constructor(kind, { status = null, providerMessage = null, ambiguous, code = null } = {}) {
    super(`Proveedor de pago: ${kind}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ProviderHttpError";
    this.kind = kind;
    this.status = status;
    this.providerMessage = providerMessage;
    this.ambiguous = Boolean(ambiguous);
    this.code = code;
  }
}

function checkUrl(rawUrl, allowedHosts, insecureHosts) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!allowedHosts.includes(url.host)) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && insecureHosts.includes(url.host)) return url;
  return null;
}

function providerMessageOf(json) {
  if (!json || typeof json !== "object") return null;
  const raw = json.error_message ?? json.message ?? (typeof json.error === "string" ? json.error : null);
  return typeof raw === "string" && raw.trim() ? sanitizeErrorText(raw.trim()) : null;
}

function parseJson(textBody) {
  if (!textBody) return { ok: true, json: null };
  try {
    return { ok: true, json: JSON.parse(textBody) };
  } catch {
    return { ok: false, json: null };
  }
}

/**
 * @param {{ url:string, method?:string, headers?:object, body?:any, timeoutMs:number,
 *           fetchImpl?:Function, allowedHosts:string[], insecureHosts?:string[] }} options
 * @returns {Promise<{ status:number, json:any }>}
 */
async function requestJson({ url, method = "GET", headers = {}, body, timeoutMs, fetchImpl = globalThis.fetch, allowedHosts, insecureHosts = [] }) {
  const target = checkUrl(url, allowedHosts || [], insecureHosts);
  if (!target) throw new ProviderHttpError("HOST_NOT_ALLOWED", { ambiguous: false });

  // Timeout propio (no AbortSignal.timeout, cuyo temporizador no retiene el
  // event loop): cubre la conexión y también la lectura del cuerpo.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Tiempo de espera agotado.", "TimeoutError")), timeoutMs);
  const isTimeout = (err) => controller.signal.aborted || err?.name === "TimeoutError" || err?.name === "AbortError";

  let res;
  let status;
  let textBody = "";
  try {
    try {
      res = await fetchImpl(target.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
    } catch (err) {
      if (isTimeout(err)) throw new ProviderHttpError("TIMEOUT", { ambiguous: true });
      const code = err?.cause?.code || err?.code;
      throw new ProviderHttpError("NETWORK", { ambiguous: true, code: typeof code === "string" ? code.slice(0, 40) : null });
    }

    status = Number(res.status);
    const declared = Number(res.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new ProviderHttpError("INVALID_RESPONSE", { status, ambiguous: true });
    }
    try {
      textBody = await res.text();
    } catch (err) {
      if (isTimeout(err)) throw new ProviderHttpError("TIMEOUT", { status, ambiguous: true });
      const definitive = status >= 400 && status < 500 && status !== 408 && status !== 429;
      throw new ProviderHttpError(status >= 200 && status < 300 ? "INVALID_RESPONSE" : status >= 500 ? "HTTP_5XX" : "HTTP_4XX", {
        status,
        ambiguous: !definitive,
      });
    }
  } finally {
    clearTimeout(timer);
  }
  if (textBody.length > MAX_RESPONSE_BYTES) throw new ProviderHttpError("INVALID_RESPONSE", { status, ambiguous: true });
  const parsed = parseJson(textBody);

  if (status >= 200 && status < 300) {
    if (!parsed.ok) throw new ProviderHttpError("INVALID_RESPONSE", { status, ambiguous: true });
    return { status, json: parsed.json };
  }
  const providerMessage = providerMessageOf(parsed.json);
  if (status >= 400 && status < 500) {
    throw new ProviderHttpError("HTTP_4XX", { status, providerMessage, ambiguous: status === 408 || status === 429 });
  }
  throw new ProviderHttpError("HTTP_5XX", { status, providerMessage, ambiguous: true });
}

module.exports = { requestJson, ProviderHttpError, MAX_RESPONSE_BYTES };
