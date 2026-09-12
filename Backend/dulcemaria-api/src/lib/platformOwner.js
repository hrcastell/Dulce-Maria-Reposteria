/**
 * Platform Owner Identity Helper
 *
 * Único punto de verdad para decidir si un email pertenece al DUEÑO DE LA
 * PLATAFORMA (el desarrollador que cobra por el uso de esta app), NO al
 * dueño de la panadería que opera esta instancia — aunque ese dueño tenga
 * rol SUPERADMIN en su propia instancia, NUNCA debe pasar este chequeo.
 *
 * Se usa tanto en el middleware que protege las rutas del Motor de Tarifa
 * (requirePlatformOwner, en src/middleware/auth.js) como en los handlers de
 * POST /auth/login y GET /auth/me que exponen el flag `is_platform_owner`
 * al frontend. Un solo punto de verdad evita que el enforcement real del
 * backend y lo que el frontend usa para mostrar/ocultar el link del sidebar
 * se desincronicen.
 *
 * Deliberadamente NO reusa ADMIN_EMAIL (esa variable es frágil: solo se usa
 * una vez en POST /auth/bootstrap para crear el primer SUPERADMIN, y la
 * documentación del proyecto asume que puede borrarse del servidor después
 * del primer uso). PLATFORM_OWNER_EMAIL es una variable nueva, propia de
 * este feature, pensada para vivir permanentemente en el entorno.
 *
 * Fail-closed a propósito: si PLATFORM_OWNER_EMAIL no está seteada en el
 * entorno, NADIE es platform owner — ni siquiera SUPERADMIN.
 */

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * @param {string} email - email a evaluar (ej. req.user.email)
 * @returns {boolean}
 */
function isPlatformOwner(email) {
  const configured = normalizeEmail(process.env.PLATFORM_OWNER_EMAIL);
  if (!configured) return false;

  const candidate = normalizeEmail(email);
  if (!candidate) return false;

  return candidate === configured;
}

module.exports = { isPlatformOwner };
