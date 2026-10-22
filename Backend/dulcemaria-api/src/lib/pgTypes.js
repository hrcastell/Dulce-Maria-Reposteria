/**
 * Parsers de tipos de node-postgres (se instalan una vez en src/db.js).
 *
 * - BIGINT (int8, OID 20): pg lo entrega como texto por defecto, y eso rompía
 *   comparaciones (p. ej. "2000000" <= "900000" es true entre strings) y los
 *   tipos `number` del panel. Se convierte a number SOLO si es un entero
 *   seguro de JavaScript; si no, se devuelve el texto original (nunca se
 *   pierde precisión). Los valores del negocio (order_no, volúmenes en CLP,
 *   COUNT(*)) están muy por debajo de 2^53.
 * - DATE (OID 1082): se deja como texto AAAA-MM-DD. Convertirlo a Date lo
 *   anclaba a la medianoche UTC y el panel mostraba "2026-10-15T03:00:00.000Z".
 *
 * NUMERIC se deja como texto (las rutas ya lo convierten explícitamente).
 */

const PG_INT8_OID = 20;
const PG_DATE_OID = 1082;

function parseInt8(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
}

function parseDateOnly(value) {
  return value === undefined ? null : value;
}

function installPgTypeParsers(types = require("pg").types) {
  types.setTypeParser(PG_INT8_OID, parseInt8);
  types.setTypeParser(PG_DATE_OID, parseDateOnly);
}

module.exports = { PG_INT8_OID, PG_DATE_OID, parseInt8, parseDateOnly, installPgTypeParsers };
