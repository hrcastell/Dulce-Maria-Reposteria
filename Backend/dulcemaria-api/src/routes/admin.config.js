const express = require("express");
const { z } = require("zod");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /admin/config/:key
 * Obtiene el valor de una configuración
 */
router.get("/:key", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const { key } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query("SELECT value FROM system_config WHERE key=$1 LIMIT 1", [key]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Config not found" });
    res.json({ ok: true, value: r.rows[0].value });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * PUT /admin/config/:key
 * Actualiza o crea una configuración
 */
router.put("/:key", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const { key } = req.params;
  const schema = z.object({ value: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, parsed.data.value]
    );
    res.json({ ok: true, key, value: parsed.data.value });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
