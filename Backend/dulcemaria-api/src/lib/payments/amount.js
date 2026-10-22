/**
 * Monto autoritativo de un cobro en línea (payments-design §9.2).
 *
 * Es el ÚNICO lugar que decide cuánto se cobra: los adaptadores de Webpay y
 * Mercado Pago nunca calculan montos y ningún endpoint público acepta montos
 * del navegador. Orden del catálogo → total de la orden. Pedido de torta →
 * solo el abono (`deposit_clp`, decisión D1); el saldo se paga al entregar y
 * lo registra el panel como pago manual.
 *
 * Dinero siempre en pesos chilenos enteros (CLP no tiene decimales).
 */

const { appError } = require("../httpErrors");
const { MAX_CLP } = require("../schemas");

const MAX_ONLINE_AMOUNT_CLP = MAX_CLP;

/** Entero exacto (acepta el texto que entrega pg para INT/BIGINT); null si no lo es. */
function toExactInteger(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string" && /^-?\d{1,16}$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function invalidAmount(detail) {
  return appError(409, "AMOUNT_INVALID", `El monto a pagar no es válido (${detail}). Escríbenos por WhatsApp para completar tu pedido.`);
}

/** Monto CLP entero, positivo y dentro del tope; lanza ante cualquier otra cosa. */
function assertClpAmount(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_ONLINE_AMOUNT_CLP) {
    throw invalidAmount("monto fuera de rango");
  }
  return value;
}

function positiveClp(value, label) {
  const n = toExactInteger(value);
  if (n === null || n <= 0 || n > MAX_ONLINE_AMOUNT_CLP) throw invalidAmount(label);
  return n;
}

/**
 * @param {{kind:'ORDER', total_clp:number|string} | {kind:'CAKE', total_price_clp:number|string, deposit_clp:number|string}} target
 * @returns {{ amountClp: number, currency: 'CLP', basis: 'ORDER_TOTAL'|'CAKE_DEPOSIT' }}
 */
function amountToCharge(target) {
  if (target?.kind === "ORDER") {
    return { amountClp: positiveClp(target.total_clp, "total de la orden"), currency: "CLP", basis: "ORDER_TOTAL" };
  }
  if (target?.kind === "CAKE") {
    const total = positiveClp(target.total_price_clp, "total de la torta");
    const deposit = positiveClp(target.deposit_clp, "abono de la torta");
    if (deposit > total) throw invalidAmount("el abono supera el total");
    return { amountClp: deposit, currency: "CLP", basis: "CAKE_DEPOSIT" };
  }
  throw new Error(`Tipo de destino de pago desconocido: ${target?.kind}`);
}

/** Saldo de una torta (total − abono), lo que se paga al entregar. */
function cakeBalanceClp(cake) {
  const total = toExactInteger(cake?.total_price_clp);
  const deposit = toExactInteger(cake?.deposit_clp);
  if (total === null || deposit === null || total < 0 || deposit < 0 || deposit > total) {
    throw invalidAmount("saldo de la torta");
  }
  return total - deposit;
}

module.exports = { MAX_ONLINE_AMOUNT_CLP, amountToCharge, assertClpAmount, cakeBalanceClp, toExactInteger };
