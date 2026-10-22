/**
 * Modo de seguridad efectivo de la API.
 *
 * Seguro por defecto: todo valor de NODE_ENV que no sea explícitamente
 * "development" o "test" (incluido NODE_ENV ausente o mal escrito en el
 * panel de cPanel) se trata como producción. Así un error de configuración
 * nunca desactiva la cookie Secure, HSTS, el enmascarado de errores ni las
 * protecciones del bootstrap.
 */

const NON_PRODUCTION_ENVS = new Set(["development", "test"]);

function normalizeNodeEnv(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
function isProductionMode(env = process.env) {
  return !NON_PRODUCTION_ENVS.has(normalizeNodeEnv(env.NODE_ENV));
}

/**
 * Describe el modo para el log de arranque.
 * `implicit` = producción asumida porque NODE_ENV falta o no es reconocido.
 */
function describeSecurityMode(env = process.env) {
  const nodeEnv = normalizeNodeEnv(env.NODE_ENV) || null;
  const production = isProductionMode(env);
  return { production, nodeEnv, implicit: production && nodeEnv !== "production" };
}

module.exports = { isProductionMode, describeSecurityMode };
