/**
 * Referencias de pago (payments-design §9.3). Módulo puro: el generador de
 * bytes aleatorios se inyecta (por defecto crypto.randomBytes).
 *
 * buy_order (Webpay) = external_reference (Mercado Pago):
 *   - orden del catálogo: `DM<order_no en base 36>-<8 Crockford>` (p. ej. DM3F-K9X2M4QZ);
 *   - pedido de torta:     `DT-<8 Crockford>`.
 *   Los 8 caracteres salen de 5 bytes aleatorios (40 bits, sin sesgo de
 *   módulo): evitan choques en el comercio de integración 597055555532, que
 *   comparten todos los integradores. El juego [A-Z0-9-] cumple a la vez el de
 *   Webpay (≤ 26) y el de external_reference de MP (≤ 64, letras/números/-/_).
 *
 * Token de acceso (capacidad de la página de pago): 32 bytes aleatorios en
 * base64url (43 caracteres). Solo permite ver el estado sin datos personales
 * y pagar/reintentar; viaja en el fragmento de la URL (#t=), nunca en logs.
 */

const crypto = require("crypto");

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BUY_ORDER_PATTERN = /^D(?:M[0-9A-Z]{1,11}|T)-[0-9A-HJKMNP-TV-Z]{8}$/;
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BUY_ORDER_LENGTH = 26;

/** 5 bytes → 8 caracteres Crockford base32 (bits más significativos primero). */
function crockfordBase32(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 5) throw new Error("crockfordBase32 necesita exactamente 5 bytes.");
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let out = "";
  for (let shift = 35n; shift >= 0n; shift -= 5n) out += CROCKFORD_ALPHABET[Number((bits >> shift) & 31n)];
  return out;
}

/**
 * @param {{kind:'ORDER', orderNo:number} | {kind:'CAKE'}} target
 * @param {(n:number)=>Buffer} [randomBytes]
 */
function newBuyOrder(target, randomBytes = crypto.randomBytes) {
  const suffix = crockfordBase32(randomBytes(5));
  let value;
  if (target?.kind === "ORDER") {
    const orderNo = target.orderNo;
    if (!Number.isSafeInteger(orderNo) || orderNo <= 0) throw new Error(`Número de orden inválido para buy_order: ${orderNo}`);
    value = `DM${orderNo.toString(36).toUpperCase()}-${suffix}`;
  } else if (target?.kind === "CAKE") {
    value = `DT-${suffix}`;
  } else {
    throw new Error(`Tipo de destino de pago desconocido: ${target?.kind}`);
  }
  if (value.length > MAX_BUY_ORDER_LENGTH || !BUY_ORDER_PATTERN.test(value)) throw new Error(`buy_order fuera de formato: ${value}`);
  return value;
}

function isOurBuyOrder(value) {
  return typeof value === "string" && value.length <= MAX_BUY_ORDER_LENGTH && BUY_ORDER_PATTERN.test(value);
}

/** @param {(n:number)=>Buffer} [randomBytes] */
function newAccessToken(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString("base64url");
}

function isAccessToken(value) {
  return typeof value === "string" && ACCESS_TOKEN_PATTERN.test(value);
}

/** Prefijo corto para logs y el panel (nunca el valor completo). */
function tokenHint(value) {
  if (typeof value !== "string") return null;
  return value.length > 8 ? `${value.slice(0, 6)}…` : "…";
}

module.exports = {
  BUY_ORDER_PATTERN,
  ACCESS_TOKEN_PATTERN,
  MAX_BUY_ORDER_LENGTH,
  crockfordBase32,
  newBuyOrder,
  isOurBuyOrder,
  newAccessToken,
  isAccessToken,
  tokenHint,
};
