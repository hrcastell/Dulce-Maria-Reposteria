/**
 * Revocación de sesiones del panel.
 *
 * Cada usuario tiene `users.session_version`; el JWT lleva esa versión en el
 * claim `sv` y requireAuth exige que coincida. Incrementar la columna invalida
 * en el acto TODAS las sesiones abiertas de ese usuario (todas las cookies
 * emitidas antes), sin listas negras ni estado extra.
 */

/**
 * ¿Un cambio administrativo sobre el usuario debe cerrar sus sesiones?
 * Sí al cambiar la contraseña, el rol o el estado activo (en cualquier
 * sentido). Repetir el mismo valor no revoca.
 *
 * @param {{ role: string, is_active: boolean }} existing  fila actual de users
 * @param {{ password?: string, role?: string, isActive?: boolean }} patch
 */
function shouldRevokeSessions(existing, patch) {
  if (patch.password !== undefined) return true;
  if (patch.role !== undefined && patch.role !== existing.role) return true;
  if (patch.isActive !== undefined && patch.isActive !== existing.is_active) return true;
  return false;
}

module.exports = { shouldRevokeSessions };
