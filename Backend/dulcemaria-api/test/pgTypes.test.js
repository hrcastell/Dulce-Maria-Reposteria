const test = require("node:test");
const assert = require("node:assert/strict");

const { PG_INT8_OID, PG_DATE_OID, parseInt8, parseDateOnly, installPgTypeParsers } = require("../src/lib/pgTypes");

test("parseInt8 convierte BIGINT a number mientras sea un entero seguro", () => {
  assert.equal(parseInt8("0"), 0);
  assert.equal(parseInt8("123"), 123);
  assert.equal(parseInt8("-5"), -5);
  assert.equal(parseInt8("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseInt8(null), null);
});

test("parseInt8 nunca pierde precisión: fuera del rango seguro devuelve el texto original", () => {
  assert.equal(parseInt8("9007199254740993"), "9007199254740993");
  assert.equal(parseInt8("-9223372036854775808"), "-9223372036854775808");
});

test("parseDateOnly deja DATE como texto AAAA-MM-DD (sin corrimiento por zona horaria)", () => {
  assert.equal(parseDateOnly("2026-10-15"), "2026-10-15");
  assert.equal(parseDateOnly(null), null);
});

test("installPgTypeParsers registra los parsers de int8 y date", () => {
  const registered = new Map();
  installPgTypeParsers({ setTypeParser: (oid, fn) => registered.set(oid, fn) });
  assert.equal(PG_INT8_OID, 20);
  assert.equal(PG_DATE_OID, 1082);
  assert.equal(registered.get(20)("42"), 42);
  assert.equal(registered.get(1082)("2026-01-02"), "2026-01-02");
});
