const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { hashPassword } = require("../utils/password");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

const SUPER_ADMIN_EMAIL = "hernan.castellanos@hrcastell.com";

// Middleware para verificar que solo el SUPERADMIN específico puede crear/modificar usuarios
const requireSuperAdmin = (req, res, next) => {
  if (req.user.email !== SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: "Solo el administrador principal puede gestionar usuarios" });
  }
  next();
};

// Solo hernan.castellanos@hrcastell.com puede crear usuarios
router.post("/", requireRole("SUPERADMIN"), requireSuperAdmin, async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(1).optional(),
    role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
    isActive: z.boolean().default(true),
    permissions: z.object({
      products: z.object({
        canCreate: z.boolean().default(false),
        canEdit: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        canView: z.boolean().default(true)
      }).optional(),
      customers: z.object({
        canCreate: z.boolean().default(false),
        canEdit: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        canView: z.boolean().default(true)
      }).optional(),
      orders: z.object({
        canCreate: z.boolean().default(true),
        canEdit: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        canView: z.boolean().default(true),
        canUpdateStatus: z.boolean().default(false)
      }).optional()
    }).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { email, password, fullName, role, isActive, permissions } = parsed.data;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT 1 FROM users WHERE email=$1 LIMIT 1", [email.toLowerCase()]);
    if (exists.rowCount > 0) return res.status(409).json({ ok: false, error: "Ese email ya existe" });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    const defaultPermissions = {
      products: { canCreate: false, canEdit: false, canDelete: false, canView: true },
      customers: { canCreate: false, canEdit: false, canDelete: false, canView: true },
      orders: { canCreate: true, canEdit: false, canDelete: false, canView: true, canUpdateStatus: false }
    };

    const finalPermissions = permissions || defaultPermissions;

    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, is_active, permissions, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [id, email.toLowerCase(), passwordHash, fullName ?? null, role, isActive, JSON.stringify(finalPermissions)]
    );

    return res.json({ ok: true, user: { id, email: email.toLowerCase(), role, isActive, permissions: finalPermissions } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Listar usuarios (SUPERADMIN/ADMIN)
router.get("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, full_name, role, is_active, permissions, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Actualizar usuario
router.patch("/:id", requireRole("SUPERADMIN"), requireSuperAdmin, validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;

  const schema = z.object({
    fullName: z.string().min(1).optional(),
    role: z.enum(["ADMIN", "STAFF"]).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).optional(),
    permissions: z.object({
      products: z.object({
        canCreate: z.boolean(),
        canEdit: z.boolean(),
        canDelete: z.boolean(),
        canView: z.boolean()
      }).optional(),
      customers: z.object({
        canCreate: z.boolean(),
        canEdit: z.boolean(),
        canDelete: z.boolean(),
        canView: z.boolean()
      }).optional(),
      orders: z.object({
        canCreate: z.boolean(),
        canEdit: z.boolean(),
        canDelete: z.boolean(),
        canView: z.boolean(),
        canUpdateStatus: z.boolean()
      }).optional()
    }).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { fullName, role, isActive, password, permissions } = parsed.data;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT email FROM users WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Usuario no encontrado" });

    // No permitir modificar al SUPERADMIN principal
    if (exists.rows[0].email === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: "No se puede modificar el administrador principal" });
    }

    const fields = [];
    const values = [];
    let n = 1;

    if (fullName !== undefined) { fields.push(`full_name=$${n}`); values.push(fullName); n++; }
    if (role !== undefined) { fields.push(`role=$${n}`); values.push(role); n++; }
    if (isActive !== undefined) { fields.push(`is_active=$${n}`); values.push(isActive); n++; }
    if (permissions !== undefined) { fields.push(`permissions=$${n}`); values.push(JSON.stringify(permissions)); n++; }
    
    if (password !== undefined) {
      const passwordHash = await hashPassword(password);
      fields.push(`password_hash=$${n}`);
      values.push(passwordHash);
      n++;
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    fields.push(`updated_at=NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id=$${n}`,
      values
    );

    const r = await pool.query(
      `SELECT id, email, full_name, role, is_active, permissions, created_at, updated_at
       FROM users WHERE id=$1 LIMIT 1`,
      [id]
    );

    return res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Eliminar usuario
router.delete("/:id", requireRole("SUPERADMIN"), requireSuperAdmin, validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT email FROM users WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Usuario no encontrado" });

    // No permitir eliminar al SUPERADMIN principal
    if (exists.rows[0].email === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: "No se puede eliminar el administrador principal" });
    }

    await pool.query("DELETE FROM users WHERE id=$1", [id]);

    return res.json({ ok: true, message: "Usuario eliminado", userId: id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;