const test = require("node:test");
const assert = require("node:assert/strict");

const { isAllowedRedirect } = require("../../src/lib/payments/redirectAllowlist");
const { createWebpayClient } = require("../../src/lib/payments/webpay/client");
const { createMercadoPagoClient } = require("../../src/lib/payments/mercadopago/client");
const { parsePaymentsConfig } = require("../../src/lib/payments/config");

const TOKEN = "01ab7ef7671c42020d22a02561a94f4d68811e84e9079c6a6443efdb9535f9e6";

function response(status, body) {
  const text = body === undefined ? "" : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => text };
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

const webpayConfig = parsePaymentsConfig({
  NODE_ENV: "development",
  WEBPAY_ENABLED: "true",
  PUBLIC_SITE_URL: "http://localhost:4303",
  API_PUBLIC_URL: "http://localhost:4301",
}).providers.WEBPAY;

const mpConfig = parsePaymentsConfig({
  NODE_ENV: "production",
  PUBLIC_SITE_URL: "https://dulcemaria.hrcastell.com",
  API_PUBLIC_URL: "https://api.dulcemaria.hrcastell.com",
  MERCADOPAGO_ENABLED: "true",
  MERCADOPAGO_ACCESS_TOKEN: "APP_USR-1234567890123456-102100-abcdefabcdefabcdef-123456789",
  MERCADOPAGO_WEBHOOK_SECRET: "s".repeat(64),
}).providers.MERCADOPAGO;

