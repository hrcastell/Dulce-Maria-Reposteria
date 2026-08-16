/**
 * Motor de Tarifa — cálculo y registro del cobro de plataforma por orden
 * cerrada.
 *
 * Cobra el DUEÑO DE LA PLATAFORMA al dueño de esta instancia (panadería)
 * una tarifa fija en CLP por cada orden que pasa a DELIVERED. La tarifa
 * depende del volumen acumulado del MES CALENDARIO (America/Santiago) hasta
 * e INCLUYENDO la orden que se está cerrando — nunca se recalcula
 * retroactivamente si un umbral se cruza a mitad de mes (auditabilidad:
 * un cobro ya emitido no debe cambiar solo).
 *
 * Contrato de evaluateAndChargeFee(client, order):
 *   - Debe llamarse DENTRO de la misma transacción Postgres (mismo
 *     `client`) que el INSERT/UPDATE que dejó la orden en DELIVERED. Así
 *     una orden jamás puede quedar DELIVERED sin su fila de cobro, ni
 *     viceversa.
 *   - Es idempotente: usa INSERT ... ON CONFLICT (order_id) DO NOTHING.
 *     Se puede llamar más de una vez para la misma orden (doble-click,
 *     orden que va DELIVERED→CANCELLED→DELIVERED de nuevo, reintento de
 *     red) sin generar cobros duplicados.
 *   - NUNCA lanza por falta de configuración (sin tiers activos): cae al
 *     fallback (system_config.platform_fee_default_clp, 0 si no existe la
 *     key) y deja la fila marcada is_fallback=true. Solo puede lanzar por
 *     errores reales de base de datos, que de todos modos deben abortar la
 *     transacción completa (falla ruidosa > cobro perdido en silencio).
 *   - `order` debe traer al menos { id, order_no, order_code, total_clp }.
 *
 * Devuelve la fila de platform_fee_charges (la recién insertada, o la ya
 * existente si no hizo nada por conflicto de idempotencia).
 */

const crypto = require("crypto");

const TIMEZONE = "America/Santiago";
const ADVISORY_LOCK_KEY = "platform_fee_period_lock";

async function evaluateAndChargeFee(client, order) {
  const orderTotalClpRaw = Number(order.total_clp) || 0;
  // Para el cálculo de volumen tratamos montos negativos (ajustes,
  // cortesías mal cargadas) como 0 — nunca deben reducir el volumen
  // acumulado del mes. El snapshot guardado en la fila sí conserva el
  // valor real (orderTotalClpRaw), para fidelidad de auditoría.
  const orderTotalClpForVolume = Math.max(0, orderTotalClpRaw);

  // Serializa cierres concurrentes dentro del mismo período: evita que dos
  // órdenes cerradas en el mismo instante lean el mismo "volumen previo".
  // No afecta la integridad de la plata (la UNIQUE(order_id) ya la
  // garantiza), solo la precisión de "cuál orden cruzó el umbral primero"
  // bajo concurrencia real (evento de probabilidad muy baja acá).
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [ADVISORY_LOCK_KEY]);

  const periodRes = await client.query(
    `SELECT date_trunc('month', NOW() AT TIME ZONE $1)::date AS period_month`,
    [TIMEZONE]
  );
  const periodMonth = periodRes.rows[0].period_month;

  // Self-contenido: no hace falta JOIN a orders gracias al snapshot
  // order_total_clp ya guardado en cobros previos del mes.
  const priorRes = await client.query(
    `SELECT COALESCE(SUM(order_total_clp), 0)::bigint AS prior_volume,
            COUNT(*)::int AS prior_count
     FROM platform_fee_charges
     WHERE period_month = $1`,
    [periodMonth]
  );
  const priorVolume = Number(priorRes.rows[0].prior_volume);
  const priorCount = Number(priorRes.rows[0].prior_count);

  const volumeSoFar = priorVolume + orderTotalClpForVolume;
  const txnOrdinal = priorCount + 1;

  const tierRes = await client.query(
    `SELECT id, label, fee_per_transaction_clp
     FROM platform_fee_tiers
     WHERE is_active = true
       AND min_monthly_volume_clp <= $1
       AND (max_monthly_volume_clp IS NULL OR $1 < max_monthly_volume_clp)
     ORDER BY min_monthly_volume_clp DESC
     LIMIT 1`,
    [volumeSoFar]
  );

  let tierId = null;
  let tierLabelSnapshot;
  let feeAppliedClp;
  let isFallback;

  if (tierRes.rowCount > 0) {
    const tier = tierRes.rows[0];
    tierId = tier.id;
    tierLabelSnapshot = tier.label;
    feeAppliedClp = Number(tier.fee_per_transaction_clp);
    isFallback = false;
  } else {
    // Sin tier configurado que cubra este volumen (incluye el caso de no
    // tener NINGÚN tier configurado todavía). Nunca se salta el registro
    // del cobro en silencio: se usa la tarifa de respaldo de
    // system_config, marcada is_fallback=true para que el dashboard la
    // muestre como alerta operativa.
    const fallbackRes = await client.query(
      `SELECT value FROM system_config WHERE key = 'platform_fee_default_clp' LIMIT 1`
    );
    const fallbackValue = fallbackRes.rowCount > 0 ? Number(fallbackRes.rows[0].value) : 0;
    feeAppliedClp = Number.isFinite(fallbackValue) ? Math.max(0, fallbackValue) : 0;
    tierLabelSnapshot = "Tarifa de respaldo (sin tier configurado)";
    isFallback = true;
  }

  const chargeId = crypto.randomUUID();

  const insertRes = await client.query(
    `INSERT INTO platform_fee_charges (
       id, order_id, order_no, order_code, order_total_clp,
       tier_id, tier_label_snapshot, fee_applied_clp, is_fallback,
       period_month, monthly_volume_at_charge_clp, monthly_txn_ordinal,
       source_status, charged_at, created_at, updated_at
     )
     VALUES (
       $1,$2,$3,$4,$5,
       $6,$7,$8,$9,
       $10,$11,$12,
       'DELIVERED', NOW(), NOW(), NOW()
     )
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [
      chargeId, order.id, order.order_no, order.order_code ?? null, orderTotalClpRaw,
      tierId, tierLabelSnapshot, feeAppliedClp, isFallback,
      periodMonth, volumeSoFar, txnOrdinal,
    ]
  );

  if (insertRes.rowCount > 0) {
    return insertRes.rows[0];
  }

  // Conflicto de idempotencia: ya existía un cobro para esta orden. Lo
  // devolvemos tal cual está, sin tocarlo.
  const existing = await client.query(
    `SELECT * FROM platform_fee_charges WHERE order_id = $1 LIMIT 1`,
    [order.id]
  );
  return existing.rows[0] ?? null;
}

module.exports = { evaluateAndChargeFee, TIMEZONE };
