/**
 * Conversión de unidades de peso/volumen/cantidad para el costeo de recetas.
 * Unidades desconocidas se dejan pasar tal cual (solo son compatibles consigo
 * mismas) en vez de fallar, para no romper insumos con una unidad "rara" ya cargada.
 */

const UNIT_ALIASES = {
  g: "g", gr: "g", grs: "g", gramo: "g", gramos: "g",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  ml: "ml", cc: "ml", mililitro: "ml", mililitros: "ml",
  l: "l", lt: "l", litro: "l", litros: "l",
  unidad: "unidad", unidades: "unidad", un: "unidad", u: "unidad",
};

const UNIT_DIMENSIONS = {
  g: { dimension: "weight", toBase: 1 },
  kg: { dimension: "weight", toBase: 1000 },
  ml: { dimension: "volume", toBase: 1 },
  l: { dimension: "volume", toBase: 1000 },
  unidad: { dimension: "count", toBase: 1 },
};

function normalizeUnit(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return UNIT_ALIASES[key] || key;
}

/** Convierte `value` de `fromUnit` a `toUnit`. Lanza si son de dimensiones distintas. */
function convertQuantity(value, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return value;

  const fromDef = UNIT_DIMENSIONS[from];
  const toDef = UNIT_DIMENSIONS[to];

  if (!fromDef || !toDef || fromDef.dimension !== toDef.dimension) {
    const err = new Error(`No se puede convertir "${fromUnit}" a "${toUnit}" — unidades incompatibles`);
    err.statusCode = 400;
    throw err;
  }
  return (value * fromDef.toBase) / toDef.toBase;
}

module.exports = { normalizeUnit, convertQuantity };
