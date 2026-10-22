const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const { getPool } = require("../db");
const { hashPassword } = require("../utils/password");
const { requireRole, requirePlatformOwner } = require("../middleware/auth");
const { isPlatformOwner } = require("../lib/platformOwner");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { shouldRevokeSessions } = require("../lib/sessions");
const { validationError } = require("../lib/httpErrors");
const { resolveEffectivePermissions, summarizePermissions, decideRoleUpdate } = require("../lib/permissions");

const router = express.Router();

/**
 * Fila de users → lo que muestra la pantalla de usuarios: `permissions` es la
 * matriz EFECTIVA (lo que realmente se aplica, ver lib/permissions.js) y las
 * banderas planas can_view/can_create/can_edit/can_delete que lee la tabla.
 * `permissions_configured` = la matriz guardada ya rige (se guardó desde esta
 * versión); si es false, valen los permisos del rol.
 */
function presentUser(row) {
  const effective = resolveEffectivePermissions(row);
  const { permissions_configured_at: configuredAt, ...rest } = row;
  return {
    ...rest,
    permissions: effective,
    permissions_configured: configuredAt !== null && configuredAt !== undefined,
    ...summarizePermissions(effective),
  };
}

// Solo el dueño de la plataforma (PLATFORM_OWNER_EMAIL) puede crear/modificar usuarios.
router.post("/", requireRole("SUPERADMIN"), requirePlatformOwner, async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(200),
    fullName: z.string().min(1).max(200).optional(),
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
  if (!parsed.success) return validationError(res, parsed.error);

  const { email, password, fullName, role, isActive, permissions } = parsed.data;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT 1 FROM users WHERE email=$1 LIMIT 1", [email.toLowerCase()]);
    if (exists.rowCount > 0) return res.status(409).json({ ok: false, error: "Ese email ya existe" });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    // Con `permissions` la matriz rige desde ya (permissions_configured_at);
    // sin ella se guarda vacía y valen los permisos del rol.
    const storedPermissions = permissions || {};

    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, is_active, permissions, permissions_configured_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [id, email.toLowerCase(), passwordHash, fullName ?? null, role, isActive, JSON.stringify(storedPermissions), permissions ? new Date() : null]
    );

    const user = presentUser({ id, email: email.toLowerCase(), role, permissions: storedPermissions, permissions_configured_at: permissions ? new Date() : null });
    return res.json({ ok: true, user: { ...user, isActive } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Listar usuarios (SUPERADMIN/ADMIN)
router.get("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, full_name, role, is_active, permissions, permissions_configured_at, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    return res.json({ ok: true, items: r.rows.map(presentUser) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Actualizar usuario
router.patch("/:id", requireRole("SUPERADMIN"), requirePlatformOwner, validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;

  const schema = z.object({
    fullName: z.string().min(1).max(200).optional(),
    // SUPERADMIN se acepta solo si ya es el rol del usuario (el formulario lo
    // reenvía tal cual): nunca se asciende a nadie a SUPERADMIN (decideRoleUpdate).
    role: z.enum(["SUPERADMIN", "ADMIN", "STAFF"]).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(12).max(200).optional(),
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
  if (!parsed.success) return validationError(res, parsed.error);

  const { fullName, role, isActive, password, permissions } = parsed.data;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT email, role, is_active FROM users WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Usuario no encontrado" });

    // No permitir modificar al SUPERADMIN principal
    if (isPlatformOwner(exists.rows[0].email)) {
      return res.status(403).json({ ok: false, error: "No se puede modificar el administrador principal" });
    }

    const roleDecision = decideRoleUpdate({ currentRole: exists.rows[0].role, requestedRole: role });
    if (!roleDecision.ok) {
      return res.status(roleDecision.status).json({ ok: false, error: roleDecision.error, code: roleDecision.code });
    }
    const newRole = roleDecision.change ? roleDecision.role : undefined;

    const fields = [];
    const values = [];
    let n = 1;

    if (fullName !== undefined) { fields.push(`full_name=$${n}`); values.push(fullName); n++; }
    if (newRole !== undefined) { fields.push(`role=$${n}`); values.push(newRole); n++; }
    if (isActive !== undefined) { fields.push(`is_active=$${n}`); values.push(isActive); n++; }
    if (permissions !== undefined) {
      // Desde que se guarda con esta versión, la matriz rige (requirePermission).
      fields.push(`permissions=$${n}`); values.push(JSON.stringify(permissions)); n++;
      fields.push(`permissions_configured_at=NOW()`);
    }
    
    if (password !== undefined) {
      const passwordHash = await hashPassword(password);
      fields.push(`password_hash=$${n}`);
      values.push(passwordHash);
      n++;
    }

    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay campos para actualizar" });
    }

    // Contraseña, rol o estado distintos: se cierran todas las sesiones
    // abiertas de ese usuario (el claim `sv` de sus cookies deja de coincidir).
    if (shouldRevokeSessions(exists.rows[0], { password, role: newRole, isActive })) {
      fields.push(`session_version = session_version + 1`);
    }

    fields.push(`updated_at=NOW()`);
    values.push(id);

    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id=$${n}`,
      values
    );

    const r = await pool.query(
      `SELECT id, email, full_name, role, is_active, permissions, permissions_configured_at, created_at, updated_at
       FROM users WHERE id=$1 LIMIT 1`,
      [id]
    );

    return res.json({ ok: true, user: presentUser(r.rows[0]) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// Eliminar usuario
router.delete("/:id", requireRole("SUPERADMIN"), requirePlatformOwner, validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;

  try {
    const pool = getPool();

    const exists = await pool.query("SELECT email FROM users WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Usuario no encontrado" });

    // No permitir eliminar al SUPERADMIN principal
    if (isPlatformOwner(exists.rows[0].email)) {
      return res.status(403).json({ ok: false, error: "No se puede eliminar el administrador principal" });
    }

    await pool.query("DELETE FROM users WHERE id=$1", [id]);

    return res.json({ ok: true, message: "Usuario eliminado", userId: id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
