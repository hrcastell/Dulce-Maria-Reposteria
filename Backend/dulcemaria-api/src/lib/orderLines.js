/**
 * Líneas de una orden: validación y precio desde la base de datos (nunca desde
 * el cliente), compartido por el panel (POST/PUT /admin/orders) y el checkout
 * público (POST /public/orders).
 *
 * Reglas (B-24):
 *   - producto inexistente o inactivo → rechazado;
 *   - si el producto tiene variantes activas hay que elegir una; si todas sus
 *     variantes están inactivas no se puede vender (su stock vive en ellas);
 *   - variante y toppings deben estar activos y pertenecer al producto;
 *   - un topping repetido en la misma línea se rechaza (antes se cobraba doble).
 */

const crypto = require("crypto");
const { appError } = require("./httpErrors");
const { MAX_CLP } = require("./schemas");

function parseToppings(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Identidad de una línea pedida: producto + variante + toppings (sin orden). */
function lineIdentityKey({ productId, variantId, toppings }) {
  const ids = [...(toppings || [])].map(String).sort();
  return `${productId}|${variantId || "-"}|${ids.join(",")}`;
}

/** Identidad de una línea ya guardada (order_items). Variante borrada ≠ sin variante. */
function storedLineIdentityKey(row) {
  const toppingIds = parseToppings(row.selected_toppings).map((t) => String(t?.id));
  const variantPart = row.variant_id || (row.variant_name ? `gone:${row.variant_name}` : "-");
  return `${row.product_id}|${variantPart}|${toppingIds.sort().join(",")}`;
}

/**
 * Valida y pone precio a las líneas pedidas a partir de las filas leídas de
 * la base. Pura: lanza AppError 400 ante cualquier problema.
 * @returns {{ lines: Array, subtotal: number }}
 */
function buildOrderLines({ items, products, variants, toppings, allowToppings }) {
  const productsById = new Map(products.map((p) => [p.id, p]));
  const variantsById = new Map(variants.map((v) => [v.id, v]));
  const variantsByProduct = new Map();
  for (const v of variants) {
    if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
    variantsByProduct.get(v.product_id).push(v);
  }
  const toppingsById = new Map((toppings || []).map((t) => [t.id, t]));

  const lines = [];
  let subtotal = 0;
  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) throw appError(400, "PRODUCT_UNAVAILABLE", "Uno de los productos ya no está disponible.");
    if (!product.is_active) throw appError(400, "PRODUCT_UNAVAILABLE", `El producto "${product.name}" no está disponible.`);

    let unitPrice = Number(product.price_clp);
    let variant = null;
    if (item.variantId) {
      variant = variantsById.get(item.variantId);
      if (!variant || variant.product_id !== product.id || !variant.is_active) {
        throw appError(400, "VARIANT_UNAVAILABLE", `La variante elegida para "${product.name}" no está disponible.`);
      }
      if (variant.price_override_clp !== null && variant.price_override_clp !== undefined) {
        unitPrice = Number(variant.price_override_clp);
      }
    } else {
      const productVariants = variantsByProduct.get(product.id) || [];
      if (productVariants.some((v) => v.is_active)) {
        throw appError(400, "VARIANT_REQUIRED", `Debes seleccionar una variante para "${product.name}".`);
      }
      if (productVariants.length > 0) {
        throw appError(400, "PRODUCT_UNAVAILABLE", `El producto "${product.name}" no tiene variantes disponibles.`);
      }
    }

    const toppingIds = item.toppings || [];
    if (toppingIds.length && !allowToppings) {
      throw appError(400, "TOPPINGS_NOT_ALLOWED", "Este canal no admite toppings.");
    }
    if (new Set(toppingIds).size !== toppingIds.length) {
      throw appError(400, "TOPPING_DUPLICATED", `Hay un topping repetido en "${product.name}".`);
    }
    const selectedToppings = [];
    for (const toppingId of toppingIds) {
      const topping = toppingsById.get(toppingId);
      if (!topping || topping.product_id !== product.id || !topping.is_active) {
        throw appError(400, "TOPPING_UNAVAILABLE", `Uno de los toppings de "${product.name}" no está disponible.`);
      }
      const price = Number(topping.price_clp) || 0;
      if (price > 0) unitPrice += price;
      selectedToppings.push({ id: topping.id, name: topping.name, price });
    }

    const lineTotal = unitPrice * item.qty;
    subtotal += lineTotal;
    lines.push({
      productId: product.id,
      productName: product.name,
      variantId: variant ? variant.id : null,
      variantName: variant ? variant.name : null,
      selectedToppings: selectedToppings.length ? selectedToppings : null,
      unitPrice,
      qty: item.qty,
      lineTotal,
    });
  }
  return { lines, subtotal };
}

