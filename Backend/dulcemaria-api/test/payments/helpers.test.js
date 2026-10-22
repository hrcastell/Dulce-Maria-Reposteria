const test = require("node:test");
const assert = require("node:assert/strict");

const { providerFieldsFrom } = require("../../src/lib/payments/apply");
const { parseManualEnabled, effectiveManualEnabled } = require("../../src/lib/payments/settings");
const { paymentWarnings, PAYMENT_ENV_VARS } = require("../../src/config/env");

test("providerFieldsFrom copia los datos del proveedor del mismo pago", () => {
  const fields = providerFieldsFrom(
    { provider: "WEBPAY", provider_payment_id: null },
    { kind: "APPROVED", sanitized: { status: "AUTHORIZED" }, authorizationCode: "1213", cardLast4: "6623", responseCode: 0, providerStatus: "AUTHORIZED" }
  );
  assert.deepEqual(fields, { provider_payload: { status: "AUTHORIZED" }, provider_status: "AUTHORIZED", response_code: 0, authorization_code: "1213", card_last4: "6623" });
  assert.deepEqual(providerFieldsFrom({ provider: "WEBPAY" }, { kind: "CREATE_FAILED" }), {});
});

test("providerFieldsFrom: el id de pago de MP se fija solo con dinero movido y nunca se toman datos de OTRO pago", () => {
  const approved = providerFieldsFrom({ provider: "MERCADOPAGO", provider_payment_id: null }, { kind: "APPROVED", sanitized: {}, providerPaymentId: "123" });
  assert.equal(approved.provider_payment_id, "123");
  const rejected = providerFieldsFrom({ provider: "MERCADOPAGO", provider_payment_id: null }, { kind: "REJECTED_RETRYABLE", sanitized: {}, providerPaymentId: "124" });
  assert.equal(rejected.provider_payment_id, undefined);
  assert.deepEqual(providerFieldsFrom({ provider: "MERCADOPAGO", provider_payment_id: "123" }, { kind: "APPROVED", sanitized: { x: 1 }, providerPaymentId: "999", cardLast4: "0000" }), {});
});

test("flujo manual: activo por defecto; si no hay pago en línea, siempre disponible", () => {
  assert.equal(parseManualEnabled(undefined), true);
  assert.equal(parseManualEnabled("true"), true);
  assert.equal(parseManualEnabled(" FALSE "), false);
  assert.equal(effectiveManualEnabled({ manual_enabled: false }, ["WEBPAY"]), false);
  assert.equal(effectiveManualEnabled({ manual_enabled: false }, []), true);
  assert.equal(effectiveManualEnabled({ manual_enabled: true }, ["WEBPAY"]), true);
});

test("validateEnv solo advierte por pagos (nunca bota la app) y nombra variables, no valores", () => {
  const secret = "f".repeat(64);
  const warnings = paymentWarnings({ NODE_ENV: "production", WEBPAY_ENABLED: "true", TRANSBANK_ENV: "production", TRANSBANK_API_KEY_SECRET: secret });
  assert.ok(warnings.some((w) => /WEBPAY queda DESHABILITADO/.test(w)));
  assert.equal(JSON.stringify(warnings).includes(secret), false);
  assert.deepEqual(paymentWarnings({ NODE_ENV: "development" }), []);
  for (const name of ["TRANSBANK_ENV", "TRANSBANK_COMMERCE_CODE", "TRANSBANK_API_KEY_SECRET", "PUBLIC_SITE_URL", "PUBLIC_PAYMENT_PAGE_PATH", "MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "MERCADOPAGO_MAX_INSTALLMENTS"]) {
    assert.ok(PAYMENT_ENV_VARS.includes(name), name);
  }
});
