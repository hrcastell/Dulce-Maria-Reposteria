const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

// ===== KITCHEN EQUIPMENT (hornos, etc. — para el costo de energía de una receta) =====

router.get(["", "/"], requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, name, energy_type, consumption_rate, consumption_unit, is_active
       FROM kitchen_equipment
       WHERE is_active = true
       ORDER BY name ASC`
    );
    const items = r.rows.map((row) => ({ ...row, consumption_rate: Number(row.consumption_rate) }));
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(150),
    energy_type: z.enum(["ELECTRIC", "GAS"]),
    consumption_rate: z.number().nonnegative(),
    consumption_unit: z.string().min(1).max(30),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    const d = parsed.data;
    const r = await pool.query(
      `INSERT INTO kitchen_equipment (id, name, energy_type, consumption_rate, consumption_unit)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [crypto.randomUUID(), d.name, d.energy_type, d.consumption_rate, d.consumption_unit]
    );
    const equipment = { ...r.rows[0], consumption_rate: Number(r.rows[0].consumption_rate) };
    res.json({ ok: true, equipment });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const used = await pool.query("SELECT 1 FROM recipes WHERE equipment_id=$1 LIMIT 1", [req.params.id]);
    if (used.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "No se puede eliminar un equipo usado en recetas" });
    }
    const r = await pool.query("DELETE FROM kitchen_equipment WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Equipo no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
