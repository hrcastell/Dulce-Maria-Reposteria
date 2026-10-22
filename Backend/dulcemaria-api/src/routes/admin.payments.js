/**
 * Pagos en línea — panel (/admin/payments; heredan requireAuth, el control de
 * Origin de las mutaciones y adminApiLimiter de /admin).
 *
 *   GET  /                                   lista con filtros            SUPERADMIN, ADMIN, STAFF
 *   GET  /config-status                      proveedores y entorno         SUPERADMIN, ADMIN
 *   PUT  /settings                           flujo manual de respaldo      SUPERADMIN, ADMIN
 *   POST /links                              enlace de pago (orden/torta)  SUPERADMIN, ADMIN, STAFF
 *   POST /cake-orders/:id/manual-payment     abono o saldo de una torta    SUPERADMIN, ADMIN
 *   GET  /:id                                detalle + eventos saneados    SUPERADMIN, ADMIN, STAFF
 *   POST /:id/reconcile                      conciliar ahora               SUPERADMIN, ADMIN
 *   POST /:id/resolve                        cerrar una revisión           SUPERADMIN
 *   POST /:id/refunds                        reembolso total o parcial     SUPERADMIN
 *   POST /refunds/:refundId/verify           verificar un reembolso        SUPERADMIN
 *
 * STAFF nunca cambia el estado del dinero.
 */

const express = require("express");
const { z } = require("zod");
const { requireRole, requirePermission } = require("../middleware/auth");
const { validateUuidParam } = require("../middleware/validate-uuid");
const { validationError, sendError } = require("../lib/httpErrors");
const { isoDateOrDateTime, optionalQuery, optionalQueryNumber, searchTerm, MAX_CLP } = require("../lib/schemas");
const { ATTEMPT_STATUSES, RESOLUTIONS } = require("../lib/payments/stateMachine");
const { PAYMENT_PROVIDERS } = require("../lib/payments/constants");
const { MANUAL_PAYMENT_PARTS } = require("../lib/payments/cakePayments");
const ops = require("../lib/payments/adminOps");
const { requestRefund, verifyRefund } = require("../lib/payments/refunds");

const router = express.Router();

const ALL_ROLES = ["SUPERADMIN", "ADMIN", "STAFF"];
const ADMIN_ROLES = ["SUPERADMIN", "ADMIN"];

function actorOf(req) {
  return { sub: req.user?.sub, email: req.user?.email, role: req.user?.role };
}

const listSchema = z.object({
  status: optionalQuery(z.enum(ATTEMPT_STATUSES)),
  provider: optionalQuery(z.enum(PAYMENT_PROVIDERS)),
  environment: optionalQuery(z.enum(["TEST", "LIVE"])),
  target: optionalQuery(z.enum(["ORDER", "CAKE"])),
  order_id: optionalQuery(z.string().uuid()),
  cake_order_id: optionalQuery(z.string().uuid()),
  needs_review: optionalQuery(z.enum(["true", "false"])),
  from: optionalQuery(isoDateOrDateTime),
  to: optionalQuery(isoDateOrDateTime),
  q: optionalQuery(searchTerm),
  limit: optionalQueryNumber({ min: 1, max: 200, int: true }),
  offset: optionalQueryNumber({ min: 0, max: 1000000, int: true }),
});

router.get("/", requireRole(...ALL_ROLES), requirePermission("orders", "canView"), async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const d = parsed.data;
    const result = await ops.listPayments({ ...d, needs_review: d.needs_review === "true", limit: d.limit ?? 50, offset: d.offset ?? 0 });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/config-status", requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    return res.json({ ok: true, ...(await ops.getConfigStatus()) });
  } catch (error) {
    return sendError(res, error);
  }
});

const settingsSchema = z.object({ manual_enabled: z.boolean() }).strict();

router.put("/settings", requireRole(...ADMIN_ROLES), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    return res.json({ ok: true, ...(await ops.updatePaymentSettings({ manualEnabled: parsed.data.manual_enabled, actor: actorOf(req) })) });
  } catch (error) {
    return sendError(res, error);
  }
});

const linkSchema = z
  .object({ order_id: z.string().uuid().optional(), cake_order_id: z.string().uuid().optional() })
  .strict()
  .refine((d) => Boolean(d.order_id) !== Boolean(d.cake_order_id), { message: "Indica order_id o cake_order_id (solo uno)." });

router.post("/links", requireRole(...ALL_ROLES), requirePermission("orders", "canView"), async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await ops.createPaymentLink({ orderId: parsed.data.order_id, cakeOrderId: parsed.data.cake_order_id, actor: actorOf(req) });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

const manualCakeSchema = z
  .object({
    part: z.enum(MANUAL_PAYMENT_PARTS),
    method: z.enum(["CASH", "TRANSFER"]),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

router.post("/cake-orders/:id/manual-payment", requireRole(...ADMIN_ROLES), validateUuidParam("id"), async (req, res) => {
  const parsed = manualCakeSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await ops.registerManualCakePayment({ cakeOrderId: req.params.id, ...parsed.data, actor: actorOf(req) });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/refunds/:refundId/verify", requireRole("SUPERADMIN"), validateUuidParam("refundId"), async (req, res) => {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    return res.status(400).json({ ok: false, error: "Esta acción no recibe datos.", code: "VALIDATION_ERROR" });
  }
  try {
    const result = await verifyRefund({ refundId: req.params.refundId, actor: actorOf(req) });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/:id", requireRole(...ALL_ROLES), validateUuidParam("id"), requirePermission("orders", "canView"), async (req, res) => {
  try {
    return res.json({ ok: true, ...(await ops.getPaymentDetail(req.params.id)) });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/:id/reconcile", requireRole(...ADMIN_ROLES), validateUuidParam("id"), async (req, res) => {
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    return res.status(400).json({ ok: false, error: "Esta acción no recibe datos.", code: "VALIDATION_ERROR" });
  }
  try {
    return res.json({ ok: true, ...(await ops.reconcileNow(req.params.id)) });
  } catch (error) {
    return sendError(res, error);
  }
});

const resolveSchema = z
  .object({
    resolution: z.enum(RESOLUTIONS),
    note: z.string().trim().min(10).max(500),
  })
  .strict();

router.post("/:id/resolve", requireRole("SUPERADMIN"), validateUuidParam("id"), async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await ops.resolveReview({ attemptId: req.params.id, ...parsed.data, actor: actorOf(req) });
    return res.json({ ok: true, payment: { id: result.payment.id, status: result.payment.status } });
  } catch (error) {
    return sendError(res, error);
  }
});

const refundSchema = z
  .object({
    amount_clp: z.number().int().positive().max(MAX_CLP).optional(),
    reason: z.string().trim().min(5).max(300),
    client_request_id: z.string().uuid(),
  })
  .strict();

router.post("/:id/refunds", requireRole("SUPERADMIN"), validateUuidParam("id"), async (req, res) => {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  try {
    const result = await requestRefund({
      attemptId: req.params.id,
      amountClp: parsed.data.amount_clp,
      reason: parsed.data.reason,
      clientRequestId: parsed.data.client_request_id,
      actor: actorOf(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
