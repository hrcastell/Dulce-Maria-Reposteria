/**
 * Dinero de los pedidos de torta (decisión D1). Módulo puro.
 *
 *   - Abono (deposit_clp, 50 %): se paga EN LÍNEA al enviar el pedido (o, en el
 *     flujo manual, por transferencia/efectivo y lo registra el panel).
 *     cake_orders.deposit_status: PENDING | PAID | FAILED (venció sin pagar) | REFUNDED.
 *   - Saldo (total − abono): se paga al entregar; lo registra el panel como
 *     pago manual. cake_orders.balance_status: PENDING | PAID.
 *   - La torta queda "pagada" cuando abono y saldo están pagados (o el saldo es 0).
 * El estado del pedido (cumplimiento) vive aparte en cakeOrderStatus.js.
 */

const { cakeBalanceClp, toExactInteger } = require("./amount");

const CAKE_DEPOSIT_STATUSES = Object.freeze(["PENDING", "PAID", "FAILED", "REFUNDED"]);
const CAKE_BALANCE_STATUSES = Object.freeze(["PENDING", "PAID"]);
const MANUAL_PAYMENT_PARTS = Object.freeze(["DEPOSIT", "BALANCE"]);

/** Estado de pago derivado (no se guarda): PENDING | DEPOSIT_PAID | PAID | REFUNDED. */
function cakePaymentSummary(cake) {
  const total = toExactInteger(cake.total_price_clp) ?? 0;
  const deposit = toExactInteger(cake.deposit_clp) ?? 0;
  const balance = cakeBalanceClp(cake);
  const depositPaid = cake.deposit_status === "PAID";
  const balancePaid = cake.balance_status === "PAID" || balance === 0;
  let paymentStatus = "PENDING";
  if (cake.deposit_status === "REFUNDED") paymentStatus = "REFUNDED";
  else if (depositPaid && balancePaid) paymentStatus = "PAID";
  else if (depositPaid) paymentStatus = "DEPOSIT_PAID";
  const amountDue = paymentStatus === "PENDING" ? deposit : paymentStatus === "DEPOSIT_PAID" ? balance : 0;
  return {
    payment_status: paymentStatus,
    deposit_status: cake.deposit_status,
    balance_status: cake.balance_status,
    total_clp: total,
    deposit_clp: deposit,
    balance_clp: balance,
    amount_due_clp: amountDue,
  };
}

function reject(httpStatus, code, error) {
  return { ok: false, httpStatus, code, error };
}

/**
 * Pago manual registrado por el panel (solo ADMIN/SUPERADMIN; lo verifica la ruta).
 * @param {object} cake fila bloqueada de cake_orders
 * @param {{ part:'DEPOSIT'|'BALANCE', hasManagedOnlineAttempt?:boolean }} input
 */
function decideManualCakePayment(cake, { part, hasManagedOnlineAttempt = false }) {
  if (!MANUAL_PAYMENT_PARTS.includes(part)) throw new Error(`Parte de pago desconocida: ${part}`);
  if (cake.status === "CANCELLED") return reject(409, "ORDER_CANCELLED", "No se puede registrar un pago en un pedido de torta cancelado.");

  if (part === "DEPOSIT") {
    const amountClp = toExactInteger(cake.deposit_clp);
    if (cake.deposit_status === "PAID") return { ok: true, noop: true, part, amountClp, advanceTo: null };
    if (cake.deposit_status === "REFUNDED") return reject(409, "PAYMENT_FINALIZED", "El abono ya fue reembolsado: su estado no se puede cambiar.");
    if (hasManagedOnlineAttempt) {
      return reject(
        409,
        "ONLINE_PAYMENT_MANAGED",
        "El abono de este pedido lo está gestionando la pasarela (pago en curso o registrado): concilia el pago en vez de registrarlo a mano."
      );
    }
    return { ok: true, noop: false, part, amountClp, advanceTo: cake.status === "PENDING_PAYMENT" ? "CONFIRMED" : null };
  }

  const amountClp = cakeBalanceClp(cake);
  if (cake.deposit_status !== "PAID") return reject(409, "DEPOSIT_NOT_PAID", "Primero debe estar pagado el abono de la torta.");
  if (cake.balance_status === "PAID") return { ok: true, noop: true, part, amountClp, advanceTo: null };
  return { ok: true, noop: false, part, amountClp, advanceTo: null };
}

module.exports = { CAKE_DEPOSIT_STATUSES, CAKE_BALANCE_STATUSES, MANUAL_PAYMENT_PARTS, cakePaymentSummary, decideManualCakePayment };
