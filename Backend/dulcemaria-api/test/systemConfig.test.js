const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getBakeryConfigPolicy,
  canAccessBakeryConfig,
  parseBakeryConfigValue,
} = require("../src/lib/systemConfig");

test("solo las claves de la panadería tienen política; el Motor de Tarifa queda fuera", () => {
  for (const key of ["cake_base_price", "energy_price_kwh", "energy_price_gas", "gas_canister_kg", "gas_canister_price_clp"]) {
    assert.ok(getBakeryConfigPolicy(key), key);
  }
  for (const key of [
    "platform_fee_default_clp",
    "platform_fee_engine_activated_at",
    "platform_fee_cualquier_cosa",
    "clave_inventada",
    "__proto__",
    "constructor",
    "toString",
  ]) {
    assert.equal(getBakeryConfigPolicy(key), null, key);
  }
});

test("STAFF puede leer pero no escribir; ADMIN y SUPERADMIN pueden ambas", () => {
  assert.equal(canAccessBakeryConfig("energy_price_kwh", "STAFF", "read"), true);
  assert.equal(canAccessBakeryConfig("energy_price_kwh", "STAFF", "write"), false);
  assert.equal(canAccessBakeryConfig("energy_price_kwh", "ADMIN", "write"), true);
  assert.equal(canAccessBakeryConfig("cake_base_price", "SUPERADMIN", "write"), true);
  assert.equal(canAccessBakeryConfig("platform_fee_default_clp", "SUPERADMIN", "read"), false);
  assert.equal(canAccessBakeryConfig("platform_fee_default_clp", "SUPERADMIN", "write"), false);
});

test("los valores enteros en CLP se validan y normalizan", () => {
  assert.deepEqual(parseBakeryConfigValue("cake_base_price", "30000"), { ok: true, value: "30000" });
  assert.deepEqual(parseBakeryConfigValue("cake_base_price", "030000"), { ok: true, value: "30000" });
  assert.deepEqual(parseBakeryConfigValue("cake_base_price", 25000), { ok: true, value: "25000" });
  assert.equal(parseBakeryConfigValue("cake_base_price", "12.5").ok, false);
  assert.equal(parseBakeryConfigValue("cake_base_price", "-1").ok, false);
  assert.equal(parseBakeryConfigValue("cake_base_price", "100000001").ok, false);
  assert.equal(parseBakeryConfigValue("gas_canister_price_clp", "abc").ok, false);
});

test("los valores decimales aceptan punto y rechazan exponentes o texto", () => {
  assert.deepEqual(parseBakeryConfigValue("energy_price_kwh", "185.5"), { ok: true, value: "185.5" });
  assert.deepEqual(parseBakeryConfigValue("gas_canister_kg", "15"), { ok: true, value: "15" });
  assert.deepEqual(parseBakeryConfigValue("energy_price_gas", "0"), { ok: true, value: "0" });
  assert.equal(parseBakeryConfigValue("energy_price_kwh", "1e3").ok, false);
  assert.equal(parseBakeryConfigValue("energy_price_kwh", "").ok, false);
  assert.equal(parseBakeryConfigValue("energy_price_kwh", "Infinity").ok, false);
  assert.equal(parseBakeryConfigValue("gas_canister_kg", "1001").ok, false);
});

test("los errores de valor son strings en español", () => {
  const result = parseBakeryConfigValue("cake_base_price", "nope");
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.match(result.error, /cake_base_price/);
});

test("una clave desconocida nunca valida", () => {
  assert.equal(parseBakeryConfigValue("platform_fee_default_clp", "0").ok, false);
});
