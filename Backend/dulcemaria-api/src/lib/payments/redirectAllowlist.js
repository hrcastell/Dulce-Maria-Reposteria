/**
 * Lista blanca de URLs de pago que el servidor entrega al navegador (puro).
 * Antes de devolver la acción de redirección se verifica que la URL del
 * proveedor sea https y apunte a un host oficial:
 *   - Webpay: el formulario del entorno configurado (webpay3gint en integración,
 *     webpay3g en producción), según la referencia de Transbank;
 *   - Mercado Pago: el checkout oficial (mercadopago.cl / mercadopago.com).
 * `extraHosts` solo existe para el simulador local de desarrollo.
 */

const { HOSTS } = require("./webpay/constants");

const MP_CHECKOUT_HOSTS = Object.freeze(["www.mercadopago.cl", "mercadopago.cl", "www.mercadopago.com", "mercadopago.com"]);

function isAllowedRedirect({ provider, environment, url, extraHosts = [] }) {
  if (typeof url !== "string" || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (extraHosts.includes(parsed.host) && (parsed.protocol === "http:" || parsed.protocol === "https:")) return true;
  if (parsed.protocol !== "https:" || parsed.port) return false;
  if (provider === "WEBPAY") return parsed.hostname === HOSTS[environment];
  if (provider === "MERCADOPAGO") return MP_CHECKOUT_HOSTS.includes(parsed.hostname);
  return false;
}

module.exports = { MP_CHECKOUT_HOSTS, isAllowedRedirect };
