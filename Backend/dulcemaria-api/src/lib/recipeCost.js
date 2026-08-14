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

// ============================================
// Escalado por molde (torta por capas)
// ============================================

/** Volumen de un cilindro (molde redondo). Null si falta algún dato. */
function computeMoldVolume(diameterCm, heightCm) {
  if (!diameterCm || !heightCm) return null;
  return Math.PI * (Number(diameterCm) / 2) ** 2 * Number(heightCm);
}

/** Cuánto más grande/chico es el molde objetivo respecto al de referencia. 1 si falta algún dato. */
function computeVolumeRatio(refDiameterCm, refHeightCm, targetDiameterCm, targetHeightCm) {
  const refVolume = computeMoldVolume(refDiameterCm, refHeightCm);
  const targetVolume = computeMoldVolume(targetDiameterCm, targetHeightCm);
  if (!refVolume || !targetVolume) return 1;
  return targetVolume / refVolume;
}

/**
 * Factor combinado (volumen del molde × capas) para un componente de una receta escalable.
 * `layerScaleBasis`: 'CAKE' (escala con las capas de masa, ej. Mezcla/Almíbar/Cobertura),
 * 'FILLING' (escala con las capas de relleno = capas de masa − 1, ej. Relleno/Cinta de contención),
 * o 'NONE' (no depende de la cantidad de capas).
 */
function computeComponentScaleFactor({
  refDiameterCm, refHeightCm, refLayers,
  targetDiameterCm, targetHeightCm, targetLayers,
  layerScaleBasis,
}) {
  const volumeRatio = computeVolumeRatio(refDiameterCm, refHeightCm, targetDiameterCm, targetHeightCm);

  let layerRatio = 1;
  if (layerScaleBasis === "CAKE" && refLayers && targetLayers) {
    layerRatio = targetLayers / refLayers;
  } else if (layerScaleBasis === "FILLING" && refLayers && targetLayers) {
    const refFilling = refLayers - 1;
    const targetFilling = targetLayers - 1;
    layerRatio = refFilling > 0 ? targetFilling / refFilling : 1;
  }

  return volumeRatio * layerRatio;
}

/**
 * Escala las líneas de cada componente de una receta escalable a un molde/capas
 * objetivo. Devuelve una lista PLANA de items con `quantity` ya escalada, en el
 * mismo formato que espera `computeRecipeCost`.
 *
 * `components`: [{ id, name, layer_scale_basis, items: [{ quantity, unit, supply }] }]
 */
function scaleComponents(components, { refDiameterCm, refHeightCm, refLayers, targetDiameterCm, targetHeightCm, targetLayers }) {
  const scaled = [];
  for (const component of components) {
    const scaleFactor = computeComponentScaleFactor({
      refDiameterCm, refHeightCm, refLayers,
      targetDiameterCm, targetHeightCm, targetLayers,
      layerScaleBasis: component.layer_scale_basis,
    });
    for (const item of component.items) {
      scaled.push({
        ...item,
        quantity: Number(item.quantity) * scaleFactor,
        componentId: component.id,
        componentName: component.name,
        scaleFactor,
      });
    }
  }
  return scaled;
}

