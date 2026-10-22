/**
 * ¿Se puede iniciar (o reintentar) un pago en línea de esta orden o torta
 * ahora? Módulo puro, usado por el inicio del pago y por la vista pública
 * (`can_retry`). El monto lo decide amount.js; aquí solo la elegibilidad.
 *
 * D2 (solo residentes): con el modo activo, un pedido WEB sin declaración de
 * residencia (p. ej. creado cuando el modo estaba en OPEN) no puede iniciar el
 * pago. Las órdenes creadas en el panel (no residentes autorizados por la
 * dueña) y los pedidos cuyo enlace de pago generó el panel siempre se pueden
 * pagar con su enlace.
 */

function reject(httpStatus, code, error) {
  return { ok: false, httpStatus, code, error };
}

const toDate = (value) => (value instanceof Date ? value : value ? new Date(value) : null);

/**
 * @param {{ target:object, attempts:object[], now:Date, maxAttempts:number, salesMode:string }} input
 * @returns {{ ok:true } | { ok:false, httpStatus:number, code:string, error:string }}
 */
function checkTargetPayable({ target, attempts, now, maxAttempts, salesMode }) {
  const money = target.kind === "ORDER" ? target.payment_status : target.deposit_status;
  if (money === "PAID") return reject(409, "ORDER_ALREADY_PAID", "Este pedido ya está pagado.");
  if (money === "REFUNDED") return reject(409, "ORDER_NOT_PAYABLE", "El pago de este pedido fue reembolsado: escríbenos por WhatsApp.");
  if (target.status === "CANCELLED") {
    return target.cancellation_source === "PAYMENT_EXPIRED"
      ? reject(410, "PAYMENT_WINDOW_EXPIRED", "El plazo para pagar este pedido venció. Vuelve a armar tu pedido o escríbenos por WhatsApp.")
      : reject(409, "ORDER_CANCELLED", "Este pedido fue cancelado. Escríbenos por WhatsApp si necesitas ayuda.");
  }
  if (target.payment_method !== "ONLINE") {
    return reject(409, "ORDER_NOT_PAYABLE", "Este pedido no se paga en línea: coordina el pago por WhatsApp.");
  }
  // El enlace de pago que crea el panel (payment_link_created_at) es la autorización de la dueña.
  if (salesMode !== "OPEN" && target.channel === "WEB" && !target.residency_declared_at && !target.payment_link_created_at) {
    return reject(403, "RESIDENTS_ONLY", "Por ahora solo vendemos a residentes del condominio. Escríbenos por WhatsApp para coordinar tu pedido.");
  }
  const deadline = toDate(target.payment_expires_at);
  if (deadline && now.getTime() >= deadline.getTime()) {
    return reject(410, "PAYMENT_WINDOW_EXPIRED", "El plazo para pagar este pedido venció. Vuelve a armar tu pedido o escríbenos por WhatsApp.");
  }
  const list = Array.isArray(attempts) ? attempts : [];
  if (list.some((a) => a.status === "NEEDS_REVIEW")) {
    return reject(409, "PAYMENT_UNDER_REVIEW", "Estamos verificando un pago de este pedido. Escríbenos por WhatsApp antes de volver a pagar.");
  }
  if (list.some((a) => a.status === "COMMITTING")) {
    return reject(409, "PAYMENT_IN_PROGRESS", "Estamos confirmando un pago de este pedido; espera unos segundos.");
  }
  if (list.length >= maxAttempts) {
    return reject(429, "TOO_MANY_ATTEMPTS", "Superaste el número de intentos de pago de este pedido. Escríbenos por WhatsApp para completarlo.");
  }
  return { ok: true };
}

module.exports = { checkTargetPayable };