test("lista blanca de redirecciones: formulario de Webpay del entorno configurado y checkout oficial de Mercado Pago, solo https", () => {
  assert.equal(isAllowedRedirect({ provider: "WEBPAY", environment: "integration", url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" }), true);
  assert.equal(isAllowedRedirect({ provider: "WEBPAY", environment: "production", url: "https://webpay3g.transbank.cl/webpayserver/initTransaction" }), true);
  assert.equal(isAllowedRedirect({ provider: "WEBPAY", environment: "production", url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" }), false);
  assert.equal(isAllowedRedirect({ provider: "WEBPAY", environment: "integration", url: "http://webpay3gint.transbank.cl/x" }), false);
  assert.equal(isAllowedRedirect({ provider: "WEBPAY", environment: "integration", url: "https://webpay3gint.transbank.cl.evil.com/x" }), false);
  for (const ok of ["https://www.mercadopago.cl/checkout/v1/redirect?pref_id=1", "https://mercadopago.cl/x", "https://www.mercadopago.com/checkout/v1/redirect?pref_id=1"]) {
    assert.equal(isAllowedRedirect({ provider: "MERCADOPAGO", environment: "production", url: ok }), true, ok);
  }
  for (const bad of ["http://www.mercadopago.cl/x", "https://mercadopago.cl.evil.com/x", "https://evilmercadopago.cl/x", "javascript:alert(1)", "", null]) {
    assert.equal(isAllowedRedirect({ provider: "MERCADOPAGO", environment: "production", url: bad }), false, String(bad));
  }
  assert.equal(isAllowedRedirect({ provider: "MERCADOPAGO", environment: "integration", url: "http://127.0.0.1:4999/checkout?pref_id=1", extraHosts: ["127.0.0.1:4999"] }), true);
});

test("Webpay create: POST v1.2 con headers de API Key y el cuerpo documentado; valida la URL devuelta", async () => {
  const fetchImpl = fakeFetch(() => response(200, { token: TOKEN, url: "https://webpay3gint.transbank.cl/webpayserver/initTransaction" }));
  const client = createWebpayClient(webpayConfig, { fetchImpl });
  assert.equal(client.environmentCode, "TEST");
  const result = await client.createTransaction({
    buyOrder: "DM3F-K9X2M4QZ",
    sessionId: "00000000-0000-4000-8000-000000000001",
    amountClp: 25000,
    returnUrl: webpayConfig.returnUrl,
  });
  assert.equal(result.token, TOKEN);
  assert.equal(result.url, "https://webpay3gint.transbank.cl/webpayserver/initTransaction");
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Tbk-Api-Key-Id"], "597055555532");
  assert.equal(init.headers["Tbk-Api-Key-Secret"].length, 64);
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), {
    buy_order: "DM3F-K9X2M4QZ",
    session_id: "00000000-0000-4000-8000-000000000001",
    amount: 25000,
    return_url: "http://localhost:4301/public/payments/webpay/return",
  });
});

test("Webpay create: respuesta con URL ajena o sin token → error; datos fuera de los largos → error antes de enviar", async () => {
  const foreign = createWebpayClient(webpayConfig, { fetchImpl: fakeFetch(() => response(200, { token: TOKEN, url: "https://evil.example.com/pay" })) });
  await assert.rejects(foreign.createTransaction({ buyOrder: "DM1-AAAAAAAA", sessionId: "s", amountClp: 1, returnUrl: webpayConfig.returnUrl }), (e) => e.kind === "INVALID_RESPONSE");
  const noToken = createWebpayClient(webpayConfig, { fetchImpl: fakeFetch(() => response(200, { url: "https://webpay3gint.transbank.cl/x" })) });
  await assert.rejects(noToken.createTransaction({ buyOrder: "DM1-AAAAAAAA", sessionId: "s", amountClp: 1, returnUrl: webpayConfig.returnUrl }), (e) => e.kind === "INVALID_RESPONSE");
  const fetchImpl = fakeFetch(() => response(200, {}));
  const client = createWebpayClient(webpayConfig, { fetchImpl });
  await assert.rejects(client.createTransaction({ buyOrder: "X".repeat(27), sessionId: "s", amountClp: 1, returnUrl: webpayConfig.returnUrl }));
  await assert.rejects(client.createTransaction({ buyOrder: "DM1-AAAAAAAA", sessionId: "s".repeat(62), amountClp: 1, returnUrl: webpayConfig.returnUrl }));
  await assert.rejects(client.createTransaction({ buyOrder: "DM1-AAAAAAAA", sessionId: "s", amountClp: 1.5, returnUrl: webpayConfig.returnUrl }));
  assert.equal(fetchImpl.calls.length, 0);
});

test("Webpay commit (PUT sin cuerpo), status (GET) y refund (POST /refunds con monto)", async () => {
  const fetchImpl = fakeFetch(() => response(200, { status: "AUTHORIZED", response_code: 0 }));
  const client = createWebpayClient(webpayConfig, { fetchImpl });
  await client.commit(TOKEN);
  await client.status(TOKEN);
  await client.refund(TOKEN, 5000);
  const [commit, status, refund] = fetchImpl.calls;
  assert.equal(commit.init.method, "PUT");
  assert.equal(commit.url, `https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions/${TOKEN}`);
  assert.equal(commit.init.body, undefined);
  assert.equal(status.init.method, "GET");
  assert.equal(status.url, commit.url);
  assert.equal(refund.init.method, "POST");
  assert.equal(refund.url, `${commit.url}/refunds`);
  assert.deepEqual(JSON.parse(refund.init.body), { amount: 5000 });
  await assert.rejects(client.commit("token con espacios"));
  await assert.rejects(client.refund(TOKEN, 0));
});

test("Mercado Pago: preferencia con Bearer; init_point oficial; un init_point ajeno o http se rechaza", async () => {
  const fetchImpl = fakeFetch(() => response(201, { id: "123-abc", init_point: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc", sandbox_init_point: "https://sandbox.mercadopago.cl/x" }));
  const client = createMercadoPagoClient(mpConfig, { fetchImpl });
  assert.equal(client.environmentCode, "TEST");
  const result = await client.createPreference({ items: [] });
  assert.deepEqual({ preferenceId: result.preferenceId, initPoint: result.initPoint }, {
    preferenceId: "123-abc",
    initPoint: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc",
  });
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "https://api.mercadopago.com/checkout/preferences");
  assert.equal(init.method, "POST");
  assert.match(init.headers.Authorization, /^Bearer APP_USR-/);
  for (const initPoint of ["https://evil.example.com/pay", "http://www.mercadopago.cl/x"]) {
    const bad = createMercadoPagoClient(mpConfig, { fetchImpl: fakeFetch(() => response(201, { id: "1", init_point: initPoint })) });
    await assert.rejects(bad.createPreference({}), (e) => e.kind === "INVALID_RESPONSE");
  }
});

test("Mercado Pago: consulta de pago, búsqueda por external_reference y reembolso con X-Idempotency-Key", async () => {
  const fetchImpl = fakeFetch((url) => (url.includes("/search") ? response(200, { results: [{ id: 1 }], paging: { total: 1 } }) : response(200, { id: 1 })));
  const client = createMercadoPagoClient(mpConfig, { fetchImpl });
  await client.getPayment("1234567890");
  const results = await client.searchByExternalReference("DM3F-K9X2M4QZ");
  await client.refund("1234567890", 5000, "00000000-0000-4000-8000-0000000000aa");
  const [get, search, refund] = fetchImpl.calls;
  assert.equal(get.url, "https://api.mercadopago.com/v1/payments/1234567890");
  assert.equal(get.init.method, "GET");
  const searchUrl = new URL(search.url);
  assert.equal(searchUrl.pathname, "/v1/payments/search");
  assert.equal(searchUrl.searchParams.get("external_reference"), "DM3F-K9X2M4QZ");
  assert.equal(searchUrl.searchParams.get("sort"), "date_created");
  assert.equal(searchUrl.searchParams.get("criteria"), "desc");
  assert.deepEqual(results, [{ id: 1 }]);
  assert.equal(refund.url, "https://api.mercadopago.com/v1/payments/1234567890/refunds");
  assert.equal(refund.init.method, "POST");
  assert.equal(refund.init.headers["X-Idempotency-Key"], "00000000-0000-4000-8000-0000000000aa");
  assert.deepEqual(JSON.parse(refund.init.body), { amount: 5000 });
  await assert.rejects(client.getPayment("abc"));
  await assert.rejects(client.refund("1", 5000, "no-uuid"));
  await assert.rejects(client.searchByExternalReference("con espacio"));
});

test("Mercado Pago: el simulador local de desarrollo se usa solo si está configurado", async () => {
  const devConfig = parsePaymentsConfig({
    NODE_ENV: "development",
    PUBLIC_SITE_URL: "http://localhost:4303",
    API_PUBLIC_URL: "https://tunel-api.example.com",
    MERCADOPAGO_ENABLED: "true",
    MERCADOPAGO_ACCESS_TOKEN: "APP_USR-1234567890123456-102100-abcdefabcdefabcdef-123456789",
    MERCADOPAGO_WEBHOOK_SECRET: "s".repeat(64),
    PAYMENTS_DEV_MP_API_BASE: "http://127.0.0.1:4999",
  }).providers.MERCADOPAGO;
  const fetchImpl = fakeFetch(() => response(201, { id: "p1", init_point: "http://127.0.0.1:4999/checkout?pref_id=p1" }));
  const client = createMercadoPagoClient(devConfig, { fetchImpl });
  const result = await client.createPreference({});
  assert.equal(fetchImpl.calls[0].url, "http://127.0.0.1:4999/checkout/preferences");
  assert.equal(result.initPoint, "http://127.0.0.1:4999/checkout?pref_id=p1");
});
