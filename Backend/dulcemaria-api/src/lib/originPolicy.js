/**
 * Política de orígenes (CORS, CSRF y Fetch Metadata).
 *
 * Dos listas separadas:
 *   - ADMIN_ORIGINS: orígenes del panel. Son los ÚNICOS que reciben CORS con
 *     credenciales (cookie de sesión) en /auth y /admin, y los únicos
 *     aceptados como Origin en mutaciones autenticadas con cookie.
 *   - PUBLIC_ORIGINS: orígenes del sitio público. Reciben CORS SIN
 *     credenciales en las rutas públicas (catálogo, pedidos, hero).
 *
 * Un Origin desconocido nunca produce un error de CORS (403): simplemente no
 * recibe cabeceras CORS. Así una navegación de nivel superior (p. ej. el POST
 * de retorno de Webpay desde el dominio de Transbank) llega a la ruta.
 *
 * Compatibilidad: si ADMIN_ORIGINS / PUBLIC_ORIGINS no están definidos se usa
 * FRONTEND_URL (comportamiento anterior) con una advertencia ruidosa al
 * arrancar. Aun en ese modo, el sitio público nunca queda como origen del panel.
 */

const { isProductionMode } = require("../config/runtime");

// Orígenes históricos que el código confiaba de forma fija antes de este cambio.
const LEGACY_ADMIN_ORIGIN = "https://admin.dulcemaria.hrcastell.com";
const LEGACY_PUBLIC_ORIGIN = "https://dulcemaria.hrcastell.com";
const DEV_ADMIN_ORIGINS = ["http://localhost:3000"];
const DEV_PUBLIC_ORIGINS = ["http://localhost:3000", "http://localhost:5173"];

/** Devuelve el origen canónico (esquema://host[:puerto]) o null si no es http(s) válido. */
function normalizeOrigin(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin;
}

