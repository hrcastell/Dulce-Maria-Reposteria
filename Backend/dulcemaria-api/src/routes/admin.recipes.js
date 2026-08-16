const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const {
  getRecipeCostsByIds,
  getSingleRecipeCost,
  getComponentsForRecipe,
  scaleComponents,
  computeVolumeRatio,
  previewRecipeCost,
} = require("../lib/recipeCost");
const { convertQuantity, VALID_UNITS } = require("../lib/units");

const router = express.Router();

const flatItemSchema = z.object({
  supply_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.enum(VALID_UNITS),
});

// Body de POST /admin/recipes/preview-cost — mismas líneas que flatItemSchema/componentSchema
// pero sin las validaciones estrictas de "receta completa": es solo para calcular, no persiste nada.
const previewItemSchema = z.object({
  supply_id: z.string().uuid(),
  quantity: z.number(),
  unit: z.string(),
});
const previewCostSchema = z.object({
  costMode: z.enum(["INSUMOS", "MANUAL"]).default("INSUMOS"),
  manualCostClp: z.number().nonnegative().optional().nullable(),
  portions: z.number().positive().default(1),
  items: z.array(previewItemSchema).max(100).optional().default([]),
  components: z
    .array(
      z.object({
        layer_scale_basis: z.enum(["CAKE", "FILLING", "NONE"]).optional(),
        items: z.array(previewItemSchema).max(100).optional().default([]),
      })
    )
    .max(20)
    .optional()
    .default([]),
  equipmentId: z.string().uuid().optional().nullable(),
  bakingTimeMinutes: z.number().nonnegative().optional().nullable(),
  laborMinutes: z.number().nonnegative().optional().nullable(),
  laborRateClpHour: z.number().nonnegative().optional().nullable(),
  isScalable: z.boolean().optional().default(false),
  refDiameterCm: z.number().positive().optional().nullable(),
  refHeightCm: z.number().positive().optional().nullable(),
  refLayers: z.number().int().positive().optional().nullable(),
  targetDiameterCm: z.number().positive().optional().nullable(),
  targetHeightCm: z.number().positive().optional().nullable(),
  targetLayers: z.number().int().positive().optional().nullable(),
});

const componentSchema = z.object({
  name: z.string().min(1).max(150),
  layer_scale_basis: z.enum(["CAKE", "FILLING", "NONE"]).default("NONE"),
  items: z.array(flatItemSchema).max(100).default([]),
});

const recipeSchema = z
  .object({
    name: z.string().min(1).max(200),
    portions: z.number().int().positive().default(1),
    notes: z.string().max(1000).optional().nullable(),
    equipment_id: z.string().uuid().optional().nullable(),
    baking_time_minutes: z.number().nonnegative().optional().nullable(),
    labor_minutes: z.number().nonnegative().optional().nullable(),
    labor_rate_clp_hour: z.number().int().nonnegative().optional().nullable(),
    margin_pct: z.number().min(0).max(99.99).optional().nullable(),
    cost_mode: z.enum(["INSUMOS", "MANUAL"]).default("INSUMOS"),
    manual_cost_clp: z.number().int().nonnegative().optional().nullable(), // usado cuando cost_mode=MANUAL
    is_scalable: z.boolean().default(false),
    ref_diameter_cm: z.number().positive().optional().nullable(),
    ref_height_cm: z.number().positive().optional().nullable(),
    ref_layers: z.number().int().positive().optional().nullable(),
    items: z.array(flatItemSchema).max(100).default([]), // usado cuando cost_mode=INSUMOS e is_scalable=false
    components: z.array(componentSchema).max(20).default([]), // usado cuando cost_mode=INSUMOS e is_scalable=true
  })
  .refine((d) => d.cost_mode !== "MANUAL" || !d.is_scalable, {
    message: "El modo manual no es compatible con el escalado por molde",
  })
  .refine((d) => d.cost_mode !== "MANUAL" || (d.manual_cost_clp != null && d.manual_cost_clp > 0), {
    message: "El modo manual necesita un costo total mayor a 0",
  })
  .refine((d) => !d.is_scalable || (d.ref_diameter_cm && d.ref_height_cm && d.ref_layers), {
    message: "Una receta escalable necesita diámetro, alto y capas de referencia",
  });

