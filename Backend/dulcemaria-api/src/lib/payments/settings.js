/**
 * Ajustes de pago editables desde el panel (system_config).
 *
 * payments_manual_enabled: el flujo manual (WhatsApp/transferencia/efectivo)
 * como método de respaldo (decisión D4). Regla de seguridad: si no hay ningún
 * proveedor en línea habilitado, el flujo manual queda disponible aunque esté
 * desactivado; así la tienda nunca queda sin forma de vender.
 */

const MANUAL_KEY = "payments_manual_enabled";

function parseManualEnabled(value) {
  return String(value ?? "true").trim().toLowerCase() !== "false";
}

async function getPaymentSettings(db) {
  const r = await db.query(`SELECT value FROM system_config WHERE key = $1`, [MANUAL_KEY]);
  return { manual_enabled: parseManualEnabled(r.rows[0]?.value) };
}

async function setManualEnabled(db, enabled) {
  await db.query(
    `INSERT INTO system_config (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [MANUAL_KEY, enabled ? "true" : "false"]
  );
}

/** ¿Se ofrece (y se acepta) el flujo manual? */
function effectiveManualEnabled(settings, onlineProviders) {
  return Boolean(settings.manual_enabled) || onlineProviders.length === 0;
}

module.exports = { MANUAL_KEY, parseManualEnabled, getPaymentSettings, setManualEnabled, effectiveManualEnabled };
