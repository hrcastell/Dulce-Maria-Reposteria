/**
 * Configuración de pagos en línea (payments-design §3.6, §11). Módulo puro:
 * `parsePaymentsConfig(env)` devuelve un objeto inmutable.
 *
 * Reglas:
 *   - Cada proveedor se habilita EXPLÍCITAMENTE (WEBPAY_ENABLED=true,
 *     MERCADOPAGO_ENABLED=true) y solo si su configuración es válida; si no,
 *     queda deshabilitado con un problema legible. Nunca se bota la app por la
 *     configuración de pagos (la tienda sigue vendiendo por WhatsApp).
 *   - Webpay en integración puede usar las credenciales PÚBLICAS de Transbank;
 *     en producción exige código de comercio y API Key propios (nunca las de
 *     integración) y además NODE_ENV=production.
 *   - Producción con Webpay en integración: se permite (validación con
 *     Transbank) con una advertencia ruidosa al arrancar.
 *   - En producción, las URLs públicas deben ser https, sin query ni fragmento.
 *   - Los problemas y la descripción pública nombran variables, nunca valores
 *     secretos.
 */

const { isProductionMode } = require("../../config/runtime");
const webpayConstants = require("./webpay/constants");

const DEFAULT_PAYMENT_PAGE_PATH = "/pago/";
const SAFE_PAGE_PATH = /^\/[A-Za-z0-9._~/-]*$/;
const STATEMENT_DESCRIPTOR = /^[A-Za-z0-9 .-]{1,13}$/;
const COMMERCE_CODE = /^\d{12}$/;
const MIN_SECRET_LENGTH = 16;
const MIN_CRON_TOKEN_LENGTH = 32;
const MP_API_BASE_URL = "https://api.mercadopago.com";
const DEV_MOCK_BASE = /^https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}$/;

function text(env, name) {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(env, name, warnings) {
  const value = text(env, name).toLowerCase();
  if (value === "" || value === "false") return false;
  if (value === "true") return true;
  warnings.push(`${name} debe ser true o false; se toma como false.`);
  return false;
}

function readInt(env, name, { def, min, max }, warnings) {
  const raw = text(env, name);
  if (raw === "") return def;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    warnings.push(`${name} debe ser un entero entre ${min} y ${max}; se usa ${def}.`);
    return def;
  }
  return n;
}

