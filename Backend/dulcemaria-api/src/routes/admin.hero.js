const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");

const router = express.Router();

// ===== Upload config for Hero =====
const APP_ROOT = path.join(__dirname, "..", "..");
const UPLOADS_DIR = path.join(APP_ROOT, "uploads");
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const dir = path.join(UPLOADS_DIR, "hero");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    try {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      const name = `hero_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
      cb(null, name);
    } catch (e) {
      cb(e);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Formato no permitido. Usa JPG/PNG/WEBP."));
    }
    cb(null, true);
  },
});

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
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /admin/hero - Create slide
router.post("/", requireRole("SUPERADMIN", "ADMIN"), upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Imagen requerida" });
    }

    const schema = z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      button_text: z.string().optional(),
      button_link: z.string().optional(),
      is_active: z.preprocess((val) => val === 'true' || val === true, z.boolean().default(true)),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      // Cleanup file if validation fails
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
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
    // Cleanup file on error
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    next(e);
  }
});

// PATCH /admin/hero/:id - Update slide
router.patch("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), upload.single("image"), async (req, res, next) => {
  const { id } = req.params;
  
  try {
    const pool = getPool();
    const existing = await pool.query("SELECT image_url FROM hero_slides WHERE id=$1", [id]);
    if (existing.rowCount === 0) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(404).json({ ok: false, error: "Slide no encontrado" });
    }

    const schema = z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      button_text: z.string().optional(),
      button_link: z.string().optional(),
      is_active: z.preprocess((val) => val === 'true' || val === true, z.boolean().optional()),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
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

    // Delete old image if new one uploaded
    if (newImageUrl && existing.rows[0].image_url) {
      try {
        const oldPath = path.join(APP_ROOT, existing.rows[0].image_url.replace(/^\//, ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch {}
    }

    res.json({ ok: true, message: "Slide actualizado" });

  } catch (e) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    next(e);
  }
});

// DELETE /admin/hero/:id - Delete slide
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res, next) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query("DELETE FROM hero_slides WHERE id=$1 RETURNING image_url", [id]);
    
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Slide no encontrado" });

    // Delete image file
    const imageUrl = r.rows[0].image_url;
    if (imageUrl) {
      try {
        const filePath = path.join(APP_ROOT, imageUrl.replace(/^\//, ''));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }

    res.json({ ok: true, message: "Slide eliminado" });
  } catch (e) {
    next(e);
  }
});

// PATCH /admin/hero/:id/reorder - Update order
router.patch("/:id/reorder", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;
  const { new_order } = req.body;

  if (typeof new_order !== 'number') return res.status(400).json({ ok: false, error: "new_order required" });

  try {
    const pool = getPool();
    await pool.query("UPDATE hero_slides SET sort_order=$1 WHERE id=$2", [new_order, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
