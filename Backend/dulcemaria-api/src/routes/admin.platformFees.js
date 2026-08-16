/**
 * Motor de Tarifa — endpoints exclusivos del DUEÑO DE LA PLATAFORMA.
 *
 * Nunca visibles para el dueño de la panadería que opera esta instancia,
 * aunque tenga rol SUPERADMIN. requirePlatformOwner compara únicamente
 * req.user.email contra PLATFORM_OWNER_EMAIL — nunca cae de vuelta a un
 * chequeo de rol. Se aplica acá, al tope del router, para que quede
 * declarado en un solo lugar auditable (no depende de que server.js lo
 * repita en cada ruta futura).
 */

const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");

const { getPool } = require("../db");
const { requirePlatformOwner } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { TIMEZONE } = require("../lib/platformFeeEngine");

const router = express.Router();

router.use(requirePlatformOwner);

// Sentinel para "sin techo" (max_monthly_volume_clp NULL) en la comparación
// de solapamiento de rangos — nunca se espera un volumen real ni cercano.
const RANGE_INFINITY = "9223372036854775807"; // bigint max

/**
 * Busca un tier ACTIVO cuyo rango [min, max) se solape con el rango dado.
 * Se usa tanto en creación como en edición (excludeId para no chocar
 * contra sí mismo).
 */
async function findOverlappingTier(pool, { min, max, excludeId }) {
  const r = await pool.query(
    `SELECT id, label FROM platform_fee_tiers
     WHERE is_active = true
       AND ($3::uuid IS NULL OR id <> $3)
       AND min_monthly_volume_clp < COALESCE($2::bigint, ${RANGE_INFINITY}::bigint)
       AND $1::bigint < COALESCE(max_monthly_volume_clp, ${RANGE_INFINITY}::bigint)
     LIMIT 1`,
    [min, max, excludeId]
  );
  return r.rowCount > 0 ? r.rows[0] : null;
}

const TIER_COLUMNS = `id, label, min_monthly_volume_clp, max_monthly_volume_clp,
                       fee_per_transaction_clp, is_active, created_at, updated_at`;

/**
 * GET /admin/platform-fees/tiers
 * Lista todos los tiers (activos e inactivos), ordenados por piso de rango.
 */
