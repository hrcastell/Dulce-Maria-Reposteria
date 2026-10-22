const express = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const { getPool, withTransaction } = require("../db");
const { validationError, sendError, appError, unavailableError, isUniqueViolation } = require("../lib/httpErrors");
const { resolveOrderLines, insertOrderLines, computeOrderTotals } = require("../lib/orderLines");
const { assertLinesAvailable, reserveLines } = require("../lib/orderStock");
const paymentsRuntime = require("../lib/payments/runtime");
const { newAccessToken } = require("../lib/payments/references");
const { getPaymentSettings, effectiveManualEnabled } = require("../lib/payments/settings");
const { recordOrderEvent } = require("../lib/orderEvents");
const {
  getSalesSettings,
  residencyInputSchema,
  evaluateResidency,
  residentsOnlyErrorBody,
  resolveWebDelivery,
} = require("../lib/salesSettings");
const { santiagoToday, validateDeliveryDate } = require("../lib/santiagoTime");
const { normalizeEmail } = require("../lib/customerIdentity");
const { findOrCreateWebCustomer, countRecentWebOrders } = require("../lib/webCustomers");

const router = express.Router();

// Anti-spam por teléfono (B-19): se cuenta en la base, así vale para todos
// los procesos de Passenger (el límite por IP vive en memoria de cada uno).
const MAX_WEB_ORDERS_PER_PHONE_PER_HOUR = 5;

