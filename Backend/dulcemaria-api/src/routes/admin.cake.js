const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const path = require("path");

const { getPool, withTransaction } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { validationError, sendError, appError } = require("../lib/httpErrors");
const { clpAmount, optionalQuery } = require("../lib/schemas");
const { CAKE_ORDER_STATUSES, decideCakeStatusChange, describeCakeOrderVocabulary } = require("../lib/cakeOrderStatus");
const { recordOrderEvent } = require("../lib/orderEvents");
const { cakePaymentSummary } = require("../lib/payments/cakePayments");
const {
  UPLOADS_DIR,
  createImageUpload,
  removeUploadedFiles,
  deleteUploadByUrl,
} = require("../lib/uploads");

const router = express.Router();

// ===== Upload config for cake theme images =====
// Tipo verificado por contenido y nombre generado por el servidor (lib/uploads.js).
// req.params.id ya pasó validateUuidParam: no puede salir de uploads/cake-themes/.
const cakeThemeUpload = createImageUpload({
  field: "image",
  maxFiles: 1,
  maxFileSizeMb: 5,
  directory: (req) => path.join(UPLOADS_DIR, "cake-themes", req.params.id),
  filenamePrefix: "theme_",
});

/** 404 antes de procesar el multipart: no se crean carpetas para opciones inexistentes. */
async function ensureOptionExists(req, res, next) {
  try {
    const r = await getPool().query("SELECT 1 FROM cake_config_option WHERE id=$1 LIMIT 1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Opción no existe" });
    return next();
  } catch (e) {
    return sendError(res, e);
  }
}

const sortOrder = () => z.number().int().min(-10000).max(10000);

// ===== CONFIG =====

