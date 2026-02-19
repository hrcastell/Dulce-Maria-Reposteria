const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { slugify } = require("../utils/slug");

const router = express.Router();

// ===== Upload config =====
const APP_ROOT = path.join(__dirname, "..", ".."); // /dulcemaria-api
const UPLOADS_DIR = path.join(APP_ROOT, "uploads");
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime) {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return "";
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const productId = req.params.id;
      const dir = path.join(UPLOADS_DIR, "products", productId);
      fs.mkdirSync(dir, { recursive: true }); // <- si no existe, la crea
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    try {
      const ext = extFromMime(file.mimetype);
      const name = `img_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
      cb(null, name);
    } catch (e) {
      cb(e);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Formato no permitido. Usa JPG/PNG/WEBP."));
    }
    cb(null, true);
  },
});

// ===== CRUD products =====
router.get("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.price_clp, p.stock_qty, p.is_active, p.created_at, p.updated_at,
              (SELECT url_thumb FROM product_images WHERE product_id=p.id AND is_primary=true ORDER BY sort_order ASC LIMIT 1) AS thumb_url
       FROM products p
       ORDER BY p.created_at DESC`
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    description: z.string().optional(),
    priceClp: z.number().int().nonnegative(),
    stockQty: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { name, description, priceClp, stockQty, isActive } = parsed.data;

  try {
    const pool = getPool();
    const id = crypto.randomUUID();

    let base = slugify(name) || "producto";
    let slug = base;

    for (let i = 0; i < 10; i++) {
      const ex = await pool.query("SELECT 1 FROM products WHERE slug=$1 LIMIT 1", [slug]);
      if (ex.rowCount === 0) break;
      slug = `${base}-${crypto.randomBytes(2).toString("hex")}`;
    }

    await pool.query(
      `INSERT INTO products (id, name, slug, description, price_clp, stock_qty, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [id, name, slug, description ?? null, priceClp, stockQty, isActive]
    );

    res.json({ ok: true, product: { id, name, slug, price_clp: priceClp, stock_qty: stockQty, is_active: isActive } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Función compartida para actualizar productos (PUT y PATCH)
 */
const updateProductHandler = async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    description: z.string().optional().nullable(),
    priceClp: z.number().int().nonnegative().optional(),
    stockQty: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { id } = req.params;
  const patch = parsed.data;

  try {
    const pool = getPool();

    let newSlug = null;
    if (patch.name) {
      let base = slugify(patch.name) || "producto";
      let slug = base;

      for (let i = 0; i < 10; i++) {
        const ex = await pool.query("SELECT 1 FROM products WHERE slug=$1 AND id<>$2 LIMIT 1", [slug, id]);
        if (ex.rowCount === 0) break;
        slug = `${base}-${crypto.randomBytes(2).toString("hex")}`;
      }
      newSlug = slug;
    }

    const fields = [];
    const values = [];
    let n = 1;

    if (patch.name !== undefined) { fields.push(`name=$${n}`); values.push(patch.name); n++; }
    if (newSlug !== null) { fields.push(`slug=$${n}`); values.push(newSlug); n++; }
    if (patch.description !== undefined) { fields.push(`description=$${n}`); values.push(patch.description); n++; }
    if (patch.priceClp !== undefined) { fields.push(`price_clp=$${n}`); values.push(patch.priceClp); n++; }
    if (patch.stockQty !== undefined) { fields.push(`stock_qty=$${n}`); values.push(patch.stockQty); n++; }
    if (patch.isActive !== undefined) { fields.push(`is_active=$${n}`); values.push(patch.isActive); n++; }

    if (fields.length === 0) return res.status(400).json({ ok: false, error: "Nada para actualizar" });
    fields.push(`updated_at=NOW()`);

    values.push(id);
    const q = `
      UPDATE products
      SET ${fields.join(", ")}
      WHERE id=$${n}
      RETURNING id, name, slug, description, price_clp, stock_qty, is_active, updated_at
    `;

    const r = await pool.query(q, values);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    res.json({ ok: true, product: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
};

router.put("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), updateProductHandler);
router.patch("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), updateProductHandler);

// ===== Images =====
router.get("/:id/images", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, product_id, url_original, url_large, url_thumb, sort_order, is_primary, created_at
       FROM product_images
       WHERE product_id=$1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [id]
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post(
  "/:id/images",
  requireRole("SUPERADMIN", "ADMIN"),
  validateUuidParam("id"),
  upload.array("images", 8),
  async (req, res, next) => {
    const productId = req.params.id;
    const files = req.files || [];

    try {
      if (files.length === 0) return res.status(400).json({ ok: false, error: "No se recibieron archivos (field: images)" });

      const pool = getPool();

      const p = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [productId]);
      if (p.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no existe" });

      const c = await pool.query("SELECT COUNT(*)::int AS n FROM product_images WHERE product_id=$1", [productId]);
      const current = c.rows[0].n;

      if (current + files.length > 8) {
        for (const f of files) { try { fs.unlinkSync(f.path); } catch {} }
        return res.status(400).json({ ok: false, error: `Máximo 8 imágenes por producto. Actualmente: ${current}` });
      }

      const inserted = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const relUrl = `/uploads/products/${productId}/${f.filename}`;
        const id = crypto.randomUUID();
        const sortOrder = current + i;
        const isPrimary = current === 0 && i === 0;

        await pool.query(
          `INSERT INTO product_images (id, product_id, url_original, url_large, url_thumb, sort_order, is_primary, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
          [id, productId, relUrl, relUrl, relUrl, sortOrder, isPrimary]
        );

        inserted.push({ id, productId, url: relUrl, sortOrder, isPrimary });
      }

      res.json({ ok: true, uploaded: inserted.length, items: inserted });
    } catch (e) {
      // cleanup si algo falla después de guardar archivos
      for (const f of files) { try { fs.unlinkSync(f.path); } catch {} }
      next(e);
    }
  }
);

