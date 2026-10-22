/**
 * Claves de `system_config` que la panadería puede leer/escribir vía
 * /admin/config/:key. Lista blanca explícita: cualquier otra clave (en
 * particular las `platform_fee_*` del Motor de Tarifa, que pertenecen al
 * dueño de la plataforma) responde 404 en ese endpoint genérico.
 */

const { MAX_CLP } = require("./schemas");

const READ_ROLES = ["SUPERADMIN", "ADMIN", "STAFF"];
const WRITE_ROLES = ["SUPERADMIN", "ADMIN"];

const BAKERY_CONFIG = new Map([
  ["cake_base_price", { kind: "int", min: 0, max: MAX_CLP, read: READ_ROLES, write: WRITE_ROLES }],
  ["energy_price_kwh", { kind: "decimal", min: 0, max: 1000000, read: READ_ROLES, write: WRITE_ROLES }],
  ["energy_price_gas", { kind: "decimal", min: 0, max: 1000000, read: READ_ROLES, write: WRITE_ROLES }],
  ["gas_canister_kg", { kind: "decimal", min: 0, max: 1000, read: READ_ROLES, write: WRITE_ROLES }],
  ["gas_canister_price_clp", { kind: "int", min: 0, max: MAX_CLP, read: READ_ROLES, write: WRITE_ROLES }],
]);

function getBakeryConfigPolicy(key) {
  return typeof key === "string" && BAKERY_CONFIG.has(key) ? BAKERY_CONFIG.get(key) : null;
}

/** @param {"read"|"write"} mode */
function canAccessBakeryConfig(key, role, mode) {
  const policy = getBakeryConfigPolicy(key);
  if (!policy) return false;
  return (mode === "write" ? policy.write : policy.read).includes(role);
}

/**
 * Valida y normaliza el valor (se guarda como texto, igual que antes).
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseBakeryConfigValue(key, raw) {
  const policy = getBakeryConfigPolicy(key);
  if (!policy) return { ok: false, error: "Configuración no encontrada." };

  let text = "";
  if (typeof raw === "number") text = Number.isFinite(raw) ? String(raw) : "";
  else if (typeof raw === "string") text = raw.trim();

  const pattern = policy.kind === "int" ? /^\d{1,12}$/ : /^\d{1,12}(\.\d{1,10})?$/;
  const expected = policy.kind === "int" ? "un número entero" : "un número";
  const invalid = { ok: false, error: `Valor inválido para ${key}: debe ser ${expected} entre ${policy.min} y ${policy.max}.` };
  if (!pattern.test(text)) return invalid;

  const value = Number(text);
  if (!Number.isFinite(value) || value < policy.min || value > policy.max) return invalid;
  return { ok: true, value: String(value) };
}

module.exports = { getBakeryConfigPolicy, canAccessBakeryConfig, parseBakeryConfigValue };
