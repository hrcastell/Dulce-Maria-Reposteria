/**
 * Política de fortaleza para JWT_SECRET.
 *
 * HS256 es tan fuerte como su secreto: un valor copiado de la documentación
 * o elegido por una persona permite falsificar sesiones de administrador.
 * En producción cualquier problema detectado impide arrancar; en desarrollo
 * solo se advierte (el stack Docker local usa un placeholder conocido).
 */

const MIN_LENGTH = 32;
// ~32 bytes aleatorios codificados en base64 (64 si es hexadecimal).
const MIN_PRODUCTION_LENGTH = 43;
const MIN_DISTINCT_CHARS = 10;
const MIN_ESTIMATED_BITS = 128;

// Valores de ejemplo publicados en este repositorio (README, docker/env.example).
const KNOWN_PLACEHOLDERS = new Set([
  "local-dev-only-jwt-secret-change-me-0123456789",
  "tu_secret_muy_largo_y_seguro_minimo_32_caracteres",
]);

// Fragmentos que delatan un valor de ejemplo o elegido a mano.
const PLACEHOLDER_MARKERS = [
  "change",
  "cambia",
  "example",
  "ejemplo",
  "secret",
  "placeholder",
  "local-dev",
  "dev-only",
  "password",
  "contrasena",
  "contraseña",
  "your-",
  "your_",
  "xxxx",
  "qwerty",
];

/** Entropía de Shannon empírica (bits totales). Es una cota optimista: solo sirve para descartar valores obvios. */
function estimateEntropyBits(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) || 0) + 1);
  let bitsPerChar = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bitsPerChar -= p * Math.log2(p);
  }
  return bitsPerChar * value.length;
}

/**
 * @param {string} secret
 * @param {{ production: boolean }} options
 * @returns {{ ok: boolean, fatal: boolean, problems: { code: string, message: string }[] }}
 */
function assessJwtSecret(secret, { production }) {
  const value = typeof secret === "string" ? secret : "";
  const problems = [];
  const add = (code, message) => problems.push({ code, message });

  if (value.length < MIN_LENGTH) {
    add("too_short", `JWT_SECRET debe tener al menos ${MIN_LENGTH} caracteres.`);
  }
  const lower = value.toLowerCase();
  if (KNOWN_PLACEHOLDERS.has(value) || PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) {
    add("placeholder", "JWT_SECRET parece un valor de ejemplo o elegido a mano; genera uno aleatorio.");
  }
  if (new Set(value).size < MIN_DISTINCT_CHARS) {
    add("low_variety", `JWT_SECRET usa menos de ${MIN_DISTINCT_CHARS} caracteres distintos.`);
  }
  if (estimateEntropyBits(value) < MIN_ESTIMATED_BITS) {
    add("low_entropy", "JWT_SECRET tiene muy poca entropía (demasiado repetitivo o predecible).");
  }
  if (production && value.length < MIN_PRODUCTION_LENGTH) {
    add(
      "too_short_for_production",
      `En producción JWT_SECRET debe tener al menos ${MIN_PRODUCTION_LENGTH} caracteres (32 bytes aleatorios en base64).`
    );
  }

  const fatal = problems.some((p) => p.code === "too_short") || (production && problems.length > 0);
  return { ok: problems.length === 0, fatal, problems };
}

module.exports = { assessJwtSecret, estimateEntropyBits };