/** Persiste componentes+items (escalable) o items planos (no escalable) para una receta ya creada. En modo manual no hay nada que persistir. */
async function persistRecipeItems(client, recipeId, d) {
  if (d.cost_mode === "MANUAL") return;
  if (d.is_scalable) {
    for (let i = 0; i < d.components.length; i++) {
      const comp = d.components[i];
      const compId = crypto.randomUUID();
      await client.query(
        `INSERT INTO recipe_components (id, recipe_id, name, layer_scale_basis, sort_order) VALUES ($1,$2,$3,$4,$5)`,
        [compId, recipeId, comp.name, comp.layer_scale_basis, i]
      );
      for (const item of comp.items) {
        await client.query(
          `INSERT INTO recipe_items (id, recipe_id, supply_id, quantity, unit, component_id) VALUES ($1,$2,$3,$4,$5,$6)`,
          [crypto.randomUUID(), recipeId, item.supply_id, item.quantity, item.unit, compId]
        );
      }
    }
  } else {
    for (const item of d.items) {
      await client.query(
        `INSERT INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), recipeId, item.supply_id, item.quantity, item.unit]
      );
    }
  }
}

// GET /admin/recipes — listado para las cards (escalables se costean a su tamaño de referencia)
router.get(["", "/"], requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const search = String(req.query.q || "").trim();
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT r.id, r.name, r.portions, r.is_active, r.is_scalable, r.cost_mode, r.margin_pct
       FROM recipes r
       ${search ? "WHERE r.name ILIKE $1" : "WHERE r.is_active = true"}
       ORDER BY r.name ASC`,
      search ? [`%${search}%`] : []
    );

    const costsById = await getRecipeCostsByIds(pool, r.rows.map((row) => row.id));

    const items = r.rows.map((row) => {
      const cost = costsById.get(row.id) || { itemCount: 0, totalCost: 0, costPerPortion: 0, maxBatches: 0, hasUnpricedItem: false };
      return {
        id: row.id,
        name: row.name,
        portions: row.portions,
        is_active: row.is_active,
        is_scalable: row.is_scalable,
        is_manual: row.cost_mode === "MANUAL",
        itemCount: cost.itemCount,
        totalCost: cost.totalCost,
        costPerPortion: cost.costPerPortion,
        maxBatches: cost.maxBatches,
        hasUnpricedItem: cost.hasUnpricedItem,
        margin_pct: row.margin_pct != null ? Number(row.margin_pct) : null,
      };
    });

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /admin/recipes/preview-cost — costo en vivo a partir del estado actual de un
// formulario (insumos/componentes/energía/mano de obra aún sin guardar), sin persistir.
// STAFF puede llamarlo (no muta nada) para que el panel de solo-lectura también lo use.
router.post("/preview-cost", requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const parsed = previewCostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  try {
    const pool = getPool();
    const cost = await previewRecipeCost(pool, parsed.data);
    res.json({ ok: true, cost });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// GET /admin/recipes/:id — detalle para el formulario. Con ?target_diameter_cm=&target_height_cm=&target_layers=
// costea una receta escalable a ese tamaño en vez de al de referencia.
router.get("/:id", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT rec.*, eq.name AS equipment_name
       FROM recipes rec
       LEFT JOIN kitchen_equipment eq ON eq.id = rec.equipment_id
       WHERE rec.id = $1`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Receta no encontrada" });
    const row = r.rows[0];

    const targetDims = {};
    if (req.query.target_diameter_cm) targetDims.diameterCm = Number(req.query.target_diameter_cm);
    if (req.query.target_height_cm) targetDims.heightCm = Number(req.query.target_height_cm);
    if (req.query.target_layers) targetDims.layers = Number(req.query.target_layers);

    const cost = await getSingleRecipeCost(pool, req.params.id, targetDims);

    let items = null;
    let components = null;
    if (row.cost_mode === "MANUAL") {
      // Sin insumos que traer.
    } else if (row.is_scalable) {
      const comps = await getComponentsForRecipe(pool, req.params.id);
      components = comps.map((c) => ({
        id: c.id,
        name: c.name,
        layer_scale_basis: c.layer_scale_basis,
        items: c.items.map((it) => ({
          supply_id: it.supply.id,
          supply_name: it.supply.name,
          supply_unit: it.supply.unit,
          quantity: Number(it.quantity),
          unit: it.unit,
        })),
      }));
    } else {
      const itemsRes = await pool.query(
        `SELECT ri.id, ri.supply_id, ri.quantity, ri.unit, s.name AS supply_name, s.unit AS supply_unit
         FROM recipe_items ri
         JOIN supplies s ON s.id = ri.supply_id
         WHERE ri.recipe_id = $1 AND ri.component_id IS NULL
         ORDER BY ri.created_at ASC`,
        [req.params.id]
      );
      items = itemsRes.rows.map((it) => ({
        id: it.id,
        supply_id: it.supply_id,
        supply_name: it.supply_name,
        supply_unit: it.supply_unit,
        quantity: Number(it.quantity),
        unit: it.unit,
      }));
    }

    res.json({
      ok: true,
      recipe: {
        id: row.id,
        name: row.name,
        portions: row.portions,
        notes: row.notes,
        equipment_id: row.equipment_id,
        equipment_name: row.equipment_name,
        baking_time_minutes: row.baking_time_minutes != null ? Number(row.baking_time_minutes) : null,
        labor_minutes: row.labor_minutes,
        labor_rate_clp_hour: row.labor_rate_clp_hour,
        margin_pct: row.margin_pct != null ? Number(row.margin_pct) : null,
        is_active: row.is_active,
        cost_mode: row.cost_mode,
        manual_cost_clp: row.manual_cost_clp,
        is_scalable: row.is_scalable,
        ref_diameter_cm: row.ref_diameter_cm != null ? Number(row.ref_diameter_cm) : null,
        ref_height_cm: row.ref_height_cm != null ? Number(row.ref_height_cm) : null,
        ref_layers: row.ref_layers,
      },
      items,
      components,
      cost,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /admin/recipes — crear (plana con items, o escalable con components)
router.post("/", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const parsed = recipeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const d = parsed.data;

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }

  try {
    await client.query("BEGIN");
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO recipes (id, name, portions, notes, equipment_id, baking_time_minutes, cost_mode, manual_cost_clp, is_scalable, ref_diameter_cm, ref_height_cm, ref_layers, labor_minutes, labor_rate_clp_hour, margin_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, d.name, d.portions, d.notes ?? null, d.equipment_id ?? null, d.baking_time_minutes ?? null,
        d.cost_mode,
        d.cost_mode === "MANUAL" ? d.manual_cost_clp : null,
        d.is_scalable,
        d.is_scalable ? d.ref_diameter_cm : null,
        d.is_scalable ? d.ref_height_cm : null,
        d.is_scalable ? d.ref_layers : null,
        d.labor_minutes ?? null,
        d.labor_rate_clp_hour ?? null,
        d.margin_pct ?? null,
      ]
    );
    await persistRecipeItems(client, id, d);
    await client.query("COMMIT");
    res.json({ ok: true, recipe: { id } });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    if (e?.code === "23503") return res.status(400).json({ ok: false, error: "Uno de los insumos seleccionados ya no existe" });
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

// PUT /admin/recipes/:id — reemplaza los campos y el set completo de insumos/componentes
router.put("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const parsed = recipeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const d = parsed.data;
  const { id } = req.params;

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }

  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE recipes SET name=$1, portions=$2, notes=$3, equipment_id=$4, baking_time_minutes=$5,
         cost_mode=$6, manual_cost_clp=$7, is_scalable=$8, ref_diameter_cm=$9, ref_height_cm=$10, ref_layers=$11,
         labor_minutes=$12, labor_rate_clp_hour=$13, margin_pct=$14, updated_at=NOW()
       WHERE id=$15 RETURNING id`,
      [
        d.name, d.portions, d.notes ?? null, d.equipment_id ?? null, d.baking_time_minutes ?? null,
        d.cost_mode,
        d.cost_mode === "MANUAL" ? d.manual_cost_clp : null,
        d.is_scalable,
        d.is_scalable ? d.ref_diameter_cm : null,
        d.is_scalable ? d.ref_height_cm : null,
        d.is_scalable ? d.ref_layers : null,
        d.labor_minutes ?? null,
        d.labor_rate_clp_hour ?? null,
        d.margin_pct ?? null,
        id,
      ]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Receta no encontrada" });
    }

    // Se borra todo lo anterior (componentes → sus items en cascada, y los items
    // planos sueltos) y se reinserta según el modo actual — así cambiar entre
    // receta plana y escalable no deja basura del modo anterior.
    await client.query(`DELETE FROM recipe_components WHERE recipe_id=$1`, [id]);
    await client.query(`DELETE FROM recipe_items WHERE recipe_id=$1 AND component_id IS NULL`, [id]);
    await persistRecipeItems(client, id, d);

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    if (e?.code === "23503") return res.status(400).json({ ok: false, error: "Uno de los insumos seleccionados ya no existe" });
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

// PATCH /admin/recipes/:id — activar/desactivar
router.patch("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({ is_active: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  try {
    const pool = getPool();
    const r = await pool.query(`UPDATE recipes SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING id`, [parsed.data.is_active, req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Receta no encontrada" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// DELETE /admin/recipes/:id
router.delete("/:id", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(`DELETE FROM recipes WHERE id=$1 RETURNING id`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Receta no encontrada" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /admin/recipes/:id/produce — "Hacer Receta": descuenta insumos y recarga stock del producto vinculado
router.post("/:id/produce", requireRole("SUPERADMIN", "ADMIN"), validateUuidParam("id"), async (req, res) => {
  const schema = z.object({
    batches: z.number().int().positive().max(1000),
    target_diameter_cm: z.number().positive().optional(),
    target_height_cm: z.number().positive().optional(),
    target_layers: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const { batches, target_diameter_cm, target_height_cm, target_layers } = parsed.data;
  const { id } = req.params;

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }

  try {
    await client.query("BEGIN");

    const recipeRes = await client.query(`SELECT * FROM recipes WHERE id=$1`, [id]);
    if (recipeRes.rowCount === 0) throw new Error("Receta no encontrada");
    const recipe = recipeRes.rows[0];

    let lines = []; // [{ supply_id, supply_name, supply_unit, quantity, unit }] — quantity YA es para 1 tanda, sin *batches todavía
    let scaledPortions = Number(recipe.portions) || 1;

    if (recipe.cost_mode === "MANUAL") {
      // Modo manual: no hay insumos que descontar, solo se recarga el producto vinculado.
    } else if (recipe.is_scalable) {
      if (!target_diameter_cm || !target_height_cm || !target_layers) {
        const err = new Error("Esta receta es escalable — indicá diámetro, alto y capas objetivo antes de producir");
        err.statusCode = 400;
        throw err;
      }
      const components = await getComponentsForRecipe(client, id);
      if (components.length === 0) throw new Error("La receta no tiene componentes/insumos cargados");
      const scaledItems = scaleComponents(components, {
        refDiameterCm: recipe.ref_diameter_cm,
        refHeightCm: recipe.ref_height_cm,
        refLayers: recipe.ref_layers,
        targetDiameterCm: target_diameter_cm,
        targetHeightCm: target_height_cm,
        targetLayers: target_layers,
      });
      const volumeRatio = computeVolumeRatio(recipe.ref_diameter_cm, recipe.ref_height_cm, target_diameter_cm, target_height_cm);
      scaledPortions = Math.max(1, Math.round((Number(recipe.portions) || 1) * volumeRatio));
      lines = scaledItems.map((it) => ({
        supply_id: it.supply.id,
        supply_name: it.supply.name,
        supply_unit: it.supply.unit,
        quantity: it.quantity,
        unit: it.unit,
      }));

      // Bloquea las filas de insumos involucradas para leer su stock de forma
      // consistente (el fetch de arriba no las bloqueó).
      const supplyIds = [...new Set(lines.map((l) => l.supply_id))];
      const lockRes = await client.query(`SELECT id, stock_qty FROM supplies WHERE id = ANY($1::uuid[]) FOR UPDATE`, [supplyIds]);
      const stockById = new Map(lockRes.rows.map((row) => [row.id, Number(row.stock_qty)]));
      lines = lines.map((l) => ({ ...l, stock_qty: stockById.get(l.supply_id) ?? 0 }));
    } else {
      const itemsRes = await client.query(
        `SELECT ri.quantity, ri.unit, s.id AS supply_id, s.name AS supply_name, s.unit AS supply_unit, s.stock_qty
         FROM recipe_items ri
         JOIN supplies s ON s.id = ri.supply_id
         WHERE ri.recipe_id = $1 AND ri.component_id IS NULL
         FOR UPDATE OF s`,
        [id]
      );
      if (itemsRes.rowCount === 0) throw new Error("La receta no tiene insumos cargados");
      lines = itemsRes.rows.map((row) => ({ ...row, stock_qty: Number(row.stock_qty) }));
    }

    // Validar stock de TODOS los insumos antes de descontar ninguno.
    const needed = lines.map((line) => {
      const neededInSupplyUnit = convertQuantity(Number(line.quantity), line.unit, line.supply_unit) * batches;
      if (neededInSupplyUnit > line.stock_qty) {
        const err = new Error(
          `Stock insuficiente para "${line.supply_name}". Disponible: ${line.stock_qty} ${line.supply_unit}, necesario: ${neededInSupplyUnit} ${line.supply_unit}`
        );
        err.statusCode = 409;
        throw err;
      }
      return { supplyId: line.supply_id, amount: neededInSupplyUnit };
    });

    for (const n of needed) {
      await client.query(`UPDATE supplies SET stock_qty = stock_qty - $1, updated_at=NOW() WHERE id=$2`, [n.amount, n.supplyId]);
    }

    // Producto(s) vinculado(s): recarga stock solo si no tienen variantes (su stock
    // se recalcula solo desde un trigger que suma el stock de las variantes).
    const productRes = await client.query(`SELECT id, name FROM products WHERE recipe_id=$1`, [id]);
    const restockedProducts = [];
    const skippedProducts = [];
    for (const product of productRes.rows) {
      const variantsRes = await client.query(`SELECT 1 FROM product_variants WHERE product_id=$1 LIMIT 1`, [product.id]);
      if (variantsRes.rowCount > 0) {
        skippedProducts.push(product.name);
        continue;
      }
      const producedQty = scaledPortions * batches;
      await client.query(`UPDATE products SET stock_qty = stock_qty + $1, updated_at=NOW() WHERE id=$2`, [producedQty, product.id]);
      restockedProducts.push({ id: product.id, name: product.name, addedQty: producedQty });
    }

    await client.query("COMMIT");
    res.json({ ok: true, batches, scaledPortions, restockedProducts, skippedProducts });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback failed:", rollbackErr.message);
    }
    const statusCode = Number(e?.statusCode || 400);
    res.status(statusCode).json({ ok: false, error: String(e?.message ?? e) });
  } finally {
    client.release();
  }
});

module.exports = router;
