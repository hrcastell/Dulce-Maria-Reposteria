const express = require("express");
const { getPool, withTransaction } = require("../db");
const { requireRole } = require("../middleware/auth");
const { validationError, sendError } = require("../lib/httpErrors");
const { SALES_SETTINGS_KEYS, salesSettingsPatchSchema, getSalesSettings, saveSalesSettings } = require("../lib/salesSettings");

const router = express.Router();

async function settingsResponse(db) {
  const settings = await getSalesSettings(db);
  const r = await db.query(`SELECT MAX(updated_at) AS updated_at FROM system_config WHERE key = ANY($1::text[])`, [SALES_SETTINGS_KEYS]);
  return { ok: true, settings, updated_at: r.rows[0]?.updated_at ?? null };
}

/**
 * GET /admin/settings/sales
 * Modo de venta (RESIDENTS_ONLY | OPEN), nombre y dirección del condominio y
 * número de WhatsApp de la tienda (decisión D2).
 */
router.get("/sales", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  try {
    return res.json(await settingsResponse(getPool()));
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * PUT /admin/settings/sales  { sales_mode?, condo_name?, condo_address?, whatsapp_number? }
 * Actualización parcial validada (al menos un campo; sin claves extra).
 */
router.put("/sales", requireRole("SUPERADMIN", "ADMIN"), async (req, res) => {
  const parsed = salesSettingsPatchSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const body = await withTransaction(async (client) => {
      await saveSalesSettings(client, parsed.data);
      return settingsResponse(client);
    });
    return res.json(body);
  } catch (e) {
    return sendError(res, e);
  }
});

module.exports = router;