/** Lista separada por comas → orígenes válidos (sin duplicados) + entradas inválidas. */
function parseOriginList(value) {
  const origins = [];
  const invalid = [];
  for (const raw of String(value ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const origin = normalizeOrigin(entry);
    if (!origin) invalid.push(entry);
    else if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins, invalid };
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Resuelve la política efectiva a partir del entorno (función pura).
 * @returns {{ admin: Set<string>, public: Set<string>, legacyAdmin: boolean,
 *             legacyPublic: boolean, warnings: string[], errors: string[] }}
 */
function resolveOriginPolicy(env = process.env) {
  const production = isProductionMode(env);
  const warnings = [];
  const errors = [];

  const frontend = parseOriginList(env.FRONTEND_URL);
  if (frontend.invalid.length) {
    warnings.push(`FRONTEND_URL contiene valores que no son orígenes válidos y se ignoran: ${frontend.invalid.join(", ")}`);
  }

  // --- Sitio público (CORS sin credenciales) ---
  let publicOrigins;
  let explicitPublic = [];
  const legacyPublic = !hasValue(env.PUBLIC_ORIGINS);
  if (!legacyPublic) {
    const parsed = parseOriginList(env.PUBLIC_ORIGINS);
    if (parsed.invalid.length) {
      errors.push(
        `PUBLIC_ORIGINS contiene valores inválidos: ${parsed.invalid.join(", ")} (usa orígenes completos como https://sitio.cl, sin comodines).`
      );
    }
    explicitPublic = parsed.origins;
    publicOrigins = parsed.origins;
  } else {
    publicOrigins = [LEGACY_PUBLIC_ORIGIN, ...frontend.origins, ...(production ? [] : DEV_PUBLIC_ORIGINS)];
    warnings.push(
      "PUBLIC_ORIGINS no está definido: se usa el sitio público histórico más FRONTEND_URL. Define PUBLIC_ORIGINS explícitamente."
    );
  }

  // --- Panel de administración (CORS con credenciales + Origin de mutaciones) ---
  let adminOrigins;
  const legacyAdmin = !hasValue(env.ADMIN_ORIGINS);
  if (!legacyAdmin) {
    const parsed = parseOriginList(env.ADMIN_ORIGINS);
    if (parsed.invalid.length) {
      errors.push(
        `ADMIN_ORIGINS contiene valores inválidos: ${parsed.invalid.join(", ")} (usa orígenes completos como https://admin.sitio.cl, sin comodines).`
      );
    }
    if (parsed.origins.length === 0) errors.push("ADMIN_ORIGINS no contiene ningún origen válido.");
    adminOrigins = parsed.origins;
  } else {
    if (production && !hasValue(env.FRONTEND_URL)) {
      errors.push("En producción define ADMIN_ORIGINS con el origen del panel (o, de forma heredada, FRONTEND_URL).");
    }
    // El sitio público declarado nunca recibe la sesión del panel, ni siquiera en modo heredado.
    const neverAdmin = new Set([LEGACY_PUBLIC_ORIGIN, ...explicitPublic]);
    adminOrigins = [LEGACY_ADMIN_ORIGIN, ...frontend.origins, ...(production ? [] : DEV_ADMIN_ORIGINS)].filter(
      (origin) => !neverAdmin.has(origin)
    );
    warnings.push(
      "ADMIN_ORIGINS no está definido: se usa FRONTEND_URL (más el panel histórico) como orígenes con sesión. Define ADMIN_ORIGINS explícitamente."
    );
  }

  const admin = new Set(adminOrigins);
  const pub = new Set(publicOrigins);

  const declaredPublic = new Set([LEGACY_PUBLIC_ORIGIN, ...explicitPublic]);
  for (const origin of admin) {
    if (declaredPublic.has(origin)) {
      warnings.push(
        `El origen ${origin} figura como panel de administración y como sitio público: el sitio público no debe acceder a la sesión del panel.`
      );
    }
  }
  if (production) {
    for (const origin of new Set([...admin, ...pub])) {
      if (origin.startsWith("http://")) {
        warnings.push(`El origen ${origin} usa http en producción; la cookie de sesión (Secure) no viaja por http.`);
      }
    }
  }

  return { admin, public: pub, legacyAdmin, legacyPublic, warnings: [...new Set(warnings)], errors };
}

let cachedPolicy = null;

/** Política del proceso actual (se calcula una vez; el entorno no cambia en caliente). */
function getOriginPolicy() {
  if (!cachedPolicy) cachedPolicy = resolveOriginPolicy(process.env);
  return cachedPolicy;
}

/**
 * Cabeceras CORS para una respuesta. Para un origen no permitido devuelve un
 * objeto sin cabeceras CORS: el navegador bloquea la lectura, pero la
 * solicitud nunca se rechaza por CORS en el servidor.
 */
function buildCorsHeaders({
  origin,
  allowed,
  credentials,
  preflight,
  methods = [],
  allowHeaders = [],
  maxAgeSeconds = 600,
}) {
  const headers = {};
  if (!origin || !allowed) return headers;
  headers["Access-Control-Allow-Origin"] = origin;
  if (credentials) headers["Access-Control-Allow-Credentials"] = "true";
  if (preflight) {
    headers["Access-Control-Allow-Methods"] = methods.join(", ");
    headers["Access-Control-Allow-Headers"] = allowHeaders.join(", ");
    headers["Access-Control-Max-Age"] = String(maxAgeSeconds);
  }
  return headers;
}

/**
 * Defensa Fetch Metadata para rutas con sesión (/auth, /admin).
 * Los subdominios hermanos (p. ej. el sitio público) son "same-site" respecto
 * de la API, así que SameSite=Strict no los separa: se exige además que el
 * Origin sea uno del panel. Clientes sin Sec-Fetch-Site (curl, REST Client,
 * navegadores antiguos) pasan y quedan cubiertos por CORS y por el control de
 * Origin de las mutaciones.
 */
function decideFetchMetadata({ site, origin, adminOrigins }) {
  const value = typeof site === "string" ? site.trim().toLowerCase() : "";
  if (!value) return { allowed: true, reason: "sin-fetch-metadata" };
  if (value === "same-origin" || value === "none") return { allowed: true, reason: value };
  if (value === "same-site" || value === "cross-site") {
    const normalized = normalizeOrigin(origin);
    if (normalized && adminOrigins.has(normalized)) return { allowed: true, reason: "origen-del-panel" };
    return { allowed: false, reason: `${value}-origen-no-permitido` };
  }
  return { allowed: false, reason: "sec-fetch-site-desconocido" };
}

module.exports = {
  LEGACY_ADMIN_ORIGIN,
  LEGACY_PUBLIC_ORIGIN,
  normalizeOrigin,
  parseOriginList,
  resolveOriginPolicy,
  getOriginPolicy,
  buildCorsHeaders,
  decideFetchMetadata,
};
