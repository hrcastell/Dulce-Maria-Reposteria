const test = require("node:test");
const assert = require("node:assert/strict");

const { parsePaymentsConfig, describePaymentsConfig } = require("../../src/lib/payments/config");
const { INTEGRATION_COMMERCE_CODE, INTEGRATION_API_KEY_SECRET } = require("../../src/lib/payments/webpay/constants");

const DEV_BASE = {
  NODE_ENV: "development",
  PUBLIC_SITE_URL: "http://localhost:4303",
  API_PUBLIC_URL: "http://localhost:4301",
};
const PROD_BASE = {
  NODE_ENV: "production",
  PUBLIC_SITE_URL: "https://dulcemaria.hrcastell.com",
  API_PUBLIC_URL: "https://api.dulcemaria.hrcastell.com",
};
const LIVE_SECRET = "f".repeat(64);
const MP_TOKEN = "APP_USR-1234567890123456-102100-abcdefabcdefabcdefabcdefabcdefab-123456789";
const MP_SECRET = "s".repeat(64);

test("sin variables: ningún proveedor habilitado, sin problemas; ventana 30/60 min y 5 intentos por defecto", () => {
  const config = parsePaymentsConfig({ NODE_ENV: "development" });
  assert.equal(config.providers.WEBPAY.enabled, false);
  assert.equal(config.providers.WEBPAY.requested, false);
  assert.equal(config.providers.MERCADOPAGO.enabled, false);
  assert.deepEqual(config.providers.WEBPAY.problems, []);
  assert.deepEqual(config.window, { ttlMinutes: 30, maxMinutes: 60, maxAttempts: 5 });
  assert.equal(config.urls.paymentPagePath, "/pago/");
  assert.ok(Object.isFrozen(config));
});

test("Webpay en integración usa las credenciales públicas de Transbank y el host de integración", () => {
  const config = parsePaymentsConfig({ ...DEV_BASE, WEBPAY_ENABLED: "true" });
  const webpay = config.providers.WEBPAY;
  assert.equal(webpay.enabled, true);
  assert.equal(webpay.environment, "integration");
  assert.equal(webpay.commerceCode, INTEGRATION_COMMERCE_CODE);
  assert.equal(webpay.apiKeySecret, INTEGRATION_API_KEY_SECRET);
  assert.equal(webpay.host, "webpay3gint.transbank.cl");
  assert.equal(webpay.returnUrl, "http://localhost:4301/public/payments/webpay/return");
  assert.equal(config.urls.paymentPageUrl, "http://localhost:4303/pago/");
});

test("Webpay en producción exige código de comercio y API Key propios; nunca cae en las credenciales de integración", () => {
  const missing = parsePaymentsConfig({ ...PROD_BASE, WEBPAY_ENABLED: "true", TRANSBANK_ENV: "production" });
  assert.equal(missing.providers.WEBPAY.enabled, false);
  assert.ok(missing.providers.WEBPAY.problems.some((p) => /TRANSBANK_COMMERCE_CODE/.test(p)));
  assert.ok(missing.providers.WEBPAY.problems.some((p) => /TRANSBANK_API_KEY_SECRET/.test(p)));

  const reused = parsePaymentsConfig({
    ...PROD_BASE,
    WEBPAY_ENABLED: "true",
    TRANSBANK_ENV: "production",
    TRANSBANK_COMMERCE_CODE: INTEGRATION_COMMERCE_CODE,
    TRANSBANK_API_KEY_SECRET: INTEGRATION_API_KEY_SECRET,
  });
  assert.equal(reused.providers.WEBPAY.enabled, false);
  assert.equal(reused.providers.WEBPAY.problems.length >= 2, true);

  const ok = parsePaymentsConfig({
    ...PROD_BASE,
    WEBPAY_ENABLED: "true",
    TRANSBANK_ENV: "production",
    TRANSBANK_COMMERCE_CODE: "597012345678",
    TRANSBANK_API_KEY_SECRET: LIVE_SECRET,
  });
  assert.equal(ok.providers.WEBPAY.enabled, true);
  assert.equal(ok.providers.WEBPAY.host, "webpay3g.transbank.cl");
  assert.equal(ok.providers.WEBPAY.returnUrl, "https://api.dulcemaria.hrcastell.com/public/payments/webpay/return");
});

