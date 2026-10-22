/**
 * Piezas zod compartidas para validar la frontera HTTP (cuerpo y query).
 * Los límites evitan desbordes de columnas INT (error de PostgreSQL → 500) y
 * consultas o transacciones desproporcionadas.
 */

const { z } = require("zod");

// Monto máximo aceptado en un campo *_clp (cabe holgado en INT de PostgreSQL).
const MAX_CLP = 100000000;

const ISO_DATE_OR_DATETIME =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** Entero en CLP entre 0 y MAX_CLP. */
function clpAmount() {
  return z.number().int().nonnegative().max(MAX_CLP);
}

/** Texto de búsqueda (?q=): recortado y acotado. */
const searchTerm = z.string().trim().max(100);

/** Fecha (AAAA-MM-DD) o fecha-hora ISO 8601 válida. */
const isoDateOrDateTime = z
  .string()
  .trim()
  .regex(ISO_DATE_OR_DATETIME, "Fecha inválida: usa AAAA-MM-DD o ISO 8601.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Fecha inválida.");

/** Filtro de estado: identificador en mayúsculas (la lista válida la decide cada dominio). */
const statusFilter = z.string().trim().regex(/^[A-Z_]{1,40}$/, "Estado inválido.");

/** Parámetro de query opcional: un valor vacío (?x=) cuenta como ausente. */
function optionalQuery(schema) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

/**
 * Número opcional recibido como texto en la query (?x=12.5). Vacío = ausente.
 * @param {{ min?: number, max?: number, int?: boolean }} [bounds]
 */
function optionalQueryNumber({ min = -Infinity, max = Infinity, int = false } = {}) {
  let number = z.coerce.number().finite().min(min).max(max);
  if (int) number = number.int();
  return z.preprocess((value) => (value === undefined || value === "" ? undefined : value), number.optional());
}

module.exports = {
  MAX_CLP,
  clpAmount,
  searchTerm,
  isoDateOrDateTime,
  statusFilter,
  optionalQuery,
  optionalQueryNumber,
};