// ============================================
// Acceso a datos (Postgres)
// ============================================

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
     WHERE ri.recipe_id = ANY($1::uuid[]) AND ri.component_id IS NULL`,
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

/** Componentes de una receta escalable, cada uno con su lista de insumos ya unida a `supplies`. */
async function getComponentsForRecipe(db, recipeId) {
  const compRes = await db.query(
    `SELECT id, name, layer_scale_basis, sort_order
     FROM recipe_components
     WHERE recipe_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [recipeId]
  );
  const components = compRes.rows.map((c) => ({ ...c, items: [] }));
  if (components.length === 0) return components;

  const componentIds = components.map((c) => c.id);
  const itemsRes = await db.query(
    `SELECT ri.component_id, ri.quantity, ri.unit,
            s.id AS supply_id, s.name AS supply_name, s.unit AS supply_unit,
            s.last_price_clp, s.reference_qty, s.stock_qty
     FROM recipe_items ri
     JOIN supplies s ON s.id = ri.supply_id
     WHERE ri.component_id = ANY($1::uuid[])`,
    [componentIds]
  );
  const byComponent = new Map(components.map((c) => [c.id, c]));
  for (const row of itemsRes.rows) {
    byComponent.get(row.component_id).items.push({
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
  return components;
}

/**
 * Costo de UNA receta (plana o escalable) en un molde/capas objetivo dado.
 * Si la receta no es escalable, ignora `targetDims`. Si es escalable y no se
 * pasa `targetDims`, usa el molde/capas de referencia de la receta.
 * Devuelve null si la receta no existe.
 */
async function getSingleRecipeCost(db, recipeId, targetDims = {}) {
  const r = await db.query(
    `SELECT rec.*, eq.energy_type, eq.consumption_rate
     FROM recipes rec
     LEFT JOIN kitchen_equipment eq ON eq.id = rec.equipment_id
     WHERE rec.id = $1`,
    [recipeId]
  );
  if (r.rowCount === 0) return null;
  const recipe = r.rows[0];
  const equipment = recipe.equipment_id ? { energy_type: recipe.energy_type, consumption_rate: recipe.consumption_rate } : null;
  const energyPrices = await getEnergyPrices(db);

  if (!recipe.is_scalable) {
    const itemsMap = await getItemsForRecipes(db, [recipeId]);
    const cost = computeRecipeCost({ recipe, items: itemsMap.get(recipeId) || [], equipment, ...energyPrices });
    return { ...cost, isScalable: false };
  }

  const components = await getComponentsForRecipe(db, recipeId);
  const target = {
    targetDiameterCm: targetDims.diameterCm ?? recipe.ref_diameter_cm,
    targetHeightCm: targetDims.heightCm ?? recipe.ref_height_cm,
    targetLayers: targetDims.layers ?? recipe.ref_layers,
  };
  const scaledItems = scaleComponents(components, {
    refDiameterCm: recipe.ref_diameter_cm,
    refHeightCm: recipe.ref_height_cm,
    refLayers: recipe.ref_layers,
    ...target,
  });
  const volumeRatio = computeVolumeRatio(recipe.ref_diameter_cm, recipe.ref_height_cm, target.targetDiameterCm, target.targetHeightCm);
  // Las porciones escalan con el volumen total de la torta (aproximación —
  // no tenemos densidad por componente para derivarlas del peso, como el Excel).
  const scaledPortions = Math.max(1, Math.round((Number(recipe.portions) || 1) * volumeRatio));

  const cost = computeRecipeCost({ recipe: { ...recipe, portions: scaledPortions }, items: scaledItems, equipment, ...energyPrices });
  return {
    ...cost,
    isScalable: true,
    scaledPortions,
    appliedTarget: target,
    scaledItems: scaledItems.map((it) => ({
      componentId: it.componentId,
      componentName: it.componentName,
      supplyId: it.supply.id,
      supplyName: it.supply.name,
      quantity: it.quantity,
      unit: it.unit,
    })),
  };
}

/** Trae y calcula el costo de un set de recetas en una sola pasada (listados de recetas o productos). Escalables se costean a su tamaño de referencia. */
async function getRecipeCostsByIds(db, recipeIds) {
  const ids = [...new Set(recipeIds)].filter(Boolean);
  const map = new Map();
  if (ids.length === 0) return map;

  const r = await db.query(
    `SELECT r.id, r.portions, r.baking_time_minutes, r.equipment_id, r.is_scalable,
            eq.energy_type, eq.consumption_rate
     FROM recipes r
     LEFT JOIN kitchen_equipment eq ON eq.id = r.equipment_id
     WHERE r.id = ANY($1::uuid[])`,
    [ids]
  );

  const flatIds = r.rows.filter((row) => !row.is_scalable).map((row) => row.id);
  const scalableIds = r.rows.filter((row) => row.is_scalable).map((row) => row.id);

  const [itemsMap, energyPrices] = await Promise.all([getItemsForRecipes(db, flatIds), getEnergyPrices(db)]);

  for (const row of r.rows) {
    if (row.is_scalable) continue;
    const equipment = row.equipment_id ? { energy_type: row.energy_type, consumption_rate: row.consumption_rate } : null;
    map.set(row.id, { ...computeRecipeCost({ recipe: row, items: itemsMap.get(row.id) || [], equipment, ...energyPrices }), isScalable: false });
  }

  for (const id of scalableIds) {
    const cost = await getSingleRecipeCost(db, id);
    if (cost) map.set(id, cost);
  }

  return map;
}

module.exports = {
  computeRecipeCost,
  getEnergyPrices,
  getItemsForRecipes,
  getRecipeCostsByIds,
  computeMoldVolume,
  computeVolumeRatio,
  computeComponentScaleFactor,
  scaleComponents,
  getComponentsForRecipe,
  getSingleRecipeCost,
};
