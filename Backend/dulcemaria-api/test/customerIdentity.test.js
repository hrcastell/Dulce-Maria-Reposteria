const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePhoneDigits,
  phoneMatchKeys,
  normalizePersonName,
  pickReusableWebCustomer,
} = require("../src/lib/customerIdentity");

test("normalizePhoneDigits deja solo dígitos", () => {
  assert.equal(normalizePhoneDigits("+56 9 1234-5678"), "56912345678");
  assert.equal(normalizePhoneDigits("(9) 1234 5678"), "912345678");
  assert.equal(normalizePhoneDigits(null), "");
});

test("phoneMatchKeys trata igual el número con y sin código de país de Chile", () => {
  assert.deepEqual(phoneMatchKeys("+56 9 1234 5678").sort(), ["56912345678", "912345678"]);
  assert.deepEqual(phoneMatchKeys("9 1234 5678").sort(), ["56912345678", "912345678"]);
  assert.deepEqual(phoneMatchKeys("22 123 4567").sort(), ["221234567", "56221234567"]);
  assert.deepEqual(phoneMatchKeys("+1 415 555 0100"), ["14155550100"]);
  assert.deepEqual(phoneMatchKeys("sin numero"), []);
});

test("normalizePersonName ignora mayúsculas, tildes y espacios repetidos", () => {
  assert.equal(normalizePersonName("  José   PÉREZ "), "jose perez");
  assert.equal(normalizePersonName("Ñuñoa"), "nunoa");
  assert.equal(normalizePersonName(undefined), "");
});

test("pickReusableWebCustomer reutiliza solo con el mismo nombre y sin choque de correo", () => {
  const candidates = [
    { id: "a", full_name: "Jose Perez", email: null },
    { id: "b", full_name: "Ana Rojas", email: "ana@correo.cl" },
  ];
  assert.equal(pickReusableWebCustomer(candidates, { name: "José Pérez", email: "jose@correo.cl" }).id, "a");
  assert.equal(pickReusableWebCustomer(candidates, { name: "ana rojas", email: "ANA@correo.cl" }).id, "b");
  assert.equal(pickReusableWebCustomer(candidates, { name: "Ana Rojas", email: "otra@correo.cl" }), null);
  assert.equal(pickReusableWebCustomer(candidates, { name: "Ana Rojas", email: null }).id, "b");
  assert.equal(pickReusableWebCustomer(candidates, { name: "Pedro Soto", email: null }), null);
  assert.equal(pickReusableWebCustomer([], { name: "Jose Perez" }), null);
});
