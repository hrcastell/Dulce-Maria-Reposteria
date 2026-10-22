const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const path = require("path");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { validationError, sendError } = require("../lib/httpErrors");
const {
  UPLOADS_DIR,
  createImageUpload,
  removeUploadedFiles,
  deleteUploadByUrl,
} = require("../lib/uploads");

const router = express.Router();

// ===== Upload config for Hero =====
// El nombre y la extensión los decide el servidor según el contenido real
// (JPEG/PNG/WebP); nunca se usa el nombre que manda el cliente.
const uploadHeroImage = createImageUpload({
  field: "image",
  maxFiles: 1,
  maxFileSizeMb: 5,
  directory: () => path.join(UPLOADS_DIR, "hero"),
  filenamePrefix: "hero_",
});

// Largos según las columnas VARCHAR de hero_slides.
const isActiveField = (fallback) =>
  z.preprocess((val) => (val === undefined ? fallback : val === "true" || val === true), z.boolean());
const heroTextFields = {
  title: z.string().max(200).optional(),
  subtitle: z.string().max(300).optional(),
  button_text: z.string().max(100).optional(),
  button_link: z.string().max(300).optional(),
};

/** 404 antes de procesar el multipart: no se escriben archivos para slides inexistentes. */
async function ensureSlideExists(req, res, next) {
  try {
    const r = await getPool().query("SELECT 1 FROM hero_slides WHERE id=$1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Slide no encontrado" });
    return next();
  } catch (e) {
    return sendError(res, e);
  }
}

// GET /admin/hero - List all slides
router.get("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, title, subtitle, button_text, button_link, image_url, is_active, sort_order, created_at
       FROM hero_slides
       ORDER BY sort_order ASC, created_at DESC`
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    return sendError(res, e);
  }
});

// POST /admin/hero - Create slide
router.post("/", requireRole("SUPERADMIN", "ADMIN"), uploadHeroImage, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Imagen requerida" });
    }

    const schema = z.object({ ...heroTextFields, is_active: isActiveField(true) });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      await removeUploadedFiles(req);
      return validationError(res, parsed.error);
    }

    const { title, subtitle, button_text, button_link, is_active } = parsed.data;
    const imageUrl = `/uploads/hero/${req.file.filename}`;
    const id = crypto.randomUUID();

    const pool = getPool();

    // Get max sort_order
    const c = await pool.query("SELECT MAX(sort_order) as max_order FROM hero_slides");
    const nextOrder = (c.rows[0].max_order || 0) + 1;

    await pool.query(
      `INSERT INTO hero_slides (id, title, subtitle, button_text, button_link, image_url, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, title || null, subtitle || null, button_text || null, button_link || null, imageUrl, is_active, nextOrder]
    );

    res.json({ ok: true, slide: { id, title, subtitle, button_text, button_link, image_url: imageUrl, is_active, sort_order: nextOrder } });

  } catch (e) {
    await removeUploadedFiles(req);
    return sendError(res, e);
  }
});

// PATCH /admin/hero/:id - Update slide
router.patch(
  "/:id",
  requireRole("SUPERADMIN", "ADMIN"),
  validateUuidParam("id"),
  ensureSlideExists,
  uploadHeroImage,
  async (req, res) => {
    const { id } = req.params;

    try {
      const pool = getPool();
      const existing = await pool.query("SELECT image_url FROM hero_slides WHERE id=$1", [id]);
      if (existing.rowCount === 0) {
        await removeUploadedFiles(req);
        return res.status(404).json({ ok: false, error: "Slide no encontrado" });
      }

      const schema = z.object({ ...heroTextFields, is_active: isActiveField(undefined).optional() });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        await removeUploadedFiles(req);
        return validationError(res, parsed.error);
      }

      const fields = [];
      const values = [];
      let n = 1;
      const d = parsed.data;

      if (d.title !== undefined) { fields.push(`title=$${n++}`); values.push(d.title || null); }
      if (d.subtitle !== undefined) { fields.push(`subtitle=$${n++}`); values.push(d.subtitle || null); }
      if (d.button_text !== undefined) { fields.push(`button_text=$${n++}`); values.push(d.button_text || null); }
      if (d.button_link !== undefined) { fields.push(`button_link=$${n++}`); values.push(d.button_link || null); }
      if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }

      let newImageUrl = null;
      if (req.file) {
        newImageUrl = `/uploads/hero/${req.file.filename}`;
        fields.push(`image_url=$${n++}`);
        values.push(newImageUrl);
      }

      if (fields.length === 0) return res.status(400).json({ ok: false, error: "Nada que actualizar" });

      fields.push(`updated_at=NOW()`);
      values.push(id);

      await pool.query(
        `UPDATE hero_slides SET ${fields.join(", ")} WHERE id=$${n}`,
        values
      );

      // Delete old image if new one uploaded (solo rutas dentro de uploads/)
      if (newImageUrl && existing.rows[0].image_url) {
        await deleteUploadByUrl(existing.rows[0].image_url);
      }

      res.json({ ok: true, message: "Slide actualizado" });

    } catch (e) {
      await removeUploadedFiles(req);
      return sendError(res, e);
    }
  }
);

// DELETE /admin/hero/:id - Delete slide
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query("DELETE FROM hero_slides WHERE id=$1 RETURNING image_url", [id]);

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Slide no encontrado" });

    // Delete image file (solo rutas dentro de uploads/)
    const imageUrl = r.rows[0].image_url;
    if (imageUrl) await deleteUploadByUrl(imageUrl);

    res.json({ ok: true, message: "Slide eliminado" });
  } catch (e) {
    return sendError(res, e);
  }
});

// PATCH /admin/hero/:id/reorder - Update order
router.patch("/:id/reorder", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;
  const schema = z.object({ new_order: z.number().int().min(0).max(10000) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const pool = getPool();
    const r = await pool.query("UPDATE hero_slides SET sort_order=$1 WHERE id=$2", [parsed.data.new_order, id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Slide no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, e);
  }
});

module.exports = router;