router.patch("/images/:imageId/primary", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("imageId"), async (req, res, next) => {
  try {
    const { imageId } = req.params;
    const pool = getPool();

    const r = await pool.query(`SELECT id, product_id FROM product_images WHERE id=$1 LIMIT 1`, [imageId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Imagen no existe" });

    const productId = r.rows[0].product_id;

    await pool.query(`UPDATE product_images SET is_primary=false WHERE product_id=$1`, [productId]);
    await pool.query(`UPDATE product_images SET is_primary=true WHERE id=$1`, [imageId]);

    res.json({ ok: true, message: "Imagen marcada como principal", imageId, productId });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /admin/products/:id
 * Elimina producto completo
 */
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const exists = await pool.query("SELECT 1 FROM products WHERE id=$1 LIMIT 1", [id]);
    if (exists.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    // Verificar si tiene items en órdenes
    const orders = await pool.query("SELECT 1 FROM order_items WHERE product_id=$1 LIMIT 1", [id]);
    if (orders.rowCount > 0) {
      return res.status(409).json({ ok: false, error: "No se puede eliminar un producto con órdenes asociadas" });
    }

    // Eliminar imágenes asociadas
    const images = await pool.query("SELECT url_original FROM product_images WHERE product_id=$1", [id]);
    for (const img of images.rows) {
      try {
        const rel = String(img.url_original).replace(/^\/uploads\//, "");
        const abs = path.join(UPLOADS_DIR, rel);
        fs.unlinkSync(abs);
      } catch {}
    }

    await pool.query("DELETE FROM product_images WHERE product_id=$1", [id]);
    await pool.query("DELETE FROM products WHERE id=$1", [id]);

    res.json({ ok: true, message: "Producto eliminado", productId: id });
  } catch (e) {
    next(e);
  }
});

router.delete("/images/:imageId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("imageId"), async (req, res, next) => {
  try {
    const { imageId } = req.params;
    const pool = getPool();

    const r = await pool.query(
      `SELECT id, product_id, url_original, is_primary FROM product_images WHERE id=$1 LIMIT 1`,
      [imageId]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Imagen no existe" });

    const row = r.rows[0];

    await pool.query(`DELETE FROM product_images WHERE id=$1`, [imageId]);

    // borrar archivo físico
    try {
      const rel = String(row.url_original).replace(/^\/uploads\//, "");
      const abs = path.join(UPLOADS_DIR, rel);
      fs.unlinkSync(abs);
    } catch {}

    // si era primary, reasignar
    if (row.is_primary) {
      const nextImg = await pool.query(
        `SELECT id FROM product_images
         WHERE product_id=$1
         ORDER BY sort_order ASC, created_at ASC
         LIMIT 1`,
        [row.product_id]
      );
      if (nextImg.rowCount > 0) {
        await pool.query(`UPDATE product_images SET is_primary=true WHERE id=$1`, [nextImg.rows[0].id]);
      }
    }

    res.json({ ok: true, message: "Imagen eliminada", imageId });
  } catch (e) {
    next(e);
  }
});

// ===== Variants =====

router.get("/:id/variants", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, product_id, name, price_override_clp, stock_qty, is_active, sort_order, created_at
       FROM product_variants
       WHERE product_id = $1
       ORDER BY sort_order ASC, created_at ASC`,
      [id]
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/:id/variants", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const { id } = req.params;
  const schema = z.object({
    name: z.string().min(1).max(100),
    price_override_clp: z.number().int().nonnegative().nullable().optional(),
    stock_qty: z.number().int().nonnegative().default(0),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  try {
    const pool = getPool();
    const prod = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [id]);
    if (prod.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    const r = await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price_override_clp, stock_qty, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [crypto.randomUUID(), id, parsed.data.name, parsed.data.price_override_clp ?? null, parsed.data.stock_qty, parsed.data.is_active, parsed.data.sort_order]
    );
    res.json({ ok: true, variant: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/variants/:variantId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("variantId"), async (req, res) => {
  const { variantId } = req.params;
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    price_override_clp: z.number().int().nonnegative().nullable().optional(),
    stock_qty: z.number().int().nonnegative().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const fields = [];
  const values = [];
  let n = 1;
  const d = parsed.data;
  if (d.name !== undefined) { fields.push(`name=$${n++}`); values.push(d.name); }
  if ('price_override_clp' in d) { fields.push(`price_override_clp=$${n++}`); values.push(d.price_override_clp ?? null); }
  if (d.stock_qty !== undefined) { fields.push(`stock_qty=$${n++}`); values.push(d.stock_qty); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }
  if (d.sort_order !== undefined) { fields.push(`sort_order=$${n++}`); values.push(d.sort_order); }

  if (fields.length === 0) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  fields.push(`updated_at=NOW()`);
  values.push(variantId);

  try {
    const pool = getPool();
    const r = await pool.query(
      `UPDATE product_variants SET ${fields.join(",")} WHERE id=$${n} RETURNING *`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Variante no encontrada" });
    res.json({ ok: true, variant: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/variants/:variantId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("variantId"), async (req, res) => {
  const { variantId } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query("DELETE FROM product_variants WHERE id=$1 RETURNING id", [variantId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Variante no encontrada" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
