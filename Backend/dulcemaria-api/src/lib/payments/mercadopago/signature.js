/**
 * Validación de la firma `x-signature` de los webhooks de Mercado Pago (puro).
 *
 * Documentación oficial (verificada 2026-10-21, "Validar a origem da
 * notificação" / Webhooks de Suas integrações):
 *   - header `x-signature: ts=<ts>,v1=<hmac>`; header `x-request-id`;
 *     query `data.id` (leída de la query CRUDA, sin normalizar por el framework);
 *   - manifiesto `id:[data.id];request-id:[x-request-id];ts:[ts];`, omitiendo
 *     el par cuyo valor no venga; `data.id` alfanumérico en minúsculas;
 *   - HMAC-SHA256 en hexadecimal con la clave secreta de la aplicación,
 *     comparado en tiempo constante; si no coincide se responde 401.
 * Unidad de `ts`: el texto dice milisegundos pero el ejemplo trae 10 dígitos
 * (segundos), como lo trata el SDK oficial → ≥ 13 dígitos = ms, si no = s.
 * Nunca lanza ni registra el secreto ni la firma.
 *
 * Tolerancia de `ts`: MP reintenta una notificación no confirmada a los 0,
 * 15 y 30 min, 6 h, 48 h y 96 h ×3 (~14 días), y la documentación no dice si
 * `ts` se regenera en cada reintento. Como el cuerpo nunca se cree (se consulta
 * el pago a MP) y cada notificación se procesa una sola vez (dedupe), aceptar
 * una firma válida pero vieja no tiene efecto dañino; rechazar los reintentos
 * sí (un contracargo podría perderse). Se rechaza solo lo absurdo: más de
 * 15 días de antigüedad o más de 5 minutos en el futuro.
 */

const crypto = require("crypto");

const DEFAULT_MAX_AGE_SEC = 15 * 24 * 60 * 60;
const DEFAULT_MAX_FUTURE_SKEW_SEC = 300;
const MAX_VALUE = 256;

/** Valor único de un header/parámetro: texto recortado, no vacío y acotado; null si es ambiguo (arreglo). */
function single(value) {
  if (Array.isArray(value)) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= MAX_VALUE ? text : undefined;
}

function buildManifest({ dataId, requestId, ts }) {
  let manifest = "";
  if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

/** `ts=..,v1=..` → { ts, v1 } o { error } ante claves repetidas. */
function parseSignatureHeader(header) {
  const fields = {};
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (key !== "ts" && key !== "v1") continue;
    if (fields[key] !== undefined) return { error: "MALFORMED_HEADER" };
    fields[key] = value;
  }
  return fields;
}

/**
 * @param {{ xSignature:any, xRequestId:any, dataId:any, secret:string, nowMs?:number, maxAgeSec?:number, maxFutureSkewSec?:number }} input
 * @returns {{ ok: true, ts: string } | { ok: false, reason: string, ts?: string }}
 */
function verifyWebhookSignature({
  xSignature,
  xRequestId,
  dataId,
  secret,
  nowMs = Date.now(),
  maxAgeSec = DEFAULT_MAX_AGE_SEC,
  maxFutureSkewSec = DEFAULT_MAX_FUTURE_SKEW_SEC,
}) {
  if (!secret) return { ok: false, reason: "MISSING_SECRET" };
  const headerValue = single(xSignature);
  const requestId = single(xRequestId);
  const id = single(dataId);
  if (headerValue === null || requestId === null || id === null) return { ok: false, reason: "MALFORMED_HEADER" };
  if (!headerValue) return { ok: false, reason: "MISSING_SIGNATURE" };

  const parsed = parseSignatureHeader(headerValue);
  if (parsed.error) return { ok: false, reason: parsed.error };
  const ts = parsed.ts;
  const v1 = typeof parsed.v1 === "string" ? parsed.v1.toLowerCase() : undefined;
  if (!ts || !/^\d{10,16}$/.test(ts)) return { ok: false, reason: "MALFORMED_TS" };
  if (!v1 || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, reason: "MALFORMED_V1" };

  const expected = crypto.createHmac("sha256", secret).update(buildManifest({ dataId: id, requestId, ts })).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(v1, "hex"))) return { ok: false, reason: "SIGNATURE_MISMATCH", ts };

  const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
  if (nowMs - tsMs > maxAgeSec * 1000 || tsMs - nowMs > maxFutureSkewSec * 1000) return { ok: false, reason: "TS_OUT_OF_TOLERANCE", ts };
  return { ok: true, ts };
}

module.exports = { verifyWebhookSignature, buildManifest, DEFAULT_MAX_AGE_SEC, DEFAULT_MAX_FUTURE_SKEW_SEC };