router.get("/tiers", async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT ${TIER_COLUMNS} FROM platform_fee_tiers ORDER BY min_monthly_volume_clp ASC`
    );
    return res.json({ ok: true, tiers: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

const tierCreateSchema = z.object({
  label: z.string().min(1),
  min_monthly_volume_clp: z.number().int().nonnegative(),
  max_monthly_volume_clp: z.number().int().positive().nullable().optional(),
  fee_per_transaction_clp: z.number().int().nonnegative(),
  is_active: z.boolean().optional().default(true),
});

/**
 * POST /admin/platform-fees/tiers
 * Crea un tier. 409 si el rango se solapa con un tier activo existente.
 */
router.post("/tiers", async (req, res) => {
  const parsed = tierCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { label, min_monthly_volume_clp, fee_per_transaction_clp, is_active } = parsed.data;
  const max_monthly_volume_clp = parsed.data.max_monthly_volume_clp ?? null;

  if (max_monthly_volume_clp != null && max_monthly_volume_clp <= min_monthly_volume_clp) {
    return res.status(400).json({ ok: false, error: "max_monthly_volume_clp debe ser mayor a min_monthly_volume_clp" });
  }

  try {
    const pool = getPool();

    if (is_active) {
      const overlap = await findOverlappingTier(pool, { min: min_monthly_volume_clp, max: max_monthly_volume_clp, excludeId: null });
      if (overlap) {
        return res.status(409).json({ ok: false, error: `El rango se superpone con el tier activo "${overlap.label}"` });
      }
    }

    const id = crypto.randomUUID();
    const r = await pool.query(
      `INSERT INTO platform_fee_tiers (
         id, label, min_monthly_volume_clp, max_monthly_volume_clp,
         fee_per_transaction_clp, is_active, created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       RETURNING ${TIER_COLUMNS}`,
      [id, label, min_monthly_volume_clp, max_monthly_volume_clp, fee_per_transaction_clp, is_active]
    );

    return res.status(201).json({ ok: true, tier: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

const tierUpdateSchema = z.object({
  label: z.string().min(1).optional(),
  min_monthly_volume_clp: z.number().int().nonnegative().optional(),
  max_monthly_volume_clp: z.number().int().positive().nullable().optional(),
  fee_per_transaction_clp: z.number().int().nonnegative().optional(),
  is_active: z.boolean().optional(),
});

/**
 * PATCH /admin/platform-fees/tiers/:id
 * Edita label/rango/tarifa/is_active. NUNCA toca filas existentes de
 * platform_fee_charges — esas quedan congeladas con la tarifa que estaba
 * vigente cuando se cobraron (garantía de diseño, no un detalle incidental).
 */
router.patch("/tiers/:id", validateUuidParam("id"), async (req, res) => {
  const parsed = tierUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ ok: false, error: "Nada para actualizar" });
  }

  const { id } = req.params;

  try {
    const pool = getPool();

    const existingR = await pool.query(`SELECT ${TIER_COLUMNS} FROM platform_fee_tiers WHERE id=$1`, [id]);
    if (existingR.rowCount === 0) return res.status(404).json({ ok: false, error: "Tier no encontrado" });
    const existing = existingR.rows[0];

    // El spread ya cubre "limpiar el techo mandando max=null explícito"
    // (Zod deja pasar null porque el campo es nullable) vs. "no tocarlo"
    // (Zod ni siquiera incluye la key cuando el cliente no la manda).
    const next = { ...existing, ...parsed.data };

    if (next.max_monthly_volume_clp != null && next.max_monthly_volume_clp <= next.min_monthly_volume_clp) {
      return res.status(400).json({ ok: false, error: "max_monthly_volume_clp debe ser mayor a min_monthly_volume_clp" });
    }

    if (next.is_active) {
      const overlap = await findOverlappingTier(pool, {
        min: next.min_monthly_volume_clp,
        max: next.max_monthly_volume_clp,
        excludeId: id,
      });
      if (overlap) {
        return res.status(409).json({ ok: false, error: `El rango se superpone con el tier activo "${overlap.label}"` });
      }
    }

    const r = await pool.query(
      `UPDATE platform_fee_tiers
       SET label=$1, min_monthly_volume_clp=$2, max_monthly_volume_clp=$3,
           fee_per_transaction_clp=$4, is_active=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING ${TIER_COLUMNS}`,
      [next.label, next.min_monthly_volume_clp, next.max_monthly_volume_clp, next.fee_per_transaction_clp, next.is_active, id]
    );

    return res.json({ ok: true, tier: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * DELETE /admin/platform-fees/tiers/:id
 * Soft-delete (is_active=false) — nunca hard-delete, preserva la FK desde
 * el ledger y el historial de auditoría.
 */
router.delete("/tiers/:id", validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `UPDATE platform_fee_tiers SET is_active=false, updated_at=NOW()
       WHERE id=$1
       RETURNING ${TIER_COLUMNS}`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Tier no encontrado" });
    return res.json({ ok: true, tier: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

const CHARGE_COLUMNS = `id, order_id, order_no, order_code, order_total_clp,
                         tier_id, tier_label_snapshot, fee_applied_clp, is_fallback,
                         period_month, monthly_volume_at_charge_clp, monthly_txn_ordinal,
                         source_status, charged_at, reversed_at, reversed_reason`;

/**
 * GET /admin/platform-fees/charges?from&to&tier_id&is_fallback&page&limit
 * Ledger paginado — fuente de la "Lista de cobro".
 */
router.get("/charges", async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const tierId = String(req.query.tier_id || "").trim();
  const isFallbackParam = req.query.is_fallback;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  try {
    const pool = getPool();
    const where = [];
    const vals = [];
    let n = 1;

    if (from) { where.push(`charged_at >= $${n++}::timestamptz`); vals.push(from); }
    if (to) { where.push(`charged_at < $${n++}::timestamptz`); vals.push(to); }
    if (tierId) { where.push(`tier_id = $${n++}::uuid`); vals.push(tierId); }
    if (isFallbackParam === "true" || isFallbackParam === "false") {
      where.push(`is_fallback = $${n++}`);
      vals.push(isFallbackParam === "true");
    }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const countR = await pool.query(`SELECT COUNT(*)::int AS total FROM platform_fee_charges ${whereSql}`, vals);
    const total = countR.rows[0].total;

    const itemsR = await pool.query(
      `SELECT ${CHARGE_COLUMNS}
       FROM platform_fee_charges
       ${whereSql}
       ORDER BY charged_at DESC
       LIMIT $${n++} OFFSET $${n++}`,
      [...vals, limit, offset]
    );

    return res.json({
      ok: true,
      items: itemsR.rows,
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * GET /admin/platform-fees/dashboard
 * Totales de hoy/mes, tier vigente y alerta de cobros de respaldo.
 * Copy pensado como "conteo de transacciones + tarifa vigente", nunca como
 * reporte de ingresos del cliente.
 */
router.get("/dashboard", async (req, res) => {
  try {
    const pool = getPool();

    const todayR = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(fee_applied_clp),0)::bigint AS total_fees_clp
       FROM platform_fee_charges
       WHERE charged_at >= (date_trunc('day', NOW() AT TIME ZONE $1) AT TIME ZONE $1)`,
      [TIMEZONE]
    );

    const monthR = await pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(fee_applied_clp),0)::bigint AS total_fees_clp,
              COALESCE(SUM(order_total_clp),0)::bigint AS volume_clp
       FROM platform_fee_charges
       WHERE period_month = date_trunc('month', NOW() AT TIME ZONE $1)::date`,
      [TIMEZONE]
    );

    const fallbackR = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(fee_applied_clp),0)::bigint AS total_fees_clp
       FROM platform_fee_charges
       WHERE is_fallback = true
         AND period_month = date_trunc('month', NOW() AT TIME ZONE $1)::date`,
      [TIMEZONE]
    );

    // Tier vigente = el que le tocaría a la PRÓXIMA orden ahora mismo, dado
    // el volumen acumulado del mes hasta este instante.
    const volumeSoFar = Number(monthR.rows[0].volume_clp);
    const currentTierR = await pool.query(
      `SELECT id, label, min_monthly_volume_clp, max_monthly_volume_clp, fee_per_transaction_clp
       FROM platform_fee_tiers
       WHERE is_active = true
         AND min_monthly_volume_clp <= $1
         AND (max_monthly_volume_clp IS NULL OR $1 < max_monthly_volume_clp)
       ORDER BY min_monthly_volume_clp DESC
       LIMIT 1`,
      [volumeSoFar]
    );

    return res.json({
      ok: true,
      today: {
        count: todayR.rows[0].count,
        total_fees_clp: Number(todayR.rows[0].total_fees_clp),
      },
      this_month: {
        count: monthR.rows[0].count,
        total_fees_clp: Number(monthR.rows[0].total_fees_clp),
        volume_clp: volumeSoFar,
      },
      current_tier: currentTierR.rowCount > 0 ? currentTierR.rows[0] : null,
      fallback_alert: {
        count: fallbackR.rows[0].count,
        total_fees_clp: Number(fallbackR.rows[0].total_fees_clp),
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * GET /admin/platform-fees/reconciliation?from&to
 * Cruza orders DELIVERED contra platform_fee_charges: detecta huecos
 * (órdenes cerradas que, por algún motivo, no tienen cobro asociado — p.ej.
 * una escritura directa a la BD que bypaseó los endpoints con el hook).
 * También sirve como "lista de órdenes por fecha", no solo lo cobrado.
 */
router.get("/reconciliation", async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  try {
    const pool = getPool();
    const where = [`o.status = 'DELIVERED'`];
    const vals = [];
    let n = 1;

    if (from) { where.push(`o.created_at >= $${n++}::timestamptz`); vals.push(from); }
    if (to) { where.push(`o.created_at < $${n++}::timestamptz`); vals.push(to); }

    const r = await pool.query(
      `SELECT o.id AS order_id, o.order_no, o.order_code, o.total_clp, o.created_at,
              c.id AS charge_id, c.fee_applied_clp, c.charged_at,
              (c.id IS NULL) AS is_gap
       FROM orders o
       LEFT JOIN platform_fee_charges c ON c.order_id = o.id
       WHERE ${where.join(" AND ")}
       ORDER BY o.created_at DESC
       LIMIT 1000`,
      vals
    );

    const gapCount = r.rows.reduce((acc, row) => acc + (row.is_gap ? 1 : 0), 0);

    return res.json({ ok: true, items: r.rows, total: r.rowCount, gap_count: gapCount });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