function publicOrderCode() {
  return `WEB-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,30}$/, "Teléfono inválido.")
  .refine((value) => value.replace(/\D/g, "").length >= 8, "El teléfono debe tener al menos 8 dígitos.");

const orderSchema = z
  .object({
    customer_name: z.string().trim().min(2).max(200),
    customer_phone: phoneSchema,
    customer_address: z.string().trim().max(400).optional().nullable(),
    customer_email: z.string().trim().email().max(200).optional().nullable(),
    items: z
      .array(
        z
          .object({
            product_id: z.string().uuid(),
            variant_id: z.string().uuid().nullable().optional(),
            qty: z.number().int().positive().max(50),
          })
          .strict()
      )
      .min(1)
      .max(30),
    // Modo solo residentes (D2): { declared: true, unit: "Torre B, depto 1203" }.
    residency: residencyInputSchema.optional().nullable(),
    // Fecha de entrega preferida (calendario de Chile; hoy o después).
    delivery_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida: usa AAAA-MM-DD.").optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
    // Idempotencia: el mismo UUID repetido devuelve el pedido original.
    client_request_id: z.string().uuid().optional(),
    // MANUAL = coordinar pago por WhatsApp/transferencia; ONLINE = Webpay o
    // Mercado Pago (reserva el stock y devuelve el token de acceso al pago).
    payment_method: z.enum(["MANUAL", "ONLINE"]).optional(),
  })
  .strict();

const ORDER_SUMMARY_COLUMNS = `id, order_no, order_code, total_clp, status, payment_status, payment_method, delivery_method,
  delivery_address, delivery_fee_clp, delivery_date, residency_unit, public_token, payment_expires_at`;

function orderResponse(order, { replay = false } = {}) {
  const online = order.payment_method === "ONLINE";
  return {
    ok: true,
    order_id: order.id,
    order_number: order.order_code,
    order_no: order.order_no,
    total_clp: Number(order.total_clp),
    status: order.status,
    payment_status: order.payment_status,
    payment_method: online ? "ONLINE" : "MANUAL",
    delivery_method: order.delivery_method,
    delivery_address: order.delivery_address,
    delivery_fee_clp: Number(order.delivery_fee_clp),
    delivery_date: order.delivery_date,
    residency_unit: order.residency_unit,
    // Pago en línea: capacidad para la página /pago/#t=<token> (va en el fragmento, nunca en la URL del servidor).
    ...(online ? { access_token: order.public_token, payment_expires_at: order.payment_expires_at } : {}),
    ...(replay ? { idempotent_replay: true } : {}),
  };
}

async function findByRequestId(db, clientRequestId) {
  const r = await db.query(`SELECT ${ORDER_SUMMARY_COLUMNS} FROM orders WHERE client_request_id = $1 LIMIT 1`, [clientRequestId]);
  return r.rows[0] || null;
}

/**
 * POST /public/orders — pedido de catálogo desde el sitio público.
 *
 * - MANUAL (por defecto): se coordina el pago por WhatsApp. No reserva stock
 *   (stock_reservation_status = NONE): se descuenta cuando el panel confirma
 *   el pedido (lib/orderStatus.js). Si el flujo manual está desactivado en el
 *   panel (y hay pago en línea), 409 MANUAL_PAYMENTS_DISABLED.
 * - ONLINE (Webpay / Mercado Pago): RESERVA el stock al crearse
 *   (stock_reservation_status = RESERVED), fija el plazo de pago y devuelve el
 *   token de acceso para iniciar el pago (POST /public/payments). Sin
 *   proveedores habilitados → 503 ONLINE_PAYMENTS_UNAVAILABLE.
 * - Precios, variantes y stock se validan en el servidor.
 * - Modo solo residentes: sin declaración de residencia → 403 RESIDENTS_ONLY.
 *   La entrega es en el condominio (dirección + unidad) y sin costo.
 * - client_request_id repetido → 200 con el pedido original (y su token).
 * - Una ficha de cliente web se reutiliza solo si coinciden teléfono y nombre;
 *   nunca se modifica una ficha existente.
 */
router.post("/", async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
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
        const existing = await findByRequestId(client, d.client_request_id);
        if (existing) return { replay: true, order: existing };
      }

      const onlineProviders = paymentsRuntime.enabledProviders();
      if (online && !onlineProviders.length) {
        throw unavailableError("ONLINE_PAYMENTS_UNAVAILABLE", "El pago en línea no está disponible en este momento. Puedes coordinar tu pedido por WhatsApp.");
      }
      if (!online && !effectiveManualEnabled(await getPaymentSettings(client), onlineProviders)) {
        throw appError(409, "MANUAL_PAYMENTS_DISABLED", "Por ahora los pedidos se pagan en línea: elige Webpay o Mercado Pago.");
      }

      const settings = await getSalesSettings(client);
      const residency = evaluateResidency(settings, d.residency);
      if (!residency.allowed) {
        const body = residentsOnlyErrorBody(settings);
        throw appError(403, body.code, body.error, { whatsapp_number: body.whatsapp_number });
      }

      const recent = await countRecentWebOrders(client, d.customer_phone);
      if (recent >= MAX_WEB_ORDERS_PER_PHONE_PER_HOUR) {
        throw appError(
          429,
          "TOO_MANY_ORDERS",
          "Recibimos varios pedidos con este teléfono en la última hora. Escríbenos por WhatsApp para completar tu pedido.",
          { whatsapp_number: settings.whatsapp_number }
        );
      }

      const items = d.items.map((item) => ({ productId: item.product_id, variantId: item.variant_id || null, qty: item.qty, toppings: [] }));
      const { lines, subtotal } = await resolveOrderLines(client, items, { allowToppings: false });
      if (subtotal <= 0) throw appError(400, "ORDER_TOTAL_INVALID", "Total del pedido inválido");
      // En línea: se descuenta el stock ahora (reserva; se libera si el pago vence).
      // Manual: sin reserva, pero no se aceptan pedidos sin stock.
      if (online) await reserveLines(client, lines);
      else await assertLinesAvailable(client, lines);
      const totals = computeOrderTotals({ subtotal });

      const residencyUnit = residency.residency ? residency.residency.unit : null;
      const delivery = resolveWebDelivery(settings, { residencyUnit, customerAddress: d.customer_address });
      const customer = await findOrCreateWebCustomer(client, {
        name: d.customer_name,
        phone: d.customer_phone,
        email: d.customer_email,
        address: delivery.delivery_address,
      });

      const orderId = crypto.randomUUID();
      const inserted = await client.query(
        `INSERT INTO orders (
           id, order_code, customer_id, status, payment_status, payment_method,
           delivery_method, subtotal_clp, delivery_fee_clp, total_clp,
           stock_reservation_status, client_request_id,
           residency_unit, residency_declared_at, delivery_address, delivery_date, notes, contact_email,
           channel, public_token, payment_expires_at,
           created_at, updated_at
         )
         VALUES ($1,$2,$3,'PENDING_PAYMENT','PENDING',$14,$4,$5,$6,$7,$15,$8,
                 $9, CASE WHEN $9::text IS NULL THEN NULL ELSE NOW() END, $10, $11, $12, $13,
                 'WEB', $16, CASE WHEN $17::int IS NULL THEN NULL ELSE NOW() + ($17::int * interval '1 minute') END,
                 NOW(), NOW())
         RETURNING ${ORDER_SUMMARY_COLUMNS}`,
        [
          orderId,
          publicOrderCode(),
          customer.customerId,
          delivery.delivery_method,
          totals.subtotal,
          delivery.delivery_fee_clp,
          totals.subtotal + delivery.delivery_fee_clp,
          d.client_request_id ?? null,
          residencyUnit,
          delivery.delivery_address,
          d.delivery_date ?? null,
          d.notes || null,
          normalizeEmail(d.customer_email),
          online ? "ONLINE" : "TRANSFER",
          online ? "RESERVED" : "NONE",
          online ? newAccessToken() : null,
          online ? paymentsRuntime.getConfig().window.ttlMinutes : null,
        ]
      );
      await insertOrderLines(client, orderId, lines);
      await recordOrderEvent(client, {
        orderId,
        type: "ORDER_CREATED",
        to: "PENDING_PAYMENT",
        source: "PUBLIC",
        data: {
          channel: "WEB",
          payment_method: online ? "ONLINE" : "MANUAL",
          sales_mode: settings.sales_mode,
          residency_declared: Boolean(residencyUnit),
          customer_reused: customer.reused,
          stock: online ? "RESERVED" : "NONE",
        },
      });
      return { replay: false, order: inserted.rows[0] };
    });

    if (result.replay) return res.status(200).json(orderResponse(result.order, { replay: true }));
    return res.status(201).json(orderResponse(result.order));
  } catch (error) {
    // Dos envíos simultáneos con el mismo client_request_id: gana uno, el otro
    // recibe el pedido ganador.
    if (d.client_request_id && isUniqueViolation(error, "uq_orders_client_request_id")) {
      try {
        const existing = await findByRequestId(getPool(), d.client_request_id);
        if (existing) return res.status(200).json(orderResponse(existing, { replay: true }));
      } catch (lookupError) {
        return sendError(res, lookupError, { context: "POST /public/orders (idempotencia)" });
      }
    }
    return sendError(res, error, { context: "POST /public/orders" });
  }
});

module.exports = router;
