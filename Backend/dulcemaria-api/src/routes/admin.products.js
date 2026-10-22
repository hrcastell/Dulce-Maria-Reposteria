const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");

const path = require("path");
const fs = require("fs");

const { getPool } = require("../db");
const { requireRole, requirePermission } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { slugify } = require("../utils/slug");
const { getRecipeCostsByIds, getSingleRecipeCost } = require("../lib/recipeCost");
const { validationError, sendError } = require("../lib/httpErrors");
const { clpAmount } = require("../lib/schemas");
const {
  UPLOADS_DIR,
  createImageUpload,
  removeUploadedFiles,
  deleteUploadByUrl,
} = require("../lib/uploads");

const router = express.Router();

// ===== Upload config =====
// Tipo verificado por contenido (JPEG/PNG/WebP), nombre generado por el
// servidor y extensión derivada del tipo real (ver lib/uploads.js).
// req.params.id ya pasó validateUuidParam: no puede salir de uploads/products/.
const MAX_PRODUCT_IMAGES = 8;
const uploadProductImages = createImageUpload({
  field: "images",
  maxFiles: MAX_PRODUCT_IMAGES,
  maxFileSizeMb: 10,
  directory: (req) => path.join(UPLOADS_DIR, "products", req.params.id),
  filenamePrefix: "img_",
});

const MAX_STOCK = 1000000;
const dimension = () => z.number().positive().max(1000);