test("TRANSBANK_ENV=production fuera de NODE_ENV=production → deshabilitado (ninguna máquina de desarrollo cobra dinero real)", () => {
  const config = parsePaymentsConfig({
    ...DEV_BASE,
    WEBPAY_ENABLED: "true",
    TRANSBANK_ENV: "production",
    TRANSBANK_COMMERCE_CODE: "597012345678",
    TRANSBANK_API_KEY_SECRET: LIVE_SECRET,
  });
  assert.equal(config.providers.WEBPAY.enabled, false);
  assert.ok(config.providers.WEBPAY.problems.some((p) => /NODE_ENV/.test(p)));
});

test("NODE_ENV=production con TRANSBANK_ENV=integration: habilitado pero con advertencia ruidosa", () => {
  const config = parsePaymentsConfig({ ...PROD_BASE, WEBPAY_ENABLED: "true" });
  assert.equal(config.providers.WEBPAY.enabled, true);
  assert.equal(config.providers.WEBPAY.environment, "integration");
  assert.ok(config.warnings.some((w) => /integración/i.test(w) && /producción/i.test(w)));
});

test("en producción las URLs públicas deben ser https, sin query ni fragmento", () => {
  const config = parsePaymentsConfig({
    NODE_ENV: "production",
    WEBPAY_ENABLED: "true",
    PUBLIC_SITE_URL: "http://dulcemaria.hrcastell.com",
    API_PUBLIC_URL: "https://api.dulcemaria.hrcastell.com/?x=1",
  });
  assert.equal(config.providers.WEBPAY.enabled, false);
  assert.ok(config.problems.some((p) => /PUBLIC_SITE_URL/.test(p)));
  assert.ok(config.problems.some((p) => /API_PUBLIC_URL/.test(p)));
});

test("con un proveedor habilitado faltan las URLs públicas → deshabilitado", () => {
  const config = parsePaymentsConfig({ NODE_ENV: "development", WEBPAY_ENABLED: "true" });
  assert.equal(config.providers.WEBPAY.enabled, false);
  assert.ok(config.problems.some((p) => /PUBLIC_SITE_URL/.test(p)));
});

test("TRANSBANK_RETURN_URL opcional y acotada a 255 caracteres", () => {
  const custom = parsePaymentsConfig({ ...DEV_BASE, WEBPAY_ENABLED: "true", TRANSBANK_RETURN_URL: "http://localhost:4301/dulcemaria/public/payments/webpay/return" });
  assert.equal(custom.providers.WEBPAY.returnUrl, "http://localhost:4301/dulcemaria/public/payments/webpay/return");
  const long = parsePaymentsConfig({ ...DEV_BASE, WEBPAY_ENABLED: "true", TRANSBANK_RETURN_URL: `http://localhost:4301/${"a".repeat(260)}` });
  assert.equal(long.providers.WEBPAY.enabled, false);
});

test("Mercado Pago: requiere token, secreto de webhook y API https (las back_urls http se descartan)", () => {
  const missing = parsePaymentsConfig({ ...PROD_BASE, MERCADOPAGO_ENABLED: "true" });
  assert.equal(missing.providers.MERCADOPAGO.enabled, false);
  assert.ok(missing.providers.MERCADOPAGO.problems.some((p) => /MERCADOPAGO_ACCESS_TOKEN/.test(p)));
  assert.ok(missing.providers.MERCADOPAGO.problems.some((p) => /MERCADOPAGO_WEBHOOK_SECRET/.test(p)));

  const http = parsePaymentsConfig({ ...DEV_BASE, MERCADOPAGO_ENABLED: "true", MERCADOPAGO_ACCESS_TOKEN: MP_TOKEN, MERCADOPAGO_WEBHOOK_SECRET: MP_SECRET });
  assert.equal(http.providers.MERCADOPAGO.enabled, false);
  assert.ok(http.providers.MERCADOPAGO.problems.some((p) => /https/.test(p)));

  const ok = parsePaymentsConfig({ ...PROD_BASE, MERCADOPAGO_ENABLED: "true", MERCADOPAGO_ENV: "production", MERCADOPAGO_ACCESS_TOKEN: MP_TOKEN, MERCADOPAGO_WEBHOOK_SECRET: MP_SECRET });
  assert.equal(ok.providers.MERCADOPAGO.enabled, true);
  assert.equal(ok.providers.MERCADOPAGO.environment, "production");
  assert.equal(ok.providers.MERCADOPAGO.maxInstallments, null);
});

