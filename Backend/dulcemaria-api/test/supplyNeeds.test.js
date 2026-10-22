const test = require("node:test");
const assert = require("node:assert/strict");

const { aggregateSupplyNeeds, findInsufficientSupplies, computeRecipeCost } = require("../src/lib/recipeCost");

const sugarInBatter = { supply_id: "s1", supply_name: "Azúcar", supply_unit: "g", quantity: 200, unit: "g", stock_qty: 300 };
const sugarInSyrup = { supply_id: "s1", supply_name: "Azúcar", supply_unit: "g", quantity: 0.2, unit: "kg", stock_qty: 300 };
const flour = { supply_id: "s2", supply_name: "Harina", supply_unit: "kg", quantity: 500, unit: "g", stock_qty: "5.000" };

test("aggregateSupplyNeeds suma por insumo (en su unidad) antes de validar", () => {
  const needs = aggregateSupplyNeeds([sugarInBatter, sugarInSyrup, flour], 2);
  assert.deepEqual(needs, [
    { supplyId: "s1", name: "Azúcar", unit: "g", amount: 800, stock: 300 },
    { supplyId: "s2", name: "Harina", unit: "kg", amount: 1, stock: 5 },
  ]);
});

test("aggregateSupplyNeeds redondea a 3 decimales (precisión de supplies.stock_qty)", () => {
  const needs = aggregateSupplyNeeds([
    { supply_id: "s3", supply_name: "Leche", supply_unit: "l", quantity: 0.1, unit: "l", stock_qty: 1 },
    { supply_id: "s3", supply_name: "Leche", supply_unit: "l", quantity: 0.2, unit: "l", stock_qty: 1 },
  ], 1);
  assert.equal(needs[0].amount, 0.3);
});

test("findInsufficientSupplies detecta el insumo que una validación por línea dejaba pasar", () => {
  const needs = aggregateSupplyNeeds([sugarInBatter, sugarInSyrup], 1);
  assert.deepEqual(findInsufficientSupplies(needs).map((n) => n.supplyId), ["s1"]);
  assert.deepEqual(findInsufficientSupplies(aggregateSupplyNeeds([flour], 1)), []);
});

test("unidades incompatibles siguen fallando con 400", () => {
  assert.throws(
    () => aggregateSupplyNeeds([{ supply_id: "s1", supply_name: "Huevos", supply_unit: "unidad", quantity: 1, unit: "kg", stock_qty: 10 }], 1),
    (err) => err.statusCode === 400
  );
});

test("computeRecipeCost: maxBatches considera el total por insumo, no cada línea por separado", () => {
  const supply = { id: "s1", unit: "g", last_price_clp: 1000, reference_qty: 1000, stock_qty: 600 };
  const cost = computeRecipeCost({
    recipe: { portions: 1 },
    items: [
      { quantity: 200, unit: "g", supply },
      { quantity: 200, unit: "g", supply },
    ],
    equipment: null,
  });
  assert.equal(cost.maxBatches, 1);
});