/** URL pública absoluta: http(s), sin credenciales, query ni fragmento; https en producción. Sin barra final. */
function readPublicUrl(env, name, { production, requireHttps }) {
  const raw = text(env, name);
  if (!raw) return { value: null, problem: null, missing: true };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { value: null, problem: `${name} no es una URL válida.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { value: null, problem: `${name} debe usar http o https.` };
  if ((production || requireHttps) && url.protocol !== "https:") return { value: null, problem: `${name} debe usar https en producción.` };
  if (url.search || url.hash || raw.includes("#") || raw.includes("?")) return { value: null, problem: `${name} no puede llevar query ni fragmento.` };
  if (url.username || url.password) return { value: null, problem: `${name} no puede llevar credenciales.` };
  const pathname = url.pathname.replace(/\/+$/, "");
  return { value: `${url.origin}${pathname}`, problem: null };
}

function readPaymentPagePath(env, warnings) {
  const raw = text(env, "PUBLIC_PAYMENT_PAGE_PATH");
  if (!raw) return DEFAULT_PAYMENT_PAGE_PATH;
  if (!SAFE_PAGE_PATH.test(raw) || raw.includes("//") || raw.includes("..")) {
    warnings.push(`PUBLIC_PAYMENT_PAGE_PATH debe ser una ruta absoluta simple (p. ej. ${DEFAULT_PAYMENT_PAGE_PATH}); se usa ${DEFAULT_PAYMENT_PAGE_PATH}.`);
    return DEFAULT_PAYMENT_PAGE_PATH;
  }
  return raw;
}

function parseWebpay(env, { production, siteUrl, apiUrl, warnings }) {
  const problems = [];
  const requested = readFlag(env, "WEBPAY_ENABLED", warnings);
  const envName = (text(env, "TRANSBANK_ENV") || "integration").toLowerCase();
  let environment = envName;
  if (envName !== "integration" && envName !== "production") {
    problems.push("TRANSBANK_ENV debe ser integration o production.");
    environment = "integration";
  }

  let commerceCode = text(env, "TRANSBANK_COMMERCE_CODE");
  let apiKeySecret = text(env, "TRANSBANK_API_KEY_SECRET");
  if (environment === "integration") {
    // Credenciales públicas del comercio de pruebas (referencia de Transbank).
    commerceCode = commerceCode || webpayConstants.INTEGRATION_COMMERCE_CODE;
    apiKeySecret = apiKeySecret || webpayConstants.INTEGRATION_API_KEY_SECRET;
  } else {
    if (!production) problems.push("TRANSBANK_ENV=production solo se permite con NODE_ENV=production.");
    if (!commerceCode) problems.push("Falta TRANSBANK_COMMERCE_CODE (producción).");
    else if (!COMMERCE_CODE.test(commerceCode)) problems.push("TRANSBANK_COMMERCE_CODE debe tener 12 dígitos.");
    else if (commerceCode === webpayConstants.INTEGRATION_COMMERCE_CODE) problems.push("TRANSBANK_COMMERCE_CODE es el comercio público de integración: no sirve en producción.");
    if (!apiKeySecret) problems.push("Falta TRANSBANK_API_KEY_SECRET (producción).");
    else if (apiKeySecret.length < MIN_SECRET_LENGTH || /\s/.test(apiKeySecret)) problems.push("TRANSBANK_API_KEY_SECRET no tiene un formato válido.");
    else if (apiKeySecret === webpayConstants.INTEGRATION_API_KEY_SECRET) problems.push("TRANSBANK_API_KEY_SECRET es la clave pública de integración: no sirve en producción.");
  }

  let returnUrl = null;
  const customReturn = readPublicUrl(env, "TRANSBANK_RETURN_URL", { production });
  if (customReturn.problem) problems.push(customReturn.problem);
  else if (customReturn.value) returnUrl = customReturn.value;
  else if (apiUrl) returnUrl = `${apiUrl}/public/payments/webpay/return`;
  if (requested && !returnUrl && !customReturn.problem) problems.push("Falta API_PUBLIC_URL (o TRANSBANK_RETURN_URL) para la URL de retorno de Webpay.");
  if (returnUrl && returnUrl.length > webpayConstants.LIMITS.returnUrl) {
    problems.push(`La URL de retorno de Webpay supera ${webpayConstants.LIMITS.returnUrl} caracteres.`);
    returnUrl = null;
  }
  if (requested && !siteUrl) problems.push("Falta PUBLIC_SITE_URL (página de resultado del pago).");

  const configured = problems.length === 0;
  const enabled = requested && configured;
  if (enabled && production && environment === "integration") {
    warnings.push(
      "⚠️ Webpay está en modo INTEGRACIÓN (pruebas) en un servidor de producción (NODE_ENV=production): los pagos NO mueven dinero real. " +
        "Úsalo solo para la validación con Transbank y luego configura TRANSBANK_ENV=production."
    );
  }
  return Object.freeze({
    id: "WEBPAY",
    requested,
    configured,
    enabled,
    environment,
    commerceCode,
    apiKeySecret,
    host: webpayConstants.HOSTS[environment],
    returnUrl,
    problems: Object.freeze(problems),
  });
}

function parseMercadoPago(env, { production, siteUrl, apiUrl, apiUrlHttps, warnings }) {
  const problems = [];
  const requested = readFlag(env, "MERCADOPAGO_ENABLED", warnings);
  const envName = (text(env, "MERCADOPAGO_ENV") || "test").toLowerCase();
  let environment;
  if (envName === "test" || envName === "integration") environment = "integration";
  else if (envName === "production") environment = "production";
  else {
    problems.push("MERCADOPAGO_ENV debe ser test o production.");
    environment = "integration";
  }
  if (environment === "production" && !production) problems.push("MERCADOPAGO_ENV=production solo se permite con NODE_ENV=production.");

  const accessToken = text(env, "MERCADOPAGO_ACCESS_TOKEN");
  const webhookSecret = text(env, "MERCADOPAGO_WEBHOOK_SECRET");
  if (requested || accessToken || webhookSecret) {
    if (!accessToken) problems.push("Falta MERCADOPAGO_ACCESS_TOKEN.");
    else if (accessToken.length < 20 || /\s/.test(accessToken)) problems.push("MERCADOPAGO_ACCESS_TOKEN no tiene un formato válido.");
    if (!webhookSecret) problems.push("Falta MERCADOPAGO_WEBHOOK_SECRET (clave de webhooks de Tus integraciones).");
    else if (webhookSecret.length < MIN_SECRET_LENGTH || /\s/.test(webhookSecret)) problems.push("MERCADOPAGO_WEBHOOK_SECRET no tiene un formato válido.");
  }

  let maxInstallments = null;
  const rawInstallments = text(env, "MERCADOPAGO_MAX_INSTALLMENTS");
  if (rawInstallments) {
    const n = Number(rawInstallments);
    if (/^\d+$/.test(rawInstallments) && n >= 1 && n <= 36) maxInstallments = n;
    else problems.push("MERCADOPAGO_MAX_INSTALLMENTS debe ser un entero entre 1 y 36.");
  }
  let statementDescriptor = null;
  const rawDescriptor = text(env, "MERCADOPAGO_STATEMENT_DESCRIPTOR");
  if (rawDescriptor) {
    if (STATEMENT_DESCRIPTOR.test(rawDescriptor)) statementDescriptor = rawDescriptor;
    else problems.push("MERCADOPAGO_STATEMENT_DESCRIPTOR admite hasta 13 letras, números, espacios, punto o guion.");
  }
  if (requested && !siteUrl) problems.push("Falta PUBLIC_SITE_URL (página de resultado del pago).");
  if (requested && !apiUrl) problems.push("Falta API_PUBLIC_URL (back_urls de Mercado Pago).");
  else if (requested && !apiUrlHttps) problems.push("API_PUBLIC_URL debe ser https para Mercado Pago (las back_urls http se descartan).");

  // Simulador local de la API de Mercado Pago (solo pruebas de desarrollo; nunca en producción).
  let apiBaseUrl = MP_API_BASE_URL;
  let devMock = false;
  const rawDevBase = text(env, "PAYMENTS_DEV_MP_API_BASE");
  if (rawDevBase) {
    if (production) warnings.push("PAYMENTS_DEV_MP_API_BASE se ignora en producción.");
    else if (DEV_MOCK_BASE.test(rawDevBase)) {
      apiBaseUrl = rawDevBase;
      devMock = true;
      warnings.push("Mercado Pago apunta a un simulador local (PAYMENTS_DEV_MP_API_BASE): solo para pruebas de desarrollo.");
    } else warnings.push("PAYMENTS_DEV_MP_API_BASE solo admite http(s)://localhost o http(s)://127.0.0.1 con puerto; se ignora.");
  }

  const configured = problems.length === 0 && Boolean(accessToken) && Boolean(webhookSecret) && Boolean(apiUrlHttps);
  const enabled = requested && configured;
  if (enabled && production && environment === "integration") {
    warnings.push("⚠️ Mercado Pago está en modo de PRUEBA en un servidor de producción (NODE_ENV=production): los pagos NO mueven dinero real.");
  }
  return Object.freeze({
    id: "MERCADOPAGO",
    requested,
    configured,
    enabled,
    environment,
    accessToken: accessToken || null,
    webhookSecret: webhookSecret || null,
    maxInstallments,
    statementDescriptor,
    backUrlBase: apiUrlHttps ? apiUrl : null,
    apiBaseUrl,
    devMock,
    problems: Object.freeze(problems),
  });
}

/** Lee la configuración de pagos desde el entorno (función pura). */
function parsePaymentsConfig(env = process.env) {
  const production = isProductionMode(env);
  const warnings = [];
  const problems = [];

  const site = readPublicUrl(env, "PUBLIC_SITE_URL", { production });
  const api = readPublicUrl(env, "API_PUBLIC_URL", { production });
  if (site.problem) problems.push(site.problem);
  if (api.problem) problems.push(api.problem);
  const paymentPagePath = readPaymentPagePath(env, warnings);

  const ttlMinutes = readInt(env, "PAYMENT_ORDER_TTL_MINUTES", { def: 30, min: 15, max: 120 }, warnings);
  const maxMinutes = Math.max(readInt(env, "PAYMENT_ORDER_MAX_MINUTES", { def: 60, min: 15, max: 240 }, warnings), ttlMinutes);
  const maxAttempts = readInt(env, "PAYMENT_MAX_ATTEMPTS_PER_ORDER", { def: 5, min: 1, max: 20 }, warnings);

  const shared = {
    production,
    siteUrl: site.value,
    apiUrl: api.value,
    apiUrlHttps: Boolean(api.value && api.value.startsWith("https://")),
    warnings,
  };
  const webpay = parseWebpay(env, shared);
  const mercadopago = parseMercadoPago(env, shared);
  const anyRequested = webpay.requested || mercadopago.requested;
  if (anyRequested && site.missing) problems.push("Falta PUBLIC_SITE_URL.");
  if (anyRequested && api.missing && !text(env, "TRANSBANK_RETURN_URL")) problems.push("Falta API_PUBLIC_URL.");

  let cronToken = text(env, "PAYMENTS_CRON_TOKEN") || null;
  if (cronToken && (cronToken.length < MIN_CRON_TOKEN_LENGTH || /\s/.test(cronToken))) {
    warnings.push(`PAYMENTS_CRON_TOKEN debe tener al menos ${MIN_CRON_TOKEN_LENGTH} caracteres sin espacios: el disparador HTTP queda desactivado.`);
    cronToken = null;
  }

  // Un problema global de URL deshabilita a todos los proveedores pedidos.
  const providers = {};
  for (const provider of [webpay, mercadopago]) {
    providers[provider.id] = problems.length && provider.enabled ? Object.freeze({ ...provider, enabled: false }) : provider;
  }

  return Object.freeze({
    production,
    urls: Object.freeze({
      publicSite: site.value,
      paymentPagePath,
      paymentPageUrl: site.value ? `${site.value}${paymentPagePath}` : null,
      apiPublic: api.value,
    }),
    window: Object.freeze({ ttlMinutes, maxMinutes, maxAttempts }),
    providers: Object.freeze(providers),
    cronToken,
    problems: Object.freeze(problems),
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

/** Proyección sin secretos para el panel (config-status) y el log de arranque. */
function describePaymentsConfig(config, { schemaOk = true } = {}) {
  const schemaProblem = "Esquema de pagos incompleto en la base de datos: revisa npm run db:validate.";
  return {
    schema_ok: Boolean(schemaOk),
    providers: Object.values(config.providers).map((p) => ({
      id: p.id,
      requested: p.requested,
      configured: p.configured,
      enabled: Boolean(p.enabled && schemaOk),
      environment: p.environment,
      problems: [...p.problems, ...(p.requested && !schemaOk ? [schemaProblem] : [])],
    })),
    urls: {
      public_site: config.urls.publicSite,
      payment_page: config.urls.paymentPageUrl,
      api_public: config.urls.apiPublic,
      webpay_return: config.providers.WEBPAY.returnUrl,
    },
    window: {
      ttl_minutes: config.window.ttlMinutes,
      max_minutes: config.window.maxMinutes,
      max_attempts: config.window.maxAttempts,
    },
    cron_trigger_enabled: Boolean(config.cronToken),
    problems: [...config.problems],
    warnings: [...config.warnings],
  };
}

module.exports = { DEFAULT_PAYMENT_PAGE_PATH, parsePaymentsConfig, describePaymentsConfig };