test("Mercado Pago: cuotas 1..36, descriptor ≤ 13 y producción solo con NODE_ENV=production", () => {
  const base = { ...PROD_BASE, MERCADOPAGO_ENABLED: "true", MERCADOPAGO_ACCESS_TOKEN: MP_TOKEN, MERCADOPAGO_WEBHOOK_SECRET: MP_SECRET };
  assert.equal(parsePaymentsConfig({ ...base, MERCADOPAGO_MAX_INSTALLMENTS: "1" }).providers.MERCADOPAGO.maxInstallments, 1);
  assert.equal(parsePaymentsConfig({ ...base, MERCADOPAGO_MAX_INSTALLMENTS: "37" }).providers.MERCADOPAGO.enabled, false);
  assert.equal(parsePaymentsConfig({ ...base, MERCADOPAGO_MAX_INSTALLMENTS: "dos" }).providers.MERCADOPAGO.enabled, false);
  assert.equal(parsePaymentsConfig({ ...base, MERCADOPAGO_STATEMENT_DESCRIPTOR: "DULCEMARIA" }).providers.MERCADOPAGO.statementDescriptor, "DULCEMARIA");
  assert.equal(parsePaymentsConfig({ ...base, MERCADOPAGO_STATEMENT_DESCRIPTOR: "DULCE MARIA REPOSTERIA" }).providers.MERCADOPAGO.enabled, false);
  const devProd = parsePaymentsConfig({
    ...base,
    NODE_ENV: "development",
    PUBLIC_SITE_URL: "https://tunel.example.com",
    API_PUBLIC_URL: "https://tunel-api.example.com",
    MERCADOPAGO_ENV: "production",
  });
  assert.equal(devProd.providers.MERCADOPAGO.enabled, false);
  const devTest = parsePaymentsConfig({ ...base, NODE_ENV: "development", MERCADOPAGO_ENV: "test", API_PUBLIC_URL: "https://tunel-api.example.com" });
  assert.equal(devTest.providers.MERCADOPAGO.enabled, true);
  assert.equal(devTest.providers.MERCADOPAGO.environment, "integration");
});

test("Mercado Pago: API oficial por defecto; un simulador local solo fuera de producción y solo en localhost", () => {
  const base = { MERCADOPAGO_ENABLED: "true", MERCADOPAGO_ACCESS_TOKEN: MP_TOKEN, MERCADOPAGO_WEBHOOK_SECRET: MP_SECRET };
  const official = parsePaymentsConfig({ ...PROD_BASE, ...base });
  assert.equal(official.providers.MERCADOPAGO.apiBaseUrl, "https://api.mercadopago.com");
  assert.equal(official.providers.MERCADOPAGO.devMock, false);
  const ignoredInProd = parsePaymentsConfig({ ...PROD_BASE, ...base, PAYMENTS_DEV_MP_API_BASE: "http://127.0.0.1:4999" });
  assert.equal(ignoredInProd.providers.MERCADOPAGO.apiBaseUrl, "https://api.mercadopago.com");
  assert.ok(ignoredInProd.warnings.some((w) => /PAYMENTS_DEV_MP_API_BASE/.test(w)));
  const dev = parsePaymentsConfig({ ...DEV_BASE, ...base, API_PUBLIC_URL: "https://tunel-api.example.com", PAYMENTS_DEV_MP_API_BASE: "http://127.0.0.1:4999" });
  assert.equal(dev.providers.MERCADOPAGO.apiBaseUrl, "http://127.0.0.1:4999");
  assert.equal(dev.providers.MERCADOPAGO.devMock, true);
  const foreign = parsePaymentsConfig({ ...DEV_BASE, ...base, API_PUBLIC_URL: "https://tunel-api.example.com", PAYMENTS_DEV_MP_API_BASE: "http://evil.example.com" });
  assert.equal(foreign.providers.MERCADOPAGO.apiBaseUrl, "https://api.mercadopago.com");
});

