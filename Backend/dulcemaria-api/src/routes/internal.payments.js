/**
 * POST /internal/payments/reconcile — disparador HTTP del conciliador para el
 * cron de cPanel cuando el shell del cron no ve las variables de entorno de
 * la app (payments-design §6.9). Alternativa al CLI `npm run payments:reconcile`.
 *
 * - Solo existe si PAYMENTS_CRON_TOKEN está configurado (si no, 404).
 * - Authorization: Bearer <PAYMENTS_CRON_TOKEN>, comparado en tiempo constante
 *   sobre los SHA-256 de ambos valores.
 * - Ejecuta el mismo lote que el CLI, bajo el mismo advisory lock.
 */

const crypto = require("crypto");
const express = require("express");
const { sendError } = require("../lib/httpErrors");
const runtime = require("../lib/payments/runtime");
const { runReconcileBatchExclusive } = require("../lib/payments/reconciler");

const router = express.Router();

function sameSecret(provided, expected) {
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

router.post("/reconcile", async (req, res) => {
  const expected = runtime.getConfig().cronToken;
  if (!expected) return res.status(404).json({ ok: false, error: "No encontrado." });
  const auth = req.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!match || !sameSecret(match[1], expected)) return res.status(401).json({ ok: false, error: "No autorizado." });
  try {
    return res.json(await runReconcileBatchExclusive({ limit: 25 }));
  } catch (error) {
    return sendError(res, error, { context: "POST /internal/payments/reconcile" });
  }
});

module.exports = router;
