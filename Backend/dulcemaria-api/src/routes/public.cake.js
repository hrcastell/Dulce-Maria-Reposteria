const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool, withTransaction } = require("../db");
const { validationError, sendError, appError, unavailableError, isUniqueViolation } = require("../lib/httpErrors");
const { recordOrderEvent } = require("../lib/orderEvents");
const paymentsRuntime = require("../lib/payments/runtime");
const { newAccessToken } = require("../lib/payments/references");
const { getPaymentSettings, effectiveManualEnabled } = require("../lib/payments/settings");
const { cakePaymentSummary } = require("../lib/payments/cakePayments");
const {
  getSalesSettings,
  residencyInputSchema,
  evaluateResidency,
  residentsOnlyErrorBody,
  resolveWebDelivery,
} = require("../lib/salesSettings");
const { santiagoToday, validateDeliveryDate } = require("../lib/santiagoTime");
const { normalizeEmail } = require("../lib/customerIdentity");
const { countRecentCakeOrders } = require("../lib/webCustomers");

const router = express.Router();

// Anti-spam por teléfono (B-19), contado en la base (vale para todos los procesos).
const MAX_CAKE_ORDERS_PER_PHONE_PER_HOUR = 3;

const CAKE_ORDER_SUMMARY_COLUMNS = `id, order_number, status, total_price_clp, deposit_clp, customer_address,
  delivery_date, residency_unit, payment_method, public_token, payment_expires_at, deposit_status, balance_status`;

function cakeOrderResponse(order, { replay = false } = {}) {
  const online = order.payment_method === "ONLINE";
  const summary = cakePaymentSummary(order);
  return {
    ok: true,
    order_id: order.id,
    order_number: order.order_number,
    status: order.status,
    deposit_clp: order.deposit_clp,
    total_price_clp: order.total_price_clp,
    balance_clp: summary.balance_clp,
    payment_method: online ? "ONLINE" : "MANUAL",
    payment_status: summary.payment_status,
    deposit_status: order.deposit_status,
    delivery_address: order.customer_address,
    delivery_date: order.delivery_date,
    residency_unit: order.residency_unit,
    // Abono en línea (D1): capacidad para la página /pago/#t=<token>.
    ...(online && order.public_token ? { access_token: order.public_token, payment_expires_at: order.payment_expires_at } : {}),
    ...(replay ? { idempotent_replay: true } : {}),
  };
}

async function findCakeByRequestId(db, clientRequestId) {
  const r = await db.query(`SELECT ${CAKE_ORDER_SUMMARY_COLUMNS} FROM cake_orders WHERE client_request_id = $1 LIMIT 1`, [
    clientRequestId,
  ]);
  return r.rows[0] || null;
}

/**
 * GET /public/cake-builder
 * Retorna categorías + opciones activas para el configurador público
 */
