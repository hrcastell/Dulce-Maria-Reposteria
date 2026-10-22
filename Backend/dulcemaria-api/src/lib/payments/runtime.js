/**
 * Estado de proceso de la unidad de pagos: configuración (leída una vez del
 * entorno), resultado de la verificación del esquema y clientes HTTP de los
 * proveedores. NO guarda ningún estado de pagos: con varios procesos de
 * Passenger, toda la coordinación vive en PostgreSQL.
 *
 * Un proveedor "habilitado" acepta pagos nuevos (bandera + configuración +
 * esquema). Un proveedor "configurado" puede seguir procesando intentos en
 * curso (retornos, webhooks, conciliación, reembolsos) aunque se haya
 * deshabilitado para pagos nuevos (plan de reversión del go-live).
 */

const { parsePaymentsConfig, describePaymentsConfig } = require("./config");
const { createWebpayClient } = require("./webpay/client");
const { createMercadoPagoClient } = require("./mercadopago/client");
const { checkPaymentsSchema } = require("./schemaCheck");
const { PAYMENT_PROVIDERS } = require("./constants");

const state = {
  config: null,
  schema: { checked: false, ok: false, missing: [], warnings: [] },
  clients: new Map(),
  fetchImpl: undefined,
  clock: () => new Date(),
};

function getConfig() {
  if (!state.config) state.config = parsePaymentsConfig(process.env);
  return state.config;
}

function now() {
  return state.clock();
}

function schemaOk() {
  return state.schema.ok;
}

function schemaReport() {
  return state.schema;
}

/** Proveedores que aceptan pagos nuevos, en el orden en que se muestran. */
function enabledProviders() {
  if (!schemaOk()) return [];
  const config = getConfig();
  return PAYMENT_PROVIDERS.filter((id) => config.providers[id].enabled);
}

function isProviderEnabled(id) {
  return enabledProviders().includes(id);
}

/**
 * Cliente para procesar un intento del proveedor. null si el proveedor no está
 * configurado o si el intento es de otro entorno (nunca se envía un token LIVE
 * al ambiente de integración ni al revés).
 */
function clientFor(providerId, { environmentCode } = {}) {
  const cfg = getConfig().providers[providerId];
  if (!cfg || !cfg.configured || !schemaOk()) return null;
  if (!state.clients.has(providerId)) {
    const deps = { fetchImpl: state.fetchImpl };
    state.clients.set(providerId, providerId === "WEBPAY" ? createWebpayClient(cfg, deps) : createMercadoPagoClient(cfg, deps));
  }
  const client = state.clients.get(providerId);
  if (environmentCode && client.environmentCode !== environmentCode) return null;
  return client;
}

/** Verifica el esquema y registra el estado de los proveedores. Nunca lanza. */
async function initPayments(pool, log = console) {
  const config = getConfig();
  try {
    const report = await checkPaymentsSchema(pool);
    state.schema = { checked: true, ...report };
  } catch (error) {
    state.schema = { checked: true, ok: false, missing: [`no se pudo verificar el esquema (${error?.code || "error"})`], warnings: [] };
  }
  const described = describePaymentsConfig(config, { schemaOk: state.schema.ok });
  if (!state.schema.ok) {
    log.error(`❌ Pagos en línea deshabilitados: esquema de pagos incompleto (${state.schema.missing.slice(0, 5).join("; ")}). Revisa npm run db:validate.`);
  } else {
    log.log("✅ Esquema de pagos OK.");
  }
  for (const warning of state.schema.warnings || []) log.warn(`⚠️  Pagos: ${warning}`);
  // Los problemas y advertencias de configuración ya los informó validateEnv (src/config/env.js).
  for (const provider of described.providers) {
    if (provider.enabled) {
      log.log(`💳 ${provider.id} habilitado (${provider.environment === "production" ? "PRODUCCIÓN" : "INTEGRACIÓN / pruebas"}).`);
    } else if (provider.requested) {
      log.error(`❌ ${provider.id} deshabilitado: ${provider.problems.join(" ") || "configuración incompleta."}`);
    }
  }
  if (!described.providers.some((p) => p.enabled)) log.log("💳 Sin pagos en línea habilitados: se ofrece solo el flujo manual (WhatsApp).");
  return described;
}

/** Solo para pruebas: inyecta configuración, fetch, reloj y estado del esquema. */
function __setTestOverrides({ config, fetchImpl, clock, schemaOk: ok } = {}) {
  if (config !== undefined) state.config = config;
  if (fetchImpl !== undefined) state.fetchImpl = fetchImpl;
  if (clock !== undefined) state.clock = clock;
  if (ok !== undefined) state.schema = { checked: true, ok, missing: [], warnings: [] };
  state.clients.clear();
}

module.exports = {
  getConfig,
  now,
  schemaOk,
  schemaReport,
  enabledProviders,
  isProviderEnabled,
  clientFor,
  initPayments,
  __setTestOverrides,
};
