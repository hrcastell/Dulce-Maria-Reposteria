const test = require("node:test");
const assert = require("node:assert/strict");

const { needsRehash, hashPassword, verifyPassword, BCRYPT_TARGET_COST } = require("../src/utils/password");

test("el costo objetivo de bcrypt es 12", () => {
  assert.equal(BCRYPT_TARGET_COST, 12);
});

test("needsRehash detecta hashes PBKDF2 heredados", () => {
  assert.equal(needsRehash("pbkdf2$sha256$150000$abcd$ef01"), true);
});

test("needsRehash detecta bcrypt con costo menor a 12", () => {
  assert.equal(needsRehash("$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234"), true);
  assert.equal(needsRehash("$2b$11$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234"), true);
});

test("needsRehash no toca bcrypt con costo 12 o mayor", () => {
  assert.equal(needsRehash("$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234"), false);
  assert.equal(needsRehash("$2y$13$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234"), false);
});

test("needsRehash ignora valores vacíos o desconocidos", () => {
  assert.equal(needsRehash(""), false);
  assert.equal(needsRehash(null), false);
  assert.equal(needsRehash("texto-plano"), false);
});

test("needsRehash no fuerza rehash de PBKDF2 si bcrypt no está disponible", () => {
  assert.equal(needsRehash("pbkdf2$sha256$150000$abcd$ef01", { bcryptAvailable: false }), false);
});

test("hashPassword genera bcrypt costo 12 verificable", async () => {
  const hash = await hashPassword("una-clave-de-prueba-larga");
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyPassword("una-clave-de-prueba-larga", hash), true);
  assert.equal(await verifyPassword("otra-clave", hash), false);
  assert.equal(needsRehash(hash), false);
});
