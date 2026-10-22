/**
 * Atributos de la cookie de sesión del panel.
 *
 * En producción se usa el prefijo `__Host-`: el navegador solo la acepta con
 * Secure, Path=/ y sin Domain, de modo que ningún subdominio hermano
 * (*.hrcastell.com) puede plantar o sobrescribir la sesión de la API.
 * En desarrollo (http://localhost) Secure no es posible, así que se usa el
 * nombre sin prefijo.
 */

const BASE_COOKIE_NAME = "dm_session";
const HOST_COOKIE_NAME = "__Host-dm_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // igual al `expiresIn` del JWT

/**
 * @param {{ production: boolean }} options
 */
function buildSessionCookie({ production }) {
  const base = { httpOnly: true, secure: production, sameSite: "strict", path: "/" };
  return {
    name: production ? HOST_COOKIE_NAME : BASE_COOKIE_NAME,
    options: { ...base, maxAge: SESSION_TTL_MS },
    // Al cerrar sesión se borran ambos nombres: limpia también la cookie
    // anterior al cambio de nombre. `__Host-` exige Secure para poder borrarse.
    clearCookies: [HOST_COOKIE_NAME, BASE_COOKIE_NAME].map((name) => ({
      name,
      options: { ...base, secure: production || name.startsWith("__Host-") },
    })),
  };
}

module.exports = { buildSessionCookie, SESSION_TTL_MS, BASE_COOKIE_NAME, HOST_COOKIE_NAME };
