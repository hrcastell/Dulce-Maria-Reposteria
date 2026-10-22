const express = require("express");
const { getPool } = require("../db");
const { sendError } = require("../lib/httpErrors");
const { getSalesSettings, toPublicSalesSettings } = require("../lib/salesSettings");

const router = express.Router();

/**
 * GET /public/settings
 * Solo lo que el sitio necesita para el modo "solo residentes": modo, nombre y
 * dirección del condominio y WhatsApp de la tienda. Nada sensible.
 */
router.get(["", "/"], async (req, res) => {
  try {
    const settings = await getSalesSettings(getPool());
    return res.json({ ok: true, settings: toPublicSalesSettings(settings) });
  } catch (e) {
    return sendError(res, e);
  }
});

module.exports = router;
