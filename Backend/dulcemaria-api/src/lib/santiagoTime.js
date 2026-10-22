/**
 * Fechas del negocio en America/Santiago (Chile).
 *
 * Los límites de día/mes/año de reportes, gastos y filtros nunca dependen de
 * la zona horaria de la sesión de PostgreSQL ni del servidor de Node (en el
 * hosting suelen ser UTC). Regla: las fechas "de calendario" (AAAA-MM-DD)
 * viajan como texto y se convierten a instante en SQL con
 * `(fecha)::timestamp AT TIME ZONE 'America/Santiago'` (medianoche chilena).
 * Funciones puras salvo las que leen el reloj (aceptan `now` para pruebas).
 */

const SANTIAGO_TZ = "America/Santiago";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SQL_COLUMN = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;
const SQL_PARAM = /^\$\d{1,3}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Días máximos hacia adelante para una fecha de entrega preferida.
const MAX_DELIVERY_DAYS_AHEAD = 180;
// Días máximos hacia atrás para registrar una venta con otra fecha (panel).
const MAX_ORDER_BACKDATE_DAYS = 365;

const santiagoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SANTIAGO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** true si es una fecha de calendario real con formato AAAA-MM-DD. */
function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertIsoDate(value) {
  if (!isIsoDate(value)) throw new Error(`Fecha inválida: ${value}`);
}

function isoDateToUtcMs(value) {
  assertIsoDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function utcMsToIsoDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Fecha de hoy (AAAA-MM-DD) en Santiago. */
function santiagoToday(now = new Date()) {
  return santiagoDateFormatter.format(now);
}

/** Año y mes calendario actuales en Santiago. */
function santiagoYearMonth(now = new Date()) {
  const [year, month] = santiagoToday(now).split("-").map(Number);
  return { year, month };
}

function addDaysToIsoDate(isoDate, days) {
  return utcMsToIsoDate(isoDateToUtcMs(isoDate) + Number(days) * DAY_MS);
}

/** Días de diferencia a − b entre dos fechas de calendario. */
function diffIsoDays(a, b) {
  return Math.round((isoDateToUtcMs(a) - isoDateToUtcMs(b)) / DAY_MS);
}

function monthStart(year, month) {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-01`;
}

function dayRange(isoDate) {
  return { start: isoDate, end: addDaysToIsoDate(isoDate, 1) };
}

function monthRange(year, month) {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { start: monthStart(year, month), end: monthStart(nextYear, nextMonth) };
}

function yearRange(year) {
  return { start: monthStart(year, 1), end: monthStart(year + 1, 1) };
}

/** Medianoche de Santiago del parámetro (una fecha AAAA-MM-DD) como instante. */
function santiagoMidnightSql(paramRef) {
  if (!SQL_PARAM.test(paramRef)) throw new Error(`Parámetro SQL inválido: ${paramRef}`);
  return `(${paramRef}::date)::timestamp AT TIME ZONE '${SANTIAGO_TZ}'`;
}

/** Expresión SQL de la fecha de calendario de Santiago de una columna timestamptz. */
function santiagoDateSql(column) {
  if (!SQL_COLUMN.test(column)) throw new Error(`Columna SQL inválida: ${column}`);
  return `(${column} AT TIME ZONE '${SANTIAGO_TZ}')::date`;
}

/**
 * Filtro ?from&to: fechas de calendario en Santiago (el "hasta" de solo fecha
 * incluye ese día completo) o instantes ISO (se respetan, con fin exclusivo).
 */
function resolveDateRangeFilter({ from, to } = {}) {
  const bound = (value, isEnd) => {
    if (value === undefined || value === null || value === "") return null;
    if (isIsoDate(value)) return { kind: "date", value: isEnd ? addDaysToIsoDate(value, 1) : value };
    return { kind: "instant", value };
  };
  return { from: bound(from, false), to: bound(to, true) };
}

/** Cláusulas SQL parametrizadas para un filtro resuelto con resolveDateRangeFilter. */
function buildTimestampRangeClauses(column, filter, firstParamIndex) {
  if (!SQL_COLUMN.test(column)) throw new Error(`Columna SQL inválida: ${column}`);
  const clauses = [];
  const values = [];
  let n = firstParamIndex;
  for (const [bound, op] of [[filter?.from, ">="], [filter?.to, "<"]]) {
    if (!bound) continue;
    const ref = `$${n++}`;
    clauses.push(bound.kind === "date" ? `${column} ${op} ${santiagoMidnightSql(ref)}` : `${column} ${op} ${ref}::timestamptz`);
    values.push(bound.value);
  }
  return { clauses, values };
}

/** Fecha de entrega preferida: entre hoy (Santiago) y `maxDaysAhead` días más. */
function validateDeliveryDate(value, { today = santiagoToday(), maxDaysAhead = MAX_DELIVERY_DAYS_AHEAD } = {}) {
  if (!isIsoDate(value)) return { ok: false, error: "La fecha de entrega no es válida (usa AAAA-MM-DD)." };
  const ahead = diffIsoDays(value, today);
  if (ahead < 0) return { ok: false, error: "La fecha de entrega no puede estar en el pasado." };
  if (ahead > maxDaysAhead) {
    return { ok: false, error: `La fecha de entrega puede ser como máximo ${maxDaysAhead} días desde hoy.` };
  }
  return { ok: true };
}

/** Fecha de una venta registrada en el panel: no futura y no más antigua que `maxDaysBack`. */
function validateOrderDate(value, { today = santiagoToday(), maxDaysBack = MAX_ORDER_BACKDATE_DAYS } = {}) {
  if (!isIsoDate(value)) return { ok: false, error: "La fecha de la venta no es válida (usa AAAA-MM-DD)." };
  const back = diffIsoDays(today, value);
  if (back < 0) return { ok: false, error: "La fecha de la venta no puede ser futura." };
  if (back > maxDaysBack) {
    return { ok: false, error: `La fecha de la venta puede tener como máximo ${maxDaysBack} días de antigüedad.` };
  }
  return { ok: true };
}

module.exports = {
  SANTIAGO_TZ,
  MAX_DELIVERY_DAYS_AHEAD,
  MAX_ORDER_BACKDATE_DAYS,
  isIsoDate,
  santiagoToday,
  santiagoYearMonth,
  addDaysToIsoDate,
  diffIsoDays,
  dayRange,
  monthRange,
  yearRange,
  santiagoMidnightSql,
  santiagoDateSql,
  resolveDateRangeFilter,
  buildTimestampRangeClauses,
  validateDeliveryDate,
  validateOrderDate,
};
