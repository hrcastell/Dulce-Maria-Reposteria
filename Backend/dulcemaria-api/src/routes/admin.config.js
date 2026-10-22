const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { canAccessBakeryConfig, parseBakeryConfigValue } = require("../lib/systemConfig");
const { validationError, sendError } = require("../lib/httpErrors");

const router = express.Router();

// Solo claves de la panadería (lib/systemConfig.js). Las claves del Motor de
// Tarifa (platform_fee_*) y cualquier otra responden 404 aquí; el dueño de la
// plataforma las administra en /admin/platform-fees/config.
const NOT_FOUND = { ok: false, error: "Configuración no encontrada." };

/**
 * GET /admin/config/:key
 * Obtiene el valor de una configuración
 */
router.get("/:key", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const { key } = req.params;
  if (!canAccessBakeryConfig(key, req.user.role, "read")) return res.status(404).json(NOT_FOUND);
  try {
    const pool = getPool();
    const r = await pool.query("SELECT value FROM system_config WHERE key=$1 LIMIT 1", [key]);
    if (r.rowCount === 0) return res.status(404).json(NOT_FOUND);
    res.json({ ok: true, value: r.rows[0].value });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * PUT /admin/config/:key
 * Actualiza o crea una configuración (solo claves permitidas, con valor validado)
 */
router.put("/:key", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const { key } = req.params;
  if (!canAccessBakeryConfig(key, req.user.role, "write")) return res.status(404).json(NOT_FOUND);

  const schema = z.object({ value: z.union([z.string().max(32), z.number()]) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const value = parseBakeryConfigValue(key, parsed.data.value);
  if (!value.ok) return res.status(400).json({ ok: false, error: value.error });

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, value.value]
    );
    res.json({ ok: true, key, value: value.value });
  } catch (e) {
    return sendError(res, e);
  }
});

module.exports = router;