router.get("/config", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  try {
    const pool = getPool();
    const cats = await pool.query(
      `SELECT id, type, label, sort_order, is_active FROM cake_config_category ORDER BY sort_order ASC`
    );
    const opts = await pool.query(
      `SELECT id, category_id, label, description, extra_price_clp, is_default, diameter_cm, image_url, is_active, sort_order
       FROM cake_config_option ORDER BY category_id, sort_order ASC`
    );
    const byCategory = {};
    for (const o of opts.rows) {
      if (!byCategory[o.category_id]) byCategory[o.category_id] = [];
      byCategory[o.category_id].push(o);
    }
    const result = cats.rows.map(c => ({ ...c, options: byCategory[c.id] || [] }));
    // Vocabulario único de estados de torta (el que deben ofrecer las pantallas).
    res.json({ ok: true, categories: result, ...describeCakeOrderVocabulary() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/config/categories/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    label: z.string().min(1).max(100).optional(),
    sort_order: sortOrder().optional(),
    is_active: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const fields = [], values = [];
  let n = 1;
  const d = parsed.data;
  if (d.label !== undefined) { fields.push(`label=$${n++}`); values.push(d.label); }
  if (d.sort_order !== undefined) { fields.push(`sort_order=$${n++}`); values.push(d.sort_order); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }
  if (!fields.length) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  values.push(req.params.id);

  try {
    const pool = getPool();
    const r = await pool.query(`UPDATE cake_config_category SET ${fields.join(",")} WHERE id=$${n} RETURNING *`, values);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Categoría no encontrada" });
    res.json({ ok: true, category: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/config/options", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    category_id: z.string().uuid(),
    label: z.string().min(1).max(100),
    description: z.string().max(300).optional().nullable(),
    extra_price_clp: clpAmount().default(0),
    is_default: z.boolean().default(false),
    diameter_cm: z.number().int().positive().max(1000).optional().nullable(),
    image_url: z.string().max(500).optional().nullable(),
    sort_order: sortOrder().default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const pool = getPool();
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO cake_config_option (id, category_id, label, description, extra_price_clp, is_default, diameter_cm, image_url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [crypto.randomUUID(), d.category_id, d.label, d.description ?? null, d.extra_price_clp, d.is_default, d.diameter_cm ?? null, d.image_url ?? null, d.sort_order]
    );
    res.json({ ok: true, option: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/config/options/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    label: z.string().min(1).max(100).optional(),
    description: z.string().max(300).optional().nullable(),
    extra_price_clp: clpAmount().optional(),
    is_default: z.boolean().optional(),
    diameter_cm: z.number().int().positive().max(1000).optional().nullable(),
    image_url: z.string().max(500).optional().nullable(),
    is_active: z.boolean().optional(),
    sort_order: sortOrder().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const fields = [], values = [];
  let n = 1;
  const d = parsed.data;
  if (d.label !== undefined) { fields.push(`label=$${n++}`); values.push(d.label); }
  if ("description" in d) { fields.push(`description=$${n++}`); values.push(d.description ?? null); }
  if (d.extra_price_clp !== undefined) { fields.push(`extra_price_clp=$${n++}`); values.push(d.extra_price_clp); }
  if (d.is_default !== undefined) { fields.push(`is_default=$${n++}`); values.push(d.is_default); }
  if ("diameter_cm" in d) { fields.push(`diameter_cm=$${n++}`); values.push(d.diameter_cm ?? null); }
  if ("image_url" in d) { fields.push(`image_url=$${n++}`); values.push(d.image_url ?? null); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }
  if (d.sort_order !== undefined) { fields.push(`sort_order=$${n++}`); values.push(d.sort_order); }
  if (!fields.length) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  values.push(req.params.id);

  try {
    const pool = getPool();
    const r = await pool.query(`UPDATE cake_config_option SET ${fields.join(",")} WHERE id=$${n} RETURNING *`, values);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Opción no encontrada" });
    res.json({ ok: true, option: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/config/options/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    // Los pedidos de torta guardan qué opción se eligió (FK RESTRICT): una
    // opción ya usada no se borra, se desactiva (B-32).
    const used = await pool.query(
      `SELECT 1 FROM cake_orders
       WHERE $1 IN (size_option_id, layers_option_id, sponge_option_id, filling_option_id, decoration_option_id, theme_option_id)
       LIMIT 1`,
      [req.params.id]
    );
    if (used.rowCount > 0) {
      return res.status(409).json({
        ok: false,
        code: "OPTION_IN_USE",
        error: "Esta opción ya se usó en pedidos de torta: desactívala en vez de eliminarla.",
      });
    }
    const r = await pool.query("DELETE FROM cake_config_option WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Opción no encontrada" });
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, e);
  }
});

// ===== ORDERS =====

const cakeOrdersQuerySchema = z.object({ status: optionalQuery(z.enum(CAKE_ORDER_STATUSES)) });

router.get("/orders", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const query = cakeOrdersQuerySchema.safeParse(req.query);
  if (!query.success) return validationError(res, query.error);
  const status = query.data.status || "";
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, order_number, customer_name, customer_phone, customer_email, customer_address,
              total_price_clp, deposit_clp, status, created_at,
              residency_unit, residency_declared_at, delivery_date, notes,
              payment_method, payment_provider, payment_expires_at, cancellation_source,
              deposit_status, deposit_paid_at, deposit_payment_method,
              balance_status, balance_paid_at, balance_payment_method, balance_amount_clp,
              (public_token IS NOT NULL) AS has_payment_link
       FROM cake_orders
       ${status ? "WHERE status=$1" : ""}
       ORDER BY created_at DESC
       LIMIT 100`,
      status ? [status] : []
    );
    // payment_status derivado (PENDING | DEPOSIT_PAID | PAID | REFUNDED), balance_clp y amount_due_clp.
    const items = r.rows.map((row) => {
      const summary = cakePaymentSummary(row);
      return { ...row, payment_status: summary.payment_status, balance_clp: summary.balance_clp, amount_due_clp: summary.amount_due_clp };
    });
    res.json({ ok: true, items });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * PATCH /admin/cake/orders/:id/status  { status }
 * Transiciones de lib/cakeOrderStatus.js (409 si no se permite; repetir el
 * estado actual es un no-op), con evento de auditoría en la misma transacción.
 *
 * Motor de Tarifa (B-26): un pedido de torta DELIVERED NO genera tarifa de
 * plataforma. Es intencional y queda así hasta que el dueño de la plataforma
 * decida si las tortas se cobran (platform_fee_charges solo referencia orders).
 */
router.patch("/orders/:id/status", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({ status: z.enum(CAKE_ORDER_STATUSES) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const to = parsed.data.status;

  try {
    const result = await withTransaction(async (client) => {
      const current = await client.query("SELECT id, status, cancellation_source FROM cake_orders WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (current.rowCount === 0) throw appError(404, "ORDER_NOT_FOUND", "Pedido no encontrado");
      const cakeOrder = current.rows[0];

      const decision = decideCakeStatusChange(cakeOrder, to, { source: "ADMIN" });
      if (!decision.ok) throw appError(decision.httpStatus, decision.code, decision.error);
      if (decision.noop) {
        const same = await client.query("SELECT * FROM cake_orders WHERE id=$1", [cakeOrder.id]);
        return { order: same.rows[0], changed: false };
      }
      if (to === "CANCELLED") {
        // Orden de bloqueo: pedido → intentos de pago. Con un commit de Webpay en curso, no se cancela.
        const attempts = await client.query("SELECT status FROM payments WHERE cake_order_id=$1 FOR UPDATE", [cakeOrder.id]);
        if (attempts.rows.some((a) => a.status === "COMMITTING")) {
          throw appError(409, "PAYMENT_IN_PROGRESS", "Hay un pago en línea confirmándose en este momento; espera unos segundos y vuelve a intentar.");
        }
      }

      const r = await client.query(
        `UPDATE cake_orders
         SET status=$2,
             cancellation_source = CASE WHEN $4::text IS NOT NULL THEN $4::text WHEN $5::boolean THEN NULL ELSE cancellation_source END
         WHERE id=$1 AND status=$3 RETURNING *`,
        [cakeOrder.id, to, cakeOrder.status, decision.effects.cancellationSource, decision.effects.clearCancellationSource]
      );
      if (r.rowCount === 0) throw appError(409, "CONCURRENT_UPDATE", "El pedido cambió mientras se guardaba; recarga e intenta de nuevo.");
      await recordOrderEvent(client, {
        cakeOrderId: cakeOrder.id,
        type: "CAKE_STATUS_CHANGED",
        from: cakeOrder.status,
        to,
        actor: { sub: req.user?.sub, email: req.user?.email, role: req.user?.role },
        source: "ADMIN",
      });
      return { order: r.rows[0], changed: true };
    });
    // El token de acceso del cliente nunca viaja en las respuestas del panel (se pide en POST /admin/payments/links).
    const { public_token: publicToken, ...order } = result.order;
    res.json({ ok: true, noop: !result.changed, order: { ...order, has_payment_link: Boolean(publicToken) } });
  } catch (e) {
    return sendError(res, e);
  }
});

router.post(
  "/config/options/:id/image",
  requireRole("SUPERADMIN", "ADMIN"),
  validateUuidParam("id"),
  ensureOptionExists,
  cakeThemeUpload,
  async (req, res) => {
    const optionId = req.params.id;
    const file = req.file;

    try {
      if (!file) return res.status(400).json({ ok: false, error: "No se recibió archivo (field: image)" });

      const pool = getPool();
      const old = await pool.query("SELECT image_url FROM cake_config_option WHERE id=$1 LIMIT 1", [optionId]);
      if (old.rowCount === 0) {
        await removeUploadedFiles(req);
        return res.status(404).json({ ok: false, error: "Opción no existe" });
      }

      const relUrl = `/uploads/cake-themes/${optionId}/${file.filename}`;
      await pool.query(
        "UPDATE cake_config_option SET image_url=$1 WHERE id=$2",
        [relUrl, optionId]
      );

      // Recién ahora se borra la imagen anterior (solo rutas dentro de uploads/):
      // si el UPDATE fallara, la opción seguiría apuntando a un archivo existente.
      if (old.rows[0].image_url) await deleteUploadByUrl(old.rows[0].image_url);

      res.json({ ok: true, image_url: relUrl });
    } catch (e) {
      await removeUploadedFiles(req);
      return sendError(res, e);
    }
  }
);

router.delete(
  "/config/options/:id/image",
  requireRole("SUPERADMIN", "ADMIN"),
  validateUuidParam("id"),
  async (req, res) => {
    const optionId = req.params.id;
    try {
      const pool = getPool();
      const r = await pool.query("SELECT image_url FROM cake_config_option WHERE id=$1", [optionId]);
      if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Opción no encontrada" });

      await pool.query("UPDATE cake_config_option SET image_url=NULL WHERE id=$1", [optionId]);

      const imageUrl = r.rows[0].image_url;
      if (imageUrl) await deleteUploadByUrl(imageUrl);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
  }
);

module.exports = router;
