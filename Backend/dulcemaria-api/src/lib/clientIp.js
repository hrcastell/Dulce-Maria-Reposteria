/**
 * Claves para los limitadores de frecuencia.
 *
 * `req.ip` depende de `trust proxy` (TRUST_PROXY_HOPS): Express toma la
 * entrada de X-Forwarded-For agregada por el proxy de confianza más cercano.
 * Aquí solo se normaliza ese valor:
 *   - IPv4 mapeada en IPv6 (::ffff:1.2.3.4) → 1.2.3.4
 *   - IPv6 → prefijo /64 (un cliente suele controlar el /64 completo, así que
 *     limitar por dirección exacta permitiría rotarlas sin costo).
 */

const net = require("net");

const UNKNOWN_KEY = "ip-desconocida";

function normalizeIp(value) {
  if (typeof value !== "string") return "";
  let ip = value.trim();
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (/^::ffff:/i.test(ip) && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  return ip;
}

/** Expande una IPv6 válida a sus 8 hextetos (minúsculas, sin ceros a la izquierda). */
function expandIPv6(ip) {
  let address = ip.toLowerCase();
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = address.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  let parts = left;
  if (halves.length === 2) {
    const right = halves[1] ? halves[1].split(":") : [];
    parts = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  }
  return parts.map((hextet) => parseInt(hextet || "0", 16).toString(16));
}

function rateLimitKeyFromIp(ip) {
  const value = normalizeIp(ip);
  if (net.isIPv4(value)) return value;
  if (net.isIPv6(value)) return `${expandIPv6(value).slice(0, 4).join(":")}::/64`;
  return UNKNOWN_KEY;
}

/** Email del cuerpo de /auth/login normalizado para el limitador por cuenta. */
function normalizeLoginEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

module.exports = { rateLimitKeyFromIp, normalizeLoginEmail, normalizeIp };