// ===== CRUD products =====
router.get("/", requireRole("SUPERADMIN", "ADMIN", "STAFF"), requirePermission("products", "canView"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT p.id, p.name, p.slug, p.description, p.price_clp, p.cost_price_clp, p.stock_qty, p.is_active, p.created_at, p.updated_at,
              p.recipe_id, rec.name AS recipe_name, rec.is_scalable AS recipe_is_scalable,
              p.target_diameter_cm, p.target_height_cm, p.target_layers,
              (SELECT url_thumb FROM product_images WHERE product_id=p.id AND is_primary=true ORDER BY sort_order ASC LIMIT 1) AS thumb_url
       FROM products p
       LEFT JOIN recipes rec ON rec.id = p.recipe_id
       ORDER BY p.created_at DESC`
    );

    // Productos con receta vinculada: el costo se calcula en vivo desde la receta
    // (precio actual de los insumos), en vez de confiar en cost_price_clp guardado.
    // Las escalables se costean en su propio tamaño objetivo (o el de referencia
    // de la receta si el producto no definió uno), así que van una por una.
    const flatRecipeIds = r.rows.filter((row) => row.recipe_id && !row.recipe_is_scalable).map((row) => row.recipe_id);
    const costsByRecipe = await getRecipeCostsByIds(pool, flatRecipeIds);

    const items = [];
    for (const row of r.rows) {
      let recipeCost = null;
      if (row.recipe_id && row.recipe_is_scalable) {
        recipeCost = await getSingleRecipeCost(pool, row.recipe_id, {
          diameterCm: row.target_diameter_cm ?? undefined,
          heightCm: row.target_height_cm ?? undefined,
          layers: row.target_layers ?? undefined,
        });
      } else if (row.recipe_id) {
        recipeCost = costsByRecipe.get(row.recipe_id) || null;
      }
      items.push({
        ...row,
        cost_price_clp: recipeCost ? recipeCost.costPerPortion : row.cost_price_clp,
        cost_from_recipe: !!recipeCost,
      });
    }

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/", requireRole("SUPERADMIN", "ADMIN"), requirePermission("products", "canCreate"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(200),
    description: z.string().max(5000).optional(),
    priceClp: clpAmount(),
    costPriceClp: clpAmount().optional().nullable(),
    stockQty: z.number().int().nonnegative().max(MAX_STOCK).default(0),
    isActive: z.boolean().default(true),
    recipeId: z.string().uuid().optional().nullable(),
    targetDiameterCm: dimension().optional().nullable(),
    targetHeightCm: dimension().optional().nullable(),
    targetLayers: z.number().int().positive().max(100).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const { name, description, priceClp, costPriceClp, stockQty, isActive, recipeId, targetDiameterCm, targetHeightCm, targetLayers } = parsed.data;

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
      `INSERT INTO products (id, name, slug, description, price_clp, cost_price_clp, stock_qty, is_active, recipe_id, target_diameter_cm, target_height_cm, target_layers, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
      [id, name, slug, description ?? null, priceClp, costPriceClp ?? null, stockQty, isActive, recipeId ?? null, targetDiameterCm ?? null, targetHeightCm ?? null, targetLayers ?? null]
    );

    res.json({
      ok: true,
      product: {
        id, name, slug, price_clp: priceClp, cost_price_clp: costPriceClp ?? null, stock_qty: stockQty, is_active: isActive,
        recipe_id: recipeId ?? null, target_diameter_cm: targetDiameterCm ?? null, target_height_cm: targetHeightCm ?? null, target_layers: targetLayers ?? null,
      },
    });
  } catch (e) {
    if (e?.code === "23503") return res.status(400).json({ ok: false, error: "La receta seleccionada ya no existe" });
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * Función compartida para actualizar productos (PUT y PATCH)
 */
const updateProductHandler = async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().max(5000).optional().nullable(),
    priceClp: clpAmount().optional(),
    costPriceClp: clpAmount().optional().nullable(),
    stockQty: z.number().int().nonnegative().max(MAX_STOCK).optional(),
    isActive: z.boolean().optional(),
    recipeId: z.string().uuid().optional().nullable(),
    targetDiameterCm: dimension().optional().nullable(),
    targetHeightCm: dimension().optional().nullable(),
    targetLayers: z.number().int().positive().max(100).optional().nullable(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

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
    if (patch.costPriceClp !== undefined) { fields.push(`cost_price_clp=$${n}`); values.push(patch.costPriceClp); n++; }
    // Con variantes, products.stock_qty lo mantiene el trigger
    // update_product_stock_from_variants (suma de variantes). El stockQty que
    // manda el formulario puede venir desactualizado — se calcula antes de que
    // termine de guardarse la última variante editada — y pisaría ese total.
    if (patch.stockQty !== undefined) {
      const hasVariants = await pool.query("SELECT 1 FROM product_variants WHERE product_id=$1 LIMIT 1", [id]);
      if (hasVariants.rowCount === 0) { fields.push(`stock_qty=$${n}`); values.push(patch.stockQty); n++; }
    }
    if (patch.isActive !== undefined) { fields.push(`is_active=$${n}`); values.push(patch.isActive); n++; }
    if (patch.recipeId !== undefined) { fields.push(`recipe_id=$${n}`); values.push(patch.recipeId); n++; }
    if (patch.targetDiameterCm !== undefined) { fields.push(`target_diameter_cm=$${n}`); values.push(patch.targetDiameterCm); n++; }
    if (patch.targetHeightCm !== undefined) { fields.push(`target_height_cm=$${n}`); values.push(patch.targetHeightCm); n++; }
    if (patch.targetLayers !== undefined) { fields.push(`target_layers=$${n}`); values.push(patch.targetLayers); n++; }

    if (fields.length === 0) return res.status(400).json({ ok: false, error: "Nada para actualizar" });
    fields.push(`updated_at=NOW()`);

    values.push(id);
    const q = `
      UPDATE products
      SET ${fields.join(", ")}
      WHERE id=$${n}
      RETURNING id, name, slug, description, price_clp, cost_price_clp, stock_qty, is_active, recipe_id, target_diameter_cm, target_height_cm, target_layers, updated_at
    `;

    const r = await pool.query(q, values);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    res.json({ ok: true, product: r.rows[0] });
  } catch (e) {
    if (e?.code === "23503") return res.status(400).json({ ok: false, error: "La receta seleccionada ya no existe" });
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
};

// PUT /:id (alias sin uso del PATCH) se eliminó: ningún cliente lo llamaba (C-20).
router.patch("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), requirePermission("products", "canEdit"), updateProductHandler);

// ===== Images =====
router.get("/:id/images", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), requirePermission("products", "canView"), async (req, res) => {
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

/** 404 antes de procesar el multipart: no se crean carpetas ni archivos para productos inexistentes. */
async function ensureProductExists(req, res, next) {
  try {
    const r = await getPool().query("SELECT 1 FROM products WHERE id=$1 LIMIT 1", [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no existe" });
    return next();
  } catch (e) {
    return sendError(res, e);
  }
}

router.post(
  "/:id/images",
  requireRole("SUPERADMIN", "ADMIN"),
  validateUuidParam("id"),
  requirePermission("products", "canEdit"),
  ensureProductExists,
  uploadProductImages,
  async (req, res) => {
    const productId = req.params.id;
    const files = req.files || [];

    try {
      if (files.length === 0) return res.status(400).json({ ok: false, error: "No se recibieron archivos (field: images)" });

      const pool = getPool();

      const p = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [productId]);
      if (p.rowCount === 0) {
        await removeUploadedFiles(req);
        return res.status(404).json({ ok: false, error: "Producto no existe" });
      }

      const c = await pool.query("SELECT COUNT(*)::int AS n FROM product_images WHERE product_id=$1", [productId]);
      const current = c.rows[0].n;

      if (current + files.length > MAX_PRODUCT_IMAGES) {
        await removeUploadedFiles(req);
        return res.status(400).json({ ok: false, error: `Máximo ${MAX_PRODUCT_IMAGES} imágenes por producto. Actualmente: ${current}` });
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
      await removeUploadedFiles(req);
      return sendError(res, e);
    }
  }
);

router.patch("/images/:imageId/primary", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("imageId"), requirePermission("products", "canEdit"), async (req, res, next) => {
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
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), requirePermission("products", "canDelete"), async (req, res, next) => {
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

    // Eliminar imágenes asociadas (solo rutas dentro de uploads/)
    const images = await pool.query("SELECT url_original FROM product_images WHERE product_id=$1", [id]);
    for (const img of images.rows) {
      await deleteUploadByUrl(img.url_original);
    }

    await pool.query("DELETE FROM product_images WHERE product_id=$1", [id]);
    await pool.query("DELETE FROM products WHERE id=$1", [id]);

    // La carpeta del producto queda vacía: se elimina (rmdir falla si no lo está).
    await fs.promises.rmdir(path.join(UPLOADS_DIR, "products", id)).catch(() => {});

    res.json({ ok: true, message: "Producto eliminado", productId: id });
  } catch (e) {
    next(e);
  }
});

router.delete("/images/:imageId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("imageId"), requirePermission("products", "canEdit"), async (req, res, next) => {
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

    // borrar archivo físico (solo rutas dentro de uploads/)
    await deleteUploadByUrl(row.url_original);

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

router.get("/:id/variants", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), requirePermission("products", "canView"), async (req, res) => {
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

router.post("/:id/variants", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), requirePermission("products", "canEdit"), async (req, res) => {
  const { id } = req.params;
  const schema = z.object({
    name: z.string().min(1).max(100),
    price_override_clp: clpAmount().nullable().optional(),
    stock_qty: z.number().int().nonnegative().max(MAX_STOCK).default(0),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().min(-10000).max(10000).default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

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

router.patch("/variants/:variantId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("variantId"), requirePermission("products", "canEdit"), async (req, res) => {
  const { variantId } = req.params;
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    price_override_clp: clpAmount().nullable().optional(),
    stock_qty: z.number().int().nonnegative().max(MAX_STOCK).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(-10000).max(10000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

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

router.delete("/variants/:variantId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("variantId"), requirePermission("products", "canEdit"), async (req, res) => {
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

// ===== Toppings =====

router.get("/:id/toppings", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), requirePermission("products", "canView"), async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, product_id, name, type, price_clp, is_active, created_at
       FROM product_toppings
       WHERE product_id = $1
       ORDER BY type ASC, name ASC`,
      [id]
    );
    res.json({ ok: true, items: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.post("/:id/toppings", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), requirePermission("products", "canEdit"), async (req, res) => {
  const { id } = req.params;
  const schema = z.object({
    name: z.string().min(1).max(100),
    type: z.enum(["BASE", "ADDITIONAL"]).default("ADDITIONAL"),
    price_clp: clpAmount().default(0),
    is_active: z.boolean().default(true),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  try {
    const pool = getPool();
    const prod = await pool.query("SELECT id FROM products WHERE id=$1 LIMIT 1", [id]);
    if (prod.rowCount === 0) return res.status(404).json({ ok: false, error: "Producto no encontrado" });

    const r = await pool.query(
      `INSERT INTO product_toppings (id, product_id, name, type, price_clp, is_active)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [crypto.randomUUID(), id, parsed.data.name, parsed.data.type, parsed.data.price_clp, parsed.data.is_active]
    );
    res.json({ ok: true, topping: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.patch("/toppings/:toppingId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("toppingId"), requirePermission("products", "canEdit"), async (req, res) => {
  const { toppingId } = req.params;
  const schema = z.object({
    name: z.string().min(1).max(100).optional(),
    type: z.enum(["BASE", "ADDITIONAL"]).optional(),
    price_clp: clpAmount().optional(),
    is_active: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);

  const fields = [];
  const values = [];
  let n = 1;
  const d = parsed.data;

  if (d.name !== undefined) { fields.push(`name=$${n++}`); values.push(d.name); }
  if (d.type !== undefined) { fields.push(`type=$${n++}`); values.push(d.type); }
  if (d.price_clp !== undefined) { fields.push(`price_clp=$${n++}`); values.push(d.price_clp); }
  if (d.is_active !== undefined) { fields.push(`is_active=$${n++}`); values.push(d.is_active); }

  if (fields.length === 0) return res.status(400).json({ ok: false, error: "Nada que actualizar" });
  fields.push(`updated_at=NOW()`);
  values.push(toppingId);

  try {
    const pool = getPool();
    const r = await pool.query(
      `UPDATE product_toppings SET ${fields.join(",")} WHERE id=$${n} RETURNING *`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Topping no encontrado" });
    res.json({ ok: true, topping: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.delete("/toppings/:toppingId", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("toppingId"), requirePermission("products", "canEdit"), async (req, res) => {
  const { toppingId } = req.params;
  try {
    const pool = getPool();
    const r = await pool.query("DELETE FROM product_toppings WHERE id=$1 RETURNING id", [toppingId]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Topping no encontrado" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

module.exports = router;