router.get(["", "/"], async (req, res) => {
  try {
    const pool = getPool();
    const cats = await pool.query(
      `SELECT id, type, label, sort_order FROM cake_config_category WHERE is_active=true ORDER BY sort_order ASC`
    );
    const opts = await pool.query(
      `SELECT id, category_id, label, description, extra_price_clp, is_default, diameter_cm, image_url, sort_order
       FROM cake_config_option
       WHERE is_active=true
       ORDER BY category_id, sort_order ASC`
    );
    const byCategory = {};
    for (const o of opts.rows) {
      if (!byCategory[o.category_id]) byCategory[o.category_id] = [];
      byCategory[o.category_id].push(o);
    }
    const categories = cats.rows.map(c => ({ ...c, options: byCategory[c.id] || [] }));

    // Fetch base price
    const configRes = await pool.query("SELECT value FROM system_config WHERE key='cake_base_price' LIMIT 1");
    const basePrice = configRes.rowCount > 0 ? Number(configRes.rows[0].value) : 30000;

    res.json({ ok: true, categories, base_price: basePrice });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

const cakeOrderSchema = z
  .object({
    customer_name: z.string().trim().min(2).max(200),
    customer_phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,30}$/, "Teléfono inválido.")
      .refine((value) => value.replace(/\D/g, "").length >= 8, "El teléfono debe tener al menos 8 dígitos."),
    customer_email: z.string().trim().email().max(200).optional().nullable(),
    customer_address: z.string().trim().max(400).optional().nullable(),
    size_option_id: z.string().uuid().optional().nullable(),
    layers_option_id: z.string().uuid().optional().nullable(),
    sponge_option_id: z.string().uuid().optional().nullable(),
    filling_option_id: z.string().uuid().optional().nullable(),
    decoration_option_id: z.string().uuid().optional().nullable(),
    theme_option_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
    // Modo solo residentes (D2): { declared: true, unit: "Torre B, depto 1203" }.
    residency: residencyInputSchema.optional().nullable(),
    // Fecha de entrega preferida (calendario de Chile; hoy o después).
    delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida: usa AAAA-MM-DD.").optional().nullable(),
    // Idempotencia: el mismo UUID repetido devuelve el pedido original.
    client_request_id: z.string().uuid().optional(),
    // D1: ONLINE = el abono (deposit_clp) se paga en línea al enviar el pedido;
    // MANUAL = se coordina por WhatsApp (comportamiento anterior).
    payment_method: z.enum(["MANUAL", "ONLINE"]).optional(),
  })
  .strict();

const OPTION_KEY_TO_TYPE = {
  theme_option_id: "THEME",
  size_option_id: "SIZE",
  layers_option_id: "LAYERS",
  sponge_option_id: "SPONGE",
  filling_option_id: "FILLING",
  decoration_option_id: "DECORATION",
};

/**
 * POST /public/cake-builder/orders
 * Registra un pedido de torta personalizada (precio recalculado en el
 * servidor; abono 50 %). Mismas reglas del canal web que POST /public/orders:
 * modo solo residentes (403 RESIDENTS_ONLY), entrega en el condominio,
 * idempotencia por client_request_id y límite por teléfono.
 * Con payment_method ONLINE (D1) devuelve el token de acceso para pagar el
 * ABONO en línea (POST /public/payments); el saldo lo registra el panel al entregar.
 */
router.post("/orders", async (req, res) => {
  const parsed = cakeOrderSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error);
  const d = parsed.data;
  const online = d.payment_method === "ONLINE";

  if (d.delivery_date) {
    const dateCheck = validateDeliveryDate(d.delivery_date, { today: santiagoToday() });
    if (!dateCheck.ok) return res.status(400).json({ ok: false, error: dateCheck.error, code: "VALIDATION_ERROR" });
  }

  try {
    const result = await withTransaction(async (client) => {
      if (d.client_request_id) {
        const existing = await findCakeByRequestId(client, d.client_request_id);
        if (existing) return { replay: true, order: existing };
      }

      const onlineProviders = paymentsRuntime.enabledProviders();
      if (online && !onlineProviders.length) {
        throw unavailableError("ONLINE_PAYMENTS_UNAVAILABLE", "El pago en línea no está disponible en este momento. Puedes coordinar tu torta por WhatsApp.");
      }
      if (!online && !effectiveManualEnabled(await getPaymentSettings(client), onlineProviders)) {
        throw appError(409, "MANUAL_PAYMENTS_DISABLED", "Por ahora el abono de las tortas se paga en línea: elige Webpay o Mercado Pago.");
      }

      const settings = await getSalesSettings(client);
      const residency = evaluateResidency(settings, d.residency);
      if (!residency.allowed) {
        const body = residentsOnlyErrorBody(settings);
        throw appError(403, body.code, body.error, { whatsapp_number: body.whatsapp_number });
      }

      const recent = await countRecentCakeOrders(client, d.customer_phone);
      if (recent >= MAX_CAKE_ORDERS_PER_PHONE_PER_HOUR) {
        throw appError(
          429,
          "TOO_MANY_ORDERS",
          "Recibimos varios pedidos de torta con este teléfono en la última hora. Escríbenos por WhatsApp para coordinarlo.",
          { whatsapp_number: settings.whatsapp_number }
        );
      }

      const selected = Object.entries(OPTION_KEY_TO_TYPE)
        .filter(([key]) => Boolean(d[key]))
        .map(([key, type]) => ({ key, type, id: d[key] }));
      const ids = selected.map((item) => item.id);
      const optionsResult = ids.length
        ? await client.query(
            `SELECT o.id, o.extra_price_clp, c.type
             FROM cake_config_option o
             JOIN cake_config_category c ON c.id=o.category_id
             WHERE o.id=ANY($1::uuid[]) AND o.is_active=true AND c.is_active=true`,
            [ids]
          )
        : { rows: [] };
      const options = new Map(optionsResult.rows.map((option) => [option.id, option]));
      for (const item of selected) {
        const option = options.get(item.id);
        if (!option || option.type !== item.type) throw appError(400, "CAKE_CONFIG_INVALID", "Configuración de torta inválida");
      }

      const configResult = await client.query(`SELECT value FROM system_config WHERE key='cake_base_price' LIMIT 1`);
      const basePrice = configResult.rowCount ? Number(configResult.rows[0].value) : 30000;
      const extrasPrice = optionsResult.rows.reduce((sum, option) => sum + Number(option.extra_price_clp || 0), 0);
      const totalPrice = basePrice + extrasPrice;
      if (!Number.isSafeInteger(totalPrice) || totalPrice <= 0 || totalPrice > 100000000) {
        throw appError(400, "ORDER_TOTAL_INVALID", "Total del pedido inválido");
      }
      const deposit = Math.ceil(totalPrice * 0.5);

      const residencyUnit = residency.residency ? residency.residency.unit : null;
      const delivery = resolveWebDelivery(settings, { residencyUnit, customerAddress: d.customer_address });
      const orderNumber = `CAKE-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const cakeOrderId = crypto.randomUUID();

      const r = await client.query(
        `INSERT INTO cake_orders
           (id, order_number, customer_name, customer_phone, customer_email, customer_address,
            size_option_id, layers_option_id, sponge_option_id, filling_option_id, decoration_option_id, theme_option_id,
            base_price_clp, extras_price_clp, total_price_clp, deposit_clp, notes, status,
            client_request_id, residency_unit, residency_declared_at, delivery_date,
            payment_method, public_token, payment_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PENDING_PAYMENT',
                 $18, $19, CASE WHEN $19::text IS NULL THEN NULL ELSE NOW() END, $20,
                 $21, $22, CASE WHEN $23::int IS NULL THEN NULL ELSE NOW() + ($23::int * interval '1 minute') END)
         RETURNING ${CAKE_ORDER_SUMMARY_COLUMNS}`,
        [
          cakeOrderId, orderNumber, d.customer_name, d.customer_phone, normalizeEmail(d.customer_email), delivery.delivery_address,
          d.size_option_id ?? null, d.layers_option_id ?? null, d.sponge_option_id ?? null,
          d.filling_option_id ?? null, d.decoration_option_id ?? null, d.theme_option_id ?? null,
          basePrice, extrasPrice, totalPrice, deposit, d.notes ?? null,
          d.client_request_id ?? null, residencyUnit, d.delivery_date ?? null,
          online ? "ONLINE" : "MANUAL",
          online ? newAccessToken() : null,
          online ? paymentsRuntime.getConfig().window.ttlMinutes : null,
        ]
      );

      await recordOrderEvent(client, {
        cakeOrderId,
        type: "CAKE_ORDER_CREATED",
        to: "PENDING_PAYMENT",
        source: "PUBLIC",
        data: {
          channel: "WEB",
          payment_method: online ? "ONLINE" : "MANUAL",
          sales_mode: settings.sales_mode,
          residency_declared: Boolean(residencyUnit),
        },
      });
      return { replay: false, order: r.rows[0] };
    });

    return res.json(cakeOrderResponse(result.order, { replay: result.replay }));
  } catch (e) {
    if (d.client_request_id && isUniqueViolation(e, "uq_cake_orders_client_request_id")) {
      try {
        const existing = await findCakeByRequestId(getPool(), d.client_request_id);
        if (existing) return res.json(cakeOrderResponse(existing, { replay: true }));
      } catch (lookupError) {
        return sendError(res, lookupError, { context: "POST /public/cake-builder/orders (idempotencia)" });
      }
    }
    return sendError(res, e, { context: "POST /public/cake-builder/orders" });
  }
});

module.exports = router;
