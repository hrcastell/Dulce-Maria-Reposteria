const { convertQuantity } = require("./units");

/**
 * Calcula el costo de una receta a partir de sus líneas (insumo + cantidad + unidad)
 * y, opcionalmente, el consumo de energía del equipo usado.
 *
 * `items`: [{ quantity, unit, supply: { unit, last_price_clp, reference_qty, stock_qty } }]
 * `equipment`: { energy_type: 'ELECTRIC'|'GAS', consumption_rate } | null
 *
 * Insumos sin precio cargado o con unidad incompatible no rompen el cálculo:
 * esa línea queda fuera del costo y se marca `hasUnpricedItem`.
 */
function computeRecipeCost({ recipe, items, equipment, energyPriceKwh, energyPriceGas }) {
  let itemsCost = 0;
  let maxBatches = items.length > 0 ? Infinity : 0;
  let hasUnpricedItem = false;

  for (const item of items) {
    const s = item.supply;
    const referenceQty = Number(s.reference_qty) || 1;
    const unitPrice = s.last_price_clp != null ? Number(s.last_price_clp) / referenceQty : null;

    let neededInSupplyUnit = null;
    try {
      neededInSupplyUnit = convertQuantity(Number(item.quantity), item.unit, s.unit);
    } catch {
      hasUnpricedItem = true;
    }

    if (unitPrice != null && neededInSupplyUnit != null) {
      itemsCost += unitPrice * neededInSupplyUnit;
    } else {
      hasUnpricedItem = true;
    }

    if (neededInSupplyUnit != null && neededInSupplyUnit > 0) {
      const stockQty = Number(s.stock_qty) || 0;
      maxBatches = Math.min(maxBatches, Math.floor(stockQty / neededInSupplyUnit));
    } else {
      maxBatches = 0;
    }
  }

  if (!Number.isFinite(maxBatches) || maxBatches < 0) maxBatches = 0;

  let energyCost = 0;
  if (equipment && recipe.baking_time_minutes != null) {
    const hours = Number(recipe.baking_time_minutes) / 60;
    const consumed = Number(equipment.consumption_rate) * hours;
    const price = equipment.energy_type === "ELECTRIC" ? Number(energyPriceKwh || 0) : Number(energyPriceGas || 0);
    energyCost = consumed * price;
  }

  const totalCost = itemsCost + energyCost;
  const portions = Number(recipe.portions) || 1;

  return {
    itemCount: items.length,
    itemsCost: Math.round(itemsCost),
    energyCost: Math.round(energyCost),
    totalCost: Math.round(totalCost),
    costPerPortion: Math.round(totalCost / portions),
    maxBatches,
    hasUnpricedItem,
  };
}

async function getEnergyPrices(db) {
  const r = await db.query(`SELECT key, value FROM system_config WHERE key IN ('energy_price_kwh','energy_price_gas')`);
  const map = Object.fromEntries(r.rows.map((row) => [row.key, row.value]));
  return {
    energyPriceKwh: Number(map.energy_price_kwh || 0),
    energyPriceGas: Number(map.energy_price_gas || 0),
  };
}

async function getItemsForRecipes(db, recipeIds) {
  const map = new Map(recipeIds.map((id) => [id, []]));
  if (recipeIds.length === 0) return map;
  const r = await db.query(
    `SELECT ri.recipe_id, ri.quantity, ri.unit,
            s.id AS supply_id, s.name AS supply_name, s.unit AS supply_unit,
            s.last_price_clp, s.reference_qty, s.stock_qty
     FROM recipe_items ri
     JOIN supplies s ON s.id = ri.supply_id
     WHERE ri.recipe_id = ANY($1::uuid[])`,
    [recipeIds]
  );
  for (const row of r.rows) {
    map.get(row.recipe_id).push({
      quantity: row.quantity,
      unit: row.unit,
      supply: {
        id: row.supply_id,
        name: row.supply_name,
        unit: row.supply_unit,
        last_price_clp: row.last_price_clp,
        reference_qty: row.reference_qty,
        stock_qty: row.stock_qty,
      },
    });
  }
  return map;
}

/** Trae y calcula el costo de un set de recetas en una sola pasada (listados de recetas o productos). */
async function getRecipeCostsByIds(db, recipeIds) {
  const ids = [...new Set(recipeIds)].filter(Boolean);
  const map = new Map();
  if (ids.length === 0) return map;

  const r = await db.query(
    `SELECT r.id, r.portions, r.baking_time_minutes, r.equipment_id,
            eq.energy_type, eq.consumption_rate
     FROM recipes r
     LEFT JOIN kitchen_equipment eq ON eq.id = r.equipment_id
     WHERE r.id = ANY($1::uuid[])`,
    [ids]
  );

  const [itemsMap, energyPrices] = await Promise.all([getItemsForRecipes(db, ids), getEnergyPrices(db)]);

  for (const row of r.rows) {
    const equipment = row.equipment_id ? { energy_type: row.energy_type, consumption_rate: row.consumption_rate } : null;
    map.set(row.id, computeRecipeCost({ recipe: row, items: itemsMap.get(row.id) || [], equipment, ...energyPrices }));
  }
  return map;
}

module.exports = { computeRecipeCost, getEnergyPrices, getItemsForRecipes, getRecipeCostsByIds };
