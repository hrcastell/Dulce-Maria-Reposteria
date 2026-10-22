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
const { validationError, sendError } = require("../lib/httpErrors");
const { isoDateOrDateTime, optionalQuery, optionalQueryNumber } = require("../lib/schemas");
const { resolveDateRangeFilter, buildTimestampRangeClauses } = require("../lib/santiagoTime");

const router = express.Router();

router.use(requirePlatformOwner);

// Volúmenes BIGINT: se aceptan hasta el máximo entero seguro de JavaScript.
const MAX_VOLUME_CLP = Number.MAX_SAFE_INTEGER;
// fee_per_transaction_clp / fee_applied_clp son INT: tope holgado y razonable.
const MAX_FEE_CLP = 1000000;

/**
 * GET /admin/platform-fees/config
 * Tarifa de respaldo (system_config.platform_fee_default_clp) que el motor
 * aplica cuando ningún tier cubre el volumen del mes. Exclusivo del dueño de
 * la plataforma: el endpoint genérico /admin/config ya no expone estas claves.
 */
router.get("/config", async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT key, value, updated_at FROM system_config
       WHERE key IN ('platform_fee_default_clp', 'platform_fee_engine_activated_at')`
    );
    const byKey = new Map(r.rows.map((row) => [row.key, row]));
    const fallback = byKey.get("platform_fee_default_clp");
    return res.json({
      ok: true,
      config: {
        default_fee_clp: fallback ? Number(fallback.value) : null,
        default_fee_updated_at: fallback ? fallback.updated_at : null,
        engine_activated_at: byKey.get("platform_fee_engine_activated_at")?.value ?? null,
      },
    });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * PUT /admin/platform-fees/config  { default_fee_clp }
 */
router.put("/config", async (req, res) => {
  const schema = z.object({ default_fee_clp: z.number().int().min(0).max(MAX_FEE_CLP) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ('platform_fee_default_clp', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [String(parsed.data.default_fee_clp)]
    );
    return res.json({ ok: true, config: { default_fee_clp: parsed.data.default_fee_clp } });
  } catch (e) {
    return sendError(res, e);
  }
});

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
  label: z.string().trim().min(1).max(100),
  min_monthly_volume_clp: z.number().int().nonnegative().max(MAX_VOLUME_CLP),
  max_monthly_volume_clp: z.number().int().positive().max(MAX_VOLUME_CLP).nullable().optional(),
  fee_per_transaction_clp: z.number().int().nonnegative().max(MAX_FEE_CLP),
  is_active: z.boolean().optional().default(true),
});

/**
 * POST /admin/platform-fees/tiers
 * Crea un tier. 409 si el rango se solapa con un tier activo existente.
 */
router.post("/tiers", async (req, res) => {
  const parsed = tierCreateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

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
  label: z.string().trim().min(1).max(100).optional(),
  min_monthly_volume_clp: z.number().int().nonnegative().max(MAX_VOLUME_CLP).optional(),
  max_monthly_volume_clp: z.number().int().positive().max(MAX_VOLUME_CLP).nullable().optional(),
  fee_per_transaction_clp: z.number().int().nonnegative().max(MAX_FEE_CLP).optional(),
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
  if (!parsed.success) return validationError(res, parsed.error);
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
    // Los BIGINT guardados se comparan como números (B-28): entre strings,
    // "2000000" <= "900000" es verdadero.
    const next = {
      ...existing,
      min_monthly_volume_clp: Number(existing.min_monthly_volume_clp),
      max_monthly_volume_clp: existing.max_monthly_volume_clp == null ? null : Number(existing.max_monthly_volume_clp),
      ...parsed.data,
    };

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
const chargesQuerySchema = z.object({
  from: optionalQuery(isoDateOrDateTime),
  to: optionalQuery(isoDateOrDateTime),
  tier_id: optionalQuery(z.string().uuid()),
  is_fallback: optionalQuery(z.enum(["true", "false"])),
  page: optionalQueryNumber({ min: 1, max: 100000, int: true }),
  limit: optionalQueryNumber({ min: 1, max: 200, int: true }),
});

router.get("/charges", async (req, res) => {
  const query = chargesQuerySchema.safeParse(req.query);
  if (!query.success) return validationError(res, query.error);
  const from = query.data.from || "";
  const to = query.data.to || "";
  const tierId = query.data.tier_id || "";
  const isFallbackParam = query.data.is_fallback;
  const page = query.data.page || 1;
  const limit = query.data.limit || 50;
  const offset = (page - 1) * limit;

  try {
    const pool = getPool();
    // Fechas AAAA-MM-DD = días de Santiago y el "hasta" incluye ese día (C-12);
    // un instante ISO se respeta tal cual (fin exclusivo).
    const range = buildTimestampRangeClauses("charged_at", resolveDateRangeFilter({ from, to }), 1);
    const where = [...range.clauses];
    const vals = [...range.values];
    let n = vals.length + 1;

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
const reconciliationQuerySchema = z.object({
  from: optionalQuery(isoDateOrDateTime),
  to: optionalQuery(isoDateOrDateTime),
});

router.get("/reconciliation", async (req, res) => {
  const query = reconciliationQuerySchema.safeParse(req.query);
  if (!query.success) return validationError(res, query.error);
  const from = query.data.from || "";
  const to = query.data.to || "";

  try {
    const pool = getPool();
    const range = buildTimestampRangeClauses("o.created_at", resolveDateRangeFilter({ from, to }), 1);
    const where = [`o.status = 'DELIVERED'`, ...range.clauses];
    const vals = [...range.values];

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
