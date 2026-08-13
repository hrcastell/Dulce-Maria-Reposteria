const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { computeRecipeCost, getEnergyPrices, getItemsForRecipes } = require("../lib/recipeCost");
const { convertQuantity } = require("../lib/units");

const router = express.Router();

const itemSchema = z.object({
  supply_id: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(20),
});

const recipeSchema = z.object({
  name: z.string().min(1).max(200),
  portions: z.number().int().positive().default(1),
  notes: z.string().max(1000).optional().nullable(),
  equipment_id: z.string().uuid().optional().nullable(),
  baking_time_minutes: z.number().nonnegative().optional().nullable(),
  items: z.array(itemSchema).max(100).default([]),
});

// GET /admin/recipes — listado para las cards
router.get(["", "/"], requireRole("SUPERADMIN", "ADMIN", "STAFF"), async (req, res) => {
  const search = String(req.query.q || "").trim();
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT r.id, r.name, r.portions, r.equipment_id, r.baking_time_minutes, r.is_active,
              eq.energy_type, eq.consumption_rate
       FROM recipes r
       LEFT JOIN kitchen_equipment eq ON eq.id = r.equipment_id
       ${search ? "WHERE r.name ILIKE $1" : "WHERE r.is_active = true"}
       ORDER BY r.name ASC`,
      search ? [`%${search}%`] : []
    );

    const recipeIds = r.rows.map((row) => row.id);
    const [itemsMap, energyPrices] = await Promise.all([
      getItemsForRecipes(pool, recipeIds),
      getEnergyPrices(pool),
    ]);

    const items = r.rows.map((row) => {
      const equipment = row.equipment_id ? { energy_type: row.energy_type, consumption_rate: row.consumption_rate } : null;
      const cost = computeRecipeCost({ recipe: row, items: itemsMap.get(row.id) || [], equipment, ...energyPrices });
      return {
        id: row.id,
        name: row.name,
        portions: row.portions,
        is_active: row.is_active,
        itemCount: cost.itemCount,
        totalCost: cost.totalCost,
        costPerPortion: cost.costPerPortion,
        maxBatches: cost.maxBatches,
        hasUnpricedItem: cost.hasUnpricedItem,
      };
    });

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// GET /admin/recipes/:id — detalle para el formulario
router.get("/:id", requireRole("SUPERADMIN", "ADMIN", "STAFF"), validateUuidParam("id"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.query(
      `SELECT r.*, eq.name AS equipment_name, eq.energy_type, eq.consumption_rate
       FROM recipes r
       LEFT JOIN kitchen_equipment eq ON eq.id = r.equipment_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Receta no encontrada" });
    const row = r.rows[0];

    const itemsRes = await pool.query(
      `SELECT ri.id, ri.supply_id, ri.quantity, ri.unit,
              s.name AS supply_name, s.unit AS supply_unit, s.last_price_clp, s.reference_qty, s.stock_qty
       FROM recipe_items ri
       JOIN supplies s ON s.id = ri.supply_id
       WHERE ri.recipe_id = $1
       ORDER BY ri.created_at ASC`,
      [req.params.id]
    );

    const energyPrices = await getEnergyPrices(pool);
    const equipment = row.equipment_id ? { energy_type: row.energy_type, consumption_rate: row.consumption_rate } : null;
    const cost = computeRecipeCost({
      recipe: row,
      items: itemsRes.rows.map((it) => ({
        quantity: it.quantity,
        unit: it.unit,
        supply: { unit: it.supply_unit, last_price_clp: it.last_price_clp, reference_qty: it.reference_qty, stock_qty: it.stock_qty },
      })),
      equipment,
      ...energyPrices,
    });

    res.json({
      ok: true,
      recipe: {
        id: row.id,
        name: row.name,
        portions: row.portions,
        notes: row.notes,
        equipment_id: row.equipment_id,
        equipment_name: row.equipment_name,
        baking_time_minutes: row.baking_time_minutes,
        is_active: row.is_active,
      },
      items: itemsRes.rows.map((it) => ({
        id: it.id,
        supply_id: it.supply_id,
        supply_name: it.supply_name,
        supply_unit: it.supply_unit,
        quantity: Number(it.quantity),
        unit: it.unit,
      })),
      cost,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// POST /admin/recipes — crear (con insumos opcionales de entrada)
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
      `INSERT INTO recipes (id, name, portions, notes, equipment_id, baking_time_minutes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, d.name, d.portions, d.notes ?? null, d.equipment_id ?? null, d.baking_time_minutes ?? null]
    );
    for (const item of d.items) {
      await client.query(
        `INSERT INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), id, item.supply_id, item.quantity, item.unit]
      );
    }
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

// PUT /admin/recipes/:id — reemplaza los campos y el set completo de insumos
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
      `UPDATE recipes SET name=$1, portions=$2, notes=$3, equipment_id=$4, baking_time_minutes=$5, updated_at=NOW()
       WHERE id=$6 RETURNING id`,
      [d.name, d.portions, d.notes ?? null, d.equipment_id ?? null, d.baking_time_minutes ?? null, id]
    );
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Receta no encontrada" });
    }

    await client.query(`DELETE FROM recipe_items WHERE recipe_id=$1`, [id]);
    for (const item of d.items) {
      await client.query(
        `INSERT INTO recipe_items (id, recipe_id, supply_id, quantity, unit) VALUES ($1,$2,$3,$4,$5)`,
        [crypto.randomUUID(), id, item.supply_id, item.quantity, item.unit]
      );
    }
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
  const schema = z.object({ batches: z.number().int().positive().max(1000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });
  const { batches } = parsed.data;
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

    const recipeRes = await client.query(`SELECT id, name, portions FROM recipes WHERE id=$1`, [id]);
    if (recipeRes.rowCount === 0) throw new Error("Receta no encontrada");
    const recipe = recipeRes.rows[0];

    const itemsRes = await client.query(
      `SELECT ri.quantity, ri.unit, s.id AS supply_id, s.name AS supply_name, s.unit AS supply_unit, s.stock_qty
       FROM recipe_items ri
       JOIN supplies s ON s.id = ri.supply_id
       WHERE ri.recipe_id = $1
       FOR UPDATE OF s`,
      [id]
    );
    if (itemsRes.rowCount === 0) throw new Error("La receta no tiene insumos cargados");

    // Validar stock de TODOS los insumos antes de descontar ninguno.
    const needed = itemsRes.rows.map((item) => {
      const neededInSupplyUnit = convertQuantity(Number(item.quantity), item.unit, item.supply_unit) * batches;
      const available = Number(item.stock_qty);
      if (neededInSupplyUnit > available) {
        const err = new Error(
          `Stock insuficiente para "${item.supply_name}". Disponible: ${available} ${item.supply_unit}, necesario: ${neededInSupplyUnit} ${item.supply_unit}`
        );
        err.statusCode = 409;
        throw err;
      }
      return { supplyId: item.supply_id, amount: neededInSupplyUnit };
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
      const producedQty = recipe.portions * batches;
      await client.query(`UPDATE products SET stock_qty = stock_qty + $1, updated_at=NOW() WHERE id=$2`, [producedQty, product.id]);
      restockedProducts.push({ id: product.id, name: product.name, addedQty: producedQty });
    }

    await client.query("COMMIT");
    res.json({ ok: true, batches, restockedProducts, skippedProducts });
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