test("valores inválidos de entorno o banderas → deshabilitado con problema (nunca botan la app)", () => {
  assert.equal(parsePaymentsConfig({ ...DEV_BASE, WEBPAY_ENABLED: "true", TRANSBANK_ENV: "prod" }).providers.WEBPAY.enabled, false);
  const weird = parsePaymentsConfig({ ...DEV_BASE, WEBPAY_ENABLED: "si" });
  assert.equal(weird.providers.WEBPAY.enabled, false);
  assert.ok(weird.warnings.some((w) => /WEBPAY_ENABLED/.test(w)));
});

test("ventana de pago configurable y acotada", () => {
  assert.deepEqual(parsePaymentsConfig({ PAYMENT_ORDER_TTL_MINUTES: "20", PAYMENT_ORDER_MAX_MINUTES: "45", PAYMENT_MAX_ATTEMPTS_PER_ORDER: "3" }).window, {
    ttlMinutes: 20,
    maxMinutes: 45,
    maxAttempts: 3,
  });
  const bad = parsePaymentsConfig({ PAYMENT_ORDER_TTL_MINUTES: "5", PAYMENT_ORDER_MAX_MINUTES: "10", PAYMENT_MAX_ATTEMPTS_PER_ORDER: "0" });
  assert.deepEqual(bad.window, { ttlMinutes: 30, maxMinutes: 60, maxAttempts: 5 });
  assert.ok(bad.warnings.length >= 3);
  // El tope nunca es menor que la ventana.
  assert.equal(parsePaymentsConfig({ PAYMENT_ORDER_TTL_MINUTES: "90" }).window.maxMinutes, 90);
});

test("PUBLIC_PAYMENT_PAGE_PATH: ruta absoluta segura; si no, se usa /pago/", () => {
  assert.equal(parsePaymentsConfig({ ...DEV_BASE, PUBLIC_PAYMENT_PAGE_PATH: "/pagos/resultado.html" }).urls.paymentPagePath, "/pagos/resultado.html");
  for (const bad of ["pago", "//evil.example.com/", "/pago?x=1", "/pago#x", "/pa go/"]) {
    const config = parsePaymentsConfig({ ...DEV_BASE, PUBLIC_PAYMENT_PAGE_PATH: bad });
    assert.equal(config.urls.paymentPagePath, "/pago/", bad);
    assert.ok(config.warnings.some((w) => /PUBLIC_PAYMENT_PAGE_PATH/.test(w)), bad);
  }
});

test("PAYMENTS_CRON_TOKEN: opcional; corto = ignorado con problema", () => {
  assert.equal(parsePaymentsConfig({}).cronToken, null);
  assert.equal(parsePaymentsConfig({ PAYMENTS_CRON_TOKEN: "corto" }).cronToken, null);
  assert.equal(parsePaymentsConfig({ PAYMENTS_CRON_TOKEN: "c".repeat(40) }).cronToken, "c".repeat(40));
});

test("la descripción pública nunca incluye secretos", () => {
  const config = parsePaymentsConfig({
    ...PROD_BASE,
    WEBPAY_ENABLED: "true",
    TRANSBANK_ENV: "production",
    TRANSBANK_COMMERCE_CODE: "597012345678",
    TRANSBANK_API_KEY_SECRET: LIVE_SECRET,
    MERCADOPAGO_ENABLED: "true",
    MERCADOPAGO_ENV: "production",
    MERCADOPAGO_ACCESS_TOKEN: MP_TOKEN,
    MERCADOPAGO_WEBHOOK_SECRET: MP_SECRET,
    PAYMENTS_CRON_TOKEN: "c".repeat(40),
  });
  const text = JSON.stringify(describePaymentsConfig(config, { schemaOk: true }));
  for (const secret of [LIVE_SECRET, MP_TOKEN, MP_SECRET, "c".repeat(40), "597012345678"]) {
    assert.equal(text.includes(secret), false, secret.slice(0, 10));
  }
  const problemsText = JSON.stringify([config.problems, config.warnings, config.providers.WEBPAY.problems, config.providers.MERCADOPAGO.problems]);
  assert.equal(problemsText.includes(LIVE_SECRET), false);
  const described = describePaymentsConfig(config, { schemaOk: false });
  assert.equal(described.providers.find((p) => p.id === "WEBPAY").enabled, false);
  assert.ok(described.providers.find((p) => p.id === "WEBPAY").problems.some((p) => /esquema/i.test(p)));
});
