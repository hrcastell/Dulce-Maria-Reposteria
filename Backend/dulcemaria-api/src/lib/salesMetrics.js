/**
 * Qué órdenes cuentan como venta en reportes y métricas.
 *
 * `payment_status` es la única fuente de verdad del dinero. Una orden NO
 * cuenta como venta si:
 *   - está cancelada (status CANCELLED), o
 *   - su pago fue reembolsado (payment_status REFUNDED), o
 *   - sigue pendiente de pago y el pago no está registrado
 *     (status PENDING_PAYMENT con payment_status distinto de PAID): carritos
 *     web sin confirmar, pagos en línea abandonados.
 * Una orden confirmada (PAID/PREPARING/READY/DELIVERED) cuenta aunque se
 * cobre contra entrega.
 */

const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;

function countsAsSale(order) {
  const status = order?.status;
  const paymentStatus = order?.payment_status;
  if (status === "CANCELLED") return false;
  if (paymentStatus === "REFUNDED") return false;
  if (status === "PENDING_PAYMENT" && paymentStatus !== "PAID") return false;
  return true;
}

/** La misma regla en SQL, para un alias de la tabla orders (o sin alias). */
function salesOrderFilterSql(alias) {
  if (alias !== undefined && !SQL_ALIAS.test(alias)) throw new Error(`Alias SQL inválido: ${alias}`);
  const p = alias ? `${alias}.` : "";
  return (
    `(${p}status <> 'CANCELLED' AND ${p}payment_status <> 'REFUNDED' ` +
    `AND NOT (${p}status = 'PENDING_PAYMENT' AND ${p}payment_status <> 'PAID'))`
  );
}

module.exports = { countsAsSale, salesOrderFilterSql };