/**
 * Edición de una orden (B-23): cada línea pedida que coincide en identidad
 * con una línea guardada conserva su precio y nombre guardados (no se
 * re-cotiza a los precios de hoy); las demás son nuevas y se cotizan.
 * Las coincidencias son uno a uno y en orden.
 * @returns {{ slots: Array<{kind:'kept', line:object} | {kind:'new', item:object}> }}
 */
function planOrderEdit(storedLines, items) {
  const pool = new Map();
  for (const row of storedLines) {
    const key = storedLineIdentityKey(row);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(row);
  }
  const slots = items.map((item) => {
    const candidates = pool.get(lineIdentityKey(item));
    const row = candidates && candidates.shift();
    if (!row) return { kind: "new", item };
    const toppings = parseToppings(row.selected_toppings);
    const unitPrice = Number(row.unit_price_clp);
    return {
      kind: "kept",
      line: {
        productId: row.product_id,
        productName: row.product_name_snapshot,
        variantId: row.variant_id,
        variantName: row.variant_name,
        selectedToppings: toppings.length ? toppings : null,
        unitPrice,
        qty: item.qty,
        lineTotal: unitPrice * item.qty,
      },
    };
  });
  return { slots };
}

/**
 * Totales de una orden en CLP enteros: subtotal + despacho − descuento (nunca
 * negativo); un precio final manual (solo ADMIN) reemplaza el resultado.
 */
function computeOrderTotals({ subtotal, deliveryFeeClp = 0, discountAmountClp = 0, finalPriceOverrideClp = null }) {
  const deliveryFee = Number(deliveryFeeClp || 0);
  const discount = Number(discountAmountClp || 0);
  const finalPriceOverride = finalPriceOverrideClp === undefined || finalPriceOverrideClp === null ? null : Number(finalPriceOverrideClp);
  const computed = Math.max(0, Number(subtotal) + deliveryFee - discount);
  const total = finalPriceOverride === null ? computed : finalPriceOverride;
  for (const value of [subtotal, deliveryFee, discount, total]) {
    if (!Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > MAX_CLP) {
      throw appError(400, "ORDER_TOTAL_INVALID", "El total de la orden está fuera del rango permitido.");
    }
  }
  return { subtotal: Number(subtotal), deliveryFee, discount, finalPriceOverride, total };
}

/**
 * Lee y bloquea (FOR UPDATE, en orden de id: productos y luego variantes,
 * el mismo orden que orderStock.js) y valida/cotiza las líneas.
 */
async function resolveOrderLines(client, items, { allowToppings = true } = {}) {
  const productIds = [...new Set(items.map((item) => item.productId))].sort();
  const productsResult = await client.query(
    `SELECT id, name, price_clp, is_active FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [productIds]
  );
  const variantsResult = await client.query(
    `SELECT id, product_id, name, price_override_clp, is_active
     FROM product_variants WHERE product_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
    [productIds]
  );
  const toppingIds = [...new Set(items.flatMap((item) => item.toppings || []))];
  const toppingsResult = toppingIds.length
    ? await client.query(
        `SELECT id, product_id, name, price_clp, is_active FROM product_toppings WHERE id = ANY($1::uuid[])`,
        [toppingIds]
      )
    : { rows: [] };
  return buildOrderLines({
    items,
    products: productsResult.rows,
    variants: variantsResult.rows,
    toppings: toppingsResult.rows,
    allowToppings,
  });
}

/** Líneas guardadas de una orden, en el orden en que se cargaron. */
async function loadOrderLines(client, orderId) {
  const r = await client.query(
    `SELECT product_id, product_name_snapshot, variant_id, variant_name, selected_toppings,
            unit_price_clp, qty, line_total_clp
     FROM order_items WHERE order_id = $1
     ORDER BY created_at ASC, id ASC`,
    [orderId]
  );
  return r.rows;
}

/** Inserta las líneas (clock_timestamp conserva el orden de carga dentro de la transacción). */
async function insertOrderLines(client, orderId, lines) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO order_items (
         id, order_id, product_id, product_name_snapshot, variant_id, variant_name, selected_toppings,
         unit_price_clp, qty, line_total_clp, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`,
      [
        crypto.randomUUID(),
        orderId,
        line.productId,
        line.productName,
        line.variantId || null,
        line.variantName || null,
        line.selectedToppings ? JSON.stringify(line.selectedToppings) : null,
        line.unitPrice,
        line.qty,
        line.lineTotal,
      ]
    );
  }
}

module.exports = {
  buildOrderLines,
  lineIdentityKey,
  storedLineIdentityKey,
  planOrderEdit,
  computeOrderTotals,
  resolveOrderLines,
  loadOrderLines,
  insertOrderLines,
};
