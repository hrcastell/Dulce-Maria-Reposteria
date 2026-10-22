const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SANTIAGO_TZ,
  isIsoDate,
  santiagoToday,
  santiagoYearMonth,
  addDaysToIsoDate,
  diffIsoDays,
  dayRange,
  monthRange,
  yearRange,
  resolveDateRangeFilter,
  buildTimestampRangeClauses,
  santiagoMidnightSql,
  validateDeliveryDate,
  validateOrderDate,
} = require("../src/lib/santiagoTime");

test("la zona horaria del negocio es America/Santiago", () => {
  assert.equal(SANTIAGO_TZ, "America/Santiago");
});

test("isIsoDate acepta solo fechas de calendario válidas en formato AAAA-MM-DD", () => {
  assert.equal(isIsoDate("2026-10-21"), true);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("2026-04-31"), false);
  assert.equal(isIsoDate("2026-1-01"), false);
  assert.equal(isIsoDate("2026-10-21T00:00:00Z"), false);
  assert.equal(isIsoDate(""), false);
  assert.equal(isIsoDate(null), false);
  assert.equal(isIsoDate(20261021), false);
});

test("santiagoToday usa la fecha de Chile, no la UTC", () => {
  // Horario de verano (UTC-3): 02:30Z del 22 = 23:30 del 21 en Santiago.
  assert.equal(santiagoToday(new Date("2026-10-22T02:30:00Z")), "2026-10-21");
  assert.equal(santiagoToday(new Date("2026-10-22T03:30:00Z")), "2026-10-22");
  // Horario de invierno (UTC-4): 03:30Z del 1 de julio = 23:30 del 30 de junio.
  assert.equal(santiagoToday(new Date("2026-07-01T03:30:00Z")), "2026-06-30");
});

test("santiagoYearMonth devuelve el mes calendario de Chile", () => {
  assert.deepEqual(santiagoYearMonth(new Date("2026-11-01T02:00:00Z")), { year: 2026, month: 10 });
  assert.deepEqual(santiagoYearMonth(new Date("2027-01-01T05:00:00Z")), { year: 2027, month: 1 });
});

test("addDaysToIsoDate y diffIsoDays operan sobre fechas sin hora", () => {
  assert.equal(addDaysToIsoDate("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToIsoDate("2024-02-28", 1), "2024-02-29");
  assert.equal(addDaysToIsoDate("2026-03-01", -1), "2026-02-28");
  assert.equal(diffIsoDays("2026-10-31", "2026-10-21"), 10);
  assert.equal(diffIsoDays("2026-10-21", "2026-10-31"), -10);
  assert.throws(() => addDaysToIsoDate("2026-02-30", 1));
});

test("los rangos de día, mes y año son medio abiertos [inicio, fin)", () => {
  assert.deepEqual(dayRange("2026-10-21"), { start: "2026-10-21", end: "2026-10-22" });
  assert.deepEqual(monthRange(2026, 12), { start: "2026-12-01", end: "2027-01-01" });
  assert.deepEqual(monthRange(2026, 2), { start: "2026-02-01", end: "2026-03-01" });
  assert.deepEqual(yearRange(2026), { start: "2026-01-01", end: "2027-01-01" });
});

test("resolveDateRangeFilter: un 'hasta' de solo fecha incluye ese día completo", () => {
  assert.deepEqual(resolveDateRangeFilter({ from: "2026-10-01", to: "2026-10-31" }), {
    from: { kind: "date", value: "2026-10-01" },
    to: { kind: "date", value: "2026-11-01" },
  });
});

test("resolveDateRangeFilter: los instantes ISO se respetan tal cual (fin exclusivo)", () => {
  assert.deepEqual(resolveDateRangeFilter({ from: "2026-10-01T10:00:00Z", to: "2026-10-02T00:00:00Z" }), {
    from: { kind: "instant", value: "2026-10-01T10:00:00Z" },
    to: { kind: "instant", value: "2026-10-02T00:00:00Z" },
  });
  assert.deepEqual(resolveDateRangeFilter({}), { from: null, to: null });
});

test("buildTimestampRangeClauses ancla las fechas a la medianoche de Santiago", () => {
  const filter = resolveDateRangeFilter({ from: "2026-10-01", to: "2026-10-02T12:00:00Z" });
  const { clauses, values } = buildTimestampRangeClauses("o.created_at", filter, 3);
  assert.deepEqual(values, ["2026-10-01", "2026-10-02T12:00:00Z"]);
  assert.equal(clauses[0], `o.created_at >= ${santiagoMidnightSql("$3")}`);
  assert.equal(clauses[1], "o.created_at < $4::timestamptz");
  assert.match(santiagoMidnightSql("$3"), /\(\$3::date\)::timestamp AT TIME ZONE 'America\/Santiago'/);
});

test("buildTimestampRangeClauses rechaza nombres de columna no seguros", () => {
  assert.throws(() => buildTimestampRangeClauses("o.created_at; DROP TABLE x", { from: null, to: null }, 1));
});

test("validateDeliveryDate: no admite fechas pasadas ni demasiado lejanas", () => {
  const today = "2026-10-21";
  assert.deepEqual(validateDeliveryDate("2026-10-21", { today }), { ok: true });
  assert.deepEqual(validateDeliveryDate("2027-04-19", { today }), { ok: true });
  assert.equal(validateDeliveryDate("2026-10-20", { today }).ok, false);
  assert.match(validateDeliveryDate("2026-10-20", { today }).error, /pasad/);
  assert.equal(validateDeliveryDate("2027-04-20", { today }).ok, false);
  assert.equal(validateDeliveryDate("2026-02-30", { today }).ok, false);
  assert.deepEqual(validateDeliveryDate("2026-10-25", { today, maxDaysAhead: 3 }).ok, false);
});

test("validateOrderDate: sin fechas futuras y como máximo un año hacia atrás", () => {
  const today = "2026-10-21";
  assert.deepEqual(validateOrderDate("2026-10-21", { today }), { ok: true });
  assert.deepEqual(validateOrderDate("2025-10-21", { today }), { ok: true });
  assert.equal(validateOrderDate("2026-10-22", { today }).ok, false);
  assert.match(validateOrderDate("2026-10-22", { today }).error, /futur/);
  assert.equal(validateOrderDate("2025-10-20", { today }).ok, false);
  assert.equal(validateOrderDate("no-es-fecha", { today }).ok, false);
});
