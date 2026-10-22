/**
 * Modo de venta "solo residentes" (decisiones D2/D3 de la dueña).
 *
 * La panadería no tiene local ni dominio propio y hoy vende solo a residentes
 * de un condominio. Con el modo RESIDENTS_ONLY (valor por defecto) el sitio
 * público solo puede crear pedidos (catálogo y tortas) si el cliente declara
 * vivir allí e indica su torre/departamento; la entrega es en el condominio y
 * sin costo. Con OPEN se mantiene el comportamiento anterior (despacho a la
 * dirección del cliente, costo 0).
 *
 * Los valores viven en system_config (se siembran con ON CONFLICT DO NOTHING
 * en complete.js) y se editan en PUT /admin/settings/sales. Si una clave falta
 * o trae un valor inválido se usa el valor por defecto; un modo desconocido
 * cae en RESIDENTS_ONLY (lo más restrictivo).
 */

const { z } = require("zod");

const SALES_MODES = Object.freeze(["RESIDENTS_ONLY", "OPEN"]);
const SALES_SETTINGS_KEYS = Object.freeze(["sales_mode", "condo_name", "condo_address", "whatsapp_number"]);

const DEFAULT_SALES_SETTINGS = Object.freeze({
  sales_mode: "RESIDENTS_ONLY",
  condo_name: "Condominio Vicuña Mackenna 2585",
  condo_address: "Vicuña Mackenna 2585",
  // Número público de la tienda (el mismo que ya usaba el sitio en sus enlaces wa.me).
  whatsapp_number: "56932423459",
});

const RESIDENCY_UNIT_MAX = 60;
const CONDO_NAME = { min: 2, max: 120 };
const CONDO_ADDRESS = { min: 2, max: 200 };
const WHATSAPP_PATTERN = /^[1-9]\d{7,14}$/;

/** Dígitos de un número de WhatsApp en formato internacional (8 a 15 dígitos) o null. */
function normalizeWhatsappNumber(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).replace(/\D/g, "");
  return WHATSAPP_PATTERN.test(digits) ? digits : null;
}

function cleanText(value, { min, max }) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= min && text.length <= max ? text : null;
}

/** Filas {key, value} de system_config → configuración completa y válida. */
function parseSalesSettingsRows(rows) {
  const byKey = new Map((rows || []).map((row) => [row.key, row.value]));
  const mode = byKey.get("sales_mode");
  return {
    sales_mode: SALES_MODES.includes(mode) ? mode : DEFAULT_SALES_SETTINGS.sales_mode,
    condo_name: cleanText(byKey.get("condo_name"), CONDO_NAME) ?? DEFAULT_SALES_SETTINGS.condo_name,
    condo_address: cleanText(byKey.get("condo_address"), CONDO_ADDRESS) ?? DEFAULT_SALES_SETTINGS.condo_address,
    whatsapp_number: normalizeWhatsappNumber(byKey.get("whatsapp_number")) ?? DEFAULT_SALES_SETTINGS.whatsapp_number,
  };
}

const textField = ({ min, max }) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(min).max(max));

/** Cuerpo de PUT /admin/settings/sales: parcial, al menos un campo, sin claves extra. */
const salesSettingsPatchSchema = z
  .object({
    sales_mode: z.enum(SALES_MODES).optional(),
    condo_name: textField(CONDO_NAME).optional(),
    condo_address: textField(CONDO_ADDRESS).optional(),
    whatsapp_number: z
      .string()
      .max(40)
      .transform((value, ctx) => {
        const digits = normalizeWhatsappNumber(value);
        if (!digits) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Número de WhatsApp inválido: usa el formato internacional, p. ej. 56912345678.",
          });
          return z.NEVER;
        }
        return digits;
      })
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "No hay campos para actualizar." });

/** `residency` del cuerpo de los pedidos públicos. */
const residencyInputSchema = z
  .object({
    declared: z.boolean(),
    unit: z.string().max(RESIDENCY_UNIT_MAX).optional().nullable(),
  })
  .strict();

/**
 * ¿Se puede crear el pedido? En RESIDENTS_ONLY exige declaración explícita y
 * una unidad no vacía. Devuelve la residencia a guardar (o null).
 */
function evaluateResidency(settings, residency) {
  const declared = residency?.declared === true;
  const unit = typeof residency?.unit === "string" ? residency.unit.trim().replace(/\s+/g, " ") : "";
  const valid = declared && unit.length >= 1 && unit.length <= RESIDENCY_UNIT_MAX;
  if (settings?.sales_mode === "OPEN") {
    return { allowed: true, residency: valid ? { unit } : null };
  }
  return valid ? { allowed: true, residency: { unit } } : { allowed: false, residency: null };
}

/** Respuesta 403 cuando un no residente intenta comprar en modo solo residentes. */
function residentsOnlyErrorBody(settings) {
  const condoName = settings?.condo_name || DEFAULT_SALES_SETTINGS.condo_name;
  return {
    ok: false,
    code: "RESIDENTS_ONLY",
    error:
      `Por ahora solo vendemos a residentes del ${condoName}. ` +
      "Si no vives allí, escríbenos por WhatsApp para coordinar tu pedido.",
    whatsapp_number: settings?.whatsapp_number || DEFAULT_SALES_SETTINGS.whatsapp_number,
  };
}

/**
 * Entrega de un pedido web (D3): no hay retiro en tienda. En RESIDENTS_ONLY
 * es en el condominio (dirección del condominio + unidad) y sin costo; en
 * OPEN, despacho a la dirección del cliente (opcional), también sin costo.
 */
function resolveWebDelivery(settings, { residencyUnit, customerAddress } = {}) {
  if (settings?.sales_mode !== "OPEN" && residencyUnit) {
    return {
      delivery_method: "DELIVERY",
      delivery_fee_clp: 0,
      delivery_address: `${settings.condo_address}, ${residencyUnit}`,
    };
  }
  const address = typeof customerAddress === "string" ? customerAddress.trim() : "";
  return { delivery_method: "DELIVERY", delivery_fee_clp: 0, delivery_address: address || null };
}

/** Solo lo que el sitio público necesita (sin nada sensible). */
function toPublicSalesSettings(settings) {
  return {
    sales_mode: settings.sales_mode,
    residents_only: settings.sales_mode !== "OPEN",
    condo_name: settings.condo_name,
    condo_address: settings.condo_address,
    whatsapp_number: settings.whatsapp_number,
  };
}

/** Lee la configuración de venta (pool o client de una transacción). */
async function getSalesSettings(db) {
  const r = await db.query(`SELECT key, value FROM system_config WHERE key = ANY($1::text[])`, [SALES_SETTINGS_KEYS]);
  return parseSalesSettingsRows(r.rows);
}

/** Guarda los campos validados por salesSettingsPatchSchema (dentro de una transacción). */
async function saveSalesSettings(client, patch) {
  for (const key of SALES_SETTINGS_KEYS) {
    if (patch[key] === undefined) continue;
    await client.query(
      `INSERT INTO system_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, String(patch[key])]
    );
  }
}

module.exports = {
  SALES_MODES,
  SALES_SETTINGS_KEYS,
  DEFAULT_SALES_SETTINGS,
  RESIDENCY_UNIT_MAX,
  parseSalesSettingsRows,
  normalizeWhatsappNumber,
  salesSettingsPatchSchema,
  residencyInputSchema,
  evaluateResidency,
  residentsOnlyErrorBody,
  resolveWebDelivery,
  toPublicSalesSettings,
  getSalesSettings,
  saveSalesSettings,
};
