const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

function normalizeString(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ===== PROVIDERS (Proveedores) =====

router.get(["", "/"], requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const search = String(req.query.q || "").trim();
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, name, created_at
       FROM providers
       ${search ? "WHERE name ILIKE $1" : ""}
       ORDER BY name ASC`,
      search ? [`%${search}%`] : []
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();

    const normalizedName = normalizeString(parsed.data.name);
    const allProviders = await pool.query("SELECT name FROM providers");
    const duplicate = allProviders.rows.find((p) => normalizeString(p.name) === normalizedName);
    if (duplicate) {
      return res.status(409).json({ ok: false, error: `Ya existe un proveedor con el nombre "${duplicate.name}"` });
    }

    const r = await pool.query(
      `INSERT INTO providers (id, name) VALUES ($1, $2) RETURNING *`,
      [crypto.randomUUID(), parsed.data.name]
    );
    res.json({ ok: true, provider: r.rows[0] });
  } catch (e) {
    if (e?.code === "23505") {
      return res.status(409).json({ ok: false, error: "Ya existe un proveedor con ese nombre" });
    }
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();

    const used = await pool.query("SELECT 1 FROM expense_records WHERE provider_id=$1 LIMIT 1", [req.params.id]);
    if (used.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "No se puede eliminar un proveedor con gastos asociados" });
    }

    const r = await pool.query("DELETE FROM providers WHERE id=$1 RETURNING id", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Proveedor no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
