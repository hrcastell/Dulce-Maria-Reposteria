const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_CLP,
  clpAmount,
  searchTerm,
  isoDateOrDateTime,
  statusFilter,
  optionalQueryNumber,
  optionalQuery,
} = require("../src/lib/schemas");

test("optionalQuery trata el parámetro vacío como ausente", () => {
  const schema = optionalQuery(isoDateOrDateTime);
  assert.equal(schema.parse(undefined), undefined);
  assert.equal(schema.parse(""), undefined);
  assert.equal(schema.parse("2026-02-06"), "2026-02-06");
  assert.equal(schema.safeParse("ayer").success, false);
});

test("clpAmount acepta enteros 0..MAX_CLP y rechaza negativos, decimales y desbordes", () => {
  assert.equal(MAX_CLP, 100000000);
  assert.equal(clpAmount().safeParse(0).success, true);
  assert.equal(clpAmount().safeParse(MAX_CLP).success, true);
  assert.equal(clpAmount().safeParse(MAX_CLP + 1).success, false);
  assert.equal(clpAmount().safeParse(-1).success, false);
  assert.equal(clpAmount().safeParse(10.5).success, false);
  assert.equal(clpAmount().safeParse(2 ** 31).success, false);
});

test("searchTerm recorta y limita a 100 caracteres", () => {
  assert.equal(searchTerm.parse("  torta  "), "torta");
  assert.equal(searchTerm.safeParse("x".repeat(101)).success, false);
  assert.equal(searchTerm.safeParse(["a", "b"]).success, false, "un parámetro repetido no es texto");
});

test("isoDateOrDateTime acepta fechas y fechas-hora ISO, nada más", () => {
  for (const ok of ["2026-02-06", "2026-02-06T00:00:00Z", "2026-02-06T10:30", "2026-02-06T10:30:00.123-03:00"]) {
    assert.equal(isoDateOrDateTime.safeParse(ok).success, true, ok);
  }
  for (const bad of ["06/02/2026", "2026-13-40", "mañana", "2026-02-06'; DROP TABLE x;--", ""]) {
    assert.equal(isoDateOrDateTime.safeParse(bad).success, false, bad);
  }
});

test("statusFilter solo acepta identificadores de estado en mayúsculas", () => {
  assert.equal(statusFilter.safeParse("PENDING_PAYMENT").success, true);
  assert.equal(statusFilter.safeParse("pending").success, false);
  assert.equal(statusFilter.safeParse("A".repeat(41)).success, false);
});

test("optionalQueryNumber convierte texto numérico y respeta los límites", () => {
  const schema = optionalQueryNumber({ min: 1, max: 1000 });
  assert.equal(schema.parse(undefined), undefined);
  assert.equal(schema.parse(""), undefined);
  assert.equal(schema.parse("25.5"), 25.5);
  assert.equal(schema.safeParse("0").success, false);
  assert.equal(schema.safeParse("abc").success, false);
  assert.equal(schema.safeParse("1001").success, false);
  const integer = optionalQueryNumber({ min: 1, max: 10, int: true });
  assert.equal(integer.safeParse("2.5").success, false);
  assert.equal(integer.parse("3"), 3);
});
