const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeWebpayPayload,
  sanitizeMpPayment,
  sanitizeMpRefund,
  sanitizeMpNotification,
  sanitizeErrorText,
  redactUrlForLog,
} = require("../../src/lib/payments/sanitize");

const WEBPAY_COMMIT = {
  vci: "TSY",
  amount: 25000,
  status: "AUTHORIZED",
  buy_order: "DM3F-K9X2M4QZ",
  session_id: "00000000-0000-4000-8000-000000000001",
  card_detail: { card_number: "6623", extra: "x" },
  accounting_date: "1021",
  transaction_date: "2026-10-21T21:05:00.000Z",
  authorization_code: "1213",
  payment_type_code: "VN",
  response_code: 0,
  installments_number: 0,
  installments_amount: null,
  balance: 0,
  secret_field: "nope",
  nested: { tbk: "nope" },
};

test("Webpay: se conserva la lista blanca y la tarjeta solo con sus últimos 4 dígitos", () => {
  const clean = sanitizeWebpayPayload(WEBPAY_COMMIT);
  assert.deepEqual(clean, {
    vci: "TSY",
    amount: 25000,
    status: "AUTHORIZED",
    buy_order: "DM3F-K9X2M4QZ",
    session_id: "00000000-0000-4000-8000-000000000001",
    card_last4: "6623",
    accounting_date: "1021",
    transaction_date: "2026-10-21T21:05:00.000Z",
    authorization_code: "1213",
    payment_type_code: "VN",
    response_code: 0,
    installments_number: 0,
    installments_amount: null,
    balance: 0,
  });
  assert.equal(sanitizeWebpayPayload({ card_detail: { card_number: "4051885600446623" } }).card_last4, "6623");
  assert.equal(sanitizeWebpayPayload({ card_detail: { card_number: "XXXX" } }).card_last4, undefined);
  assert.deepEqual(sanitizeWebpayPayload(null), {});
  assert.deepEqual(sanitizeWebpayPayload("x"), {});
});

test("Webpay: los textos largos se recortan y el error se limpia", () => {
  const clean = sanitizeWebpayPayload({ status: "x".repeat(300), error_message: "Invalid status '0' for transaction" });
  assert.equal(clean.status.length, 100);
  assert.equal(clean.error_message, "Invalid status '0' for transaction");
});

test("Mercado Pago: se descartan payer, cardholder y metadatos; se conserva lo necesario", () => {
  const payment = {
    id: 1234567890,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 25000,
    transaction_amount_refunded: 0,
    currency_id: "CLP",
    external_reference: "DM3F-K9X2M4QZ",
    payment_type_id: "credit_card",
    payment_method_id: "visa",
    installments: 1,
    date_created: "2026-10-21T18:00:00.000-03:00",
    date_approved: "2026-10-21T18:00:05.000-03:00",
    date_last_updated: "2026-10-21T18:00:05.000-03:00",
    live_mode: false,
    captured: true,
    binary_mode: true,
    payer: { email: "comprador@example.com", identification: { type: "RUT", number: "11111111-1" } },
    card: { last_four_digits: "5678", cardholder: { name: "APRO", identification: { number: "123" } }, first_six_digits: "450995" },
    metadata: { payment_id: "x" },
    additional_info: { ip_address: "1.2.3.4" },
  };
  const clean = sanitizeMpPayment(payment);
  assert.deepEqual(clean, {
    id: "1234567890",
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 25000,
    transaction_amount_refunded: 0,
    currency_id: "CLP",
    external_reference: "DM3F-K9X2M4QZ",
    payment_type_id: "credit_card",
    payment_method_id: "visa",
    installments: 1,
    date_created: "2026-10-21T18:00:00.000-03:00",
    date_approved: "2026-10-21T18:00:05.000-03:00",
    date_last_updated: "2026-10-21T18:00:05.000-03:00",
    live_mode: false,
    captured: true,
    binary_mode: true,
    card_last4: "5678",
  });
  const text = JSON.stringify(clean);
  assert.equal(/comprador|11111111|APRO|450995|1\.2\.3\.4/.test(text), false);
});

test("Mercado Pago: reembolso y notificación saneados", () => {
  assert.deepEqual(sanitizeMpRefund({ id: 99, payment_id: 1234, amount: 5000, status: "approved", date_created: "d", source: { name: "x" } }), {
    id: "99",
    payment_id: "1234",
    amount: 5000,
    status: "approved",
    date_created: "d",
  });
  assert.deepEqual(
    sanitizeMpNotification({ id: 12345, live_mode: true, type: "payment", action: "payment.created", api_version: "v1", date_created: "d", user_id: 77, data: { id: "999" } }),
    { id: "12345", live_mode: true, type: "payment", action: "payment.created", api_version: "v1", date_created: "d", data_id: "999" }
  );
});

test("sanitizeErrorText recorta, quita saltos de línea y oculta secuencias que parecen tokens", () => {
  assert.equal(sanitizeErrorText("a\nb\r\nc"), "a b c");
  assert.equal(sanitizeErrorText("error ".repeat(100)).length, 200);
  assert.equal(sanitizeErrorText("x".repeat(500)), "[redactado]");
  assert.equal(
    sanitizeErrorText("token 01ab7ef7671c42020d22a02561a94f4d68811e84e9079c6a6443efdb9535f9e6 inválido"),
    "token [redactado] inválido"
  );
  assert.equal(sanitizeErrorText(null), null);
  assert.equal(sanitizeErrorText(new Error("boom")), "boom");
});

test("redactUrlForLog: oculta valores de la query y segmentos con forma de token", () => {
  assert.equal(
    redactUrlForLog("/public/payments/webpay/return?token_ws=01ab7ef7671c42020d22a02561a94f4d68811e84e9079c6a6443efdb9535f9e6"),
    "/public/payments/webpay/return?token_ws=***"
  );
  assert.equal(
    redactUrlForLog("/dulcemaria/public/payments/webpay/return?TBK_TOKEN=abc&TBK_ORDEN_COMPRA=DM1-AAAAAAAA&TBK_ID_SESION=s"),
    "/dulcemaria/public/payments/webpay/return?TBK_TOKEN=***&TBK_ORDEN_COMPRA=***&TBK_ID_SESION=***"
  );
  assert.equal(redactUrlForLog("/admin/orders?q=juan%20perez&status=PAID"), "/admin/orders?q=***&status=***");
  assert.equal(redactUrlForLog("/public/payments/status/" + "A".repeat(43)), "/public/payments/status/[redactado]");
  // Los UUID se conservan (útiles para depurar el panel).
  assert.equal(
    redactUrlForLog("/admin/orders/00000000-0000-4000-8000-000000000001/status"),
    "/admin/orders/00000000-0000-4000-8000-000000000001/status"
  );
  assert.equal(redactUrlForLog("/health"), "/health");
  assert.equal(redactUrlForLog(""), "");
  assert.equal(redactUrlForLog(undefined), "-");
  assert.equal(redactUrlForLog("https://sitio.cl/pago/?a=1#t=secreto"), "https://sitio.cl/pago/?a=***");
});
