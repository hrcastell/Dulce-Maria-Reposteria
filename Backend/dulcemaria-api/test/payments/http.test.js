const test = require("node:test");
const assert = require("node:assert/strict");

const { requestJson, ProviderHttpError } = require("../../src/lib/payments/http");

const SECRET = "valor-secreto-que-nunca-debe-aparecer";
const ALLOWED = ["webpay3gint.transbank.cl", "api.mercadopago.com"];

function response(status, bodyText, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => bodyText,
  };
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

function base(fetchImpl, overrides = {}) {
  return {
    url: "https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions",
    method: "POST",
    headers: { "Tbk-Api-Key-Secret": SECRET, "Content-Type": "application/json" },
    body: { amount: 1000 },
    timeoutMs: 1000,
    fetchImpl,
    allowedHosts: ALLOWED,
    ...overrides,
  };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("se esperaba un error");
}

test("2xx con JSON → { status, json }; envía método, headers, cuerpo JSON y señal de timeout", async () => {
  const fetchImpl = fakeFetch(() => response(200, '{"token":"abc","url":"https://webpay3gint.transbank.cl/x"}'));
  const result = await requestJson(base(fetchImpl));
  assert.deepEqual(result, { status: 200, json: { token: "abc", url: "https://webpay3gint.transbank.cl/x" } });
  const { url, init } = fetchImpl.calls[0];
  assert.match(url, /^https:\/\/webpay3gint\.transbank\.cl\//);
  assert.equal(init.method, "POST");
  assert.equal(init.body, '{"amount":1000}');
  assert.equal(init.headers["Tbk-Api-Key-Secret"], SECRET);
  assert.ok(init.signal, "falta la señal de timeout");
  assert.equal(init.redirect, "error");
});

test("2xx sin cuerpo → json null; GET no envía cuerpo", async () => {
  const fetchImpl = fakeFetch(() => response(204, ""));
  assert.deepEqual(await requestJson(base(fetchImpl, { method: "GET", body: undefined })), { status: 204, json: null });
  assert.equal(fetchImpl.calls[0].init.body, undefined);
});

test("4xx (salvo 408/429) = definitivo, con el mensaje del proveedor recortado", async () => {
  const fetchImpl = fakeFetch(() => response(422, '{"error_message":"Invalid status \'0\' for transaction while authorizing."}'));
  const err = await rejection(requestJson(base(fetchImpl)));
  assert.ok(err instanceof ProviderHttpError);
  assert.equal(err.kind, "HTTP_4XX");
  assert.equal(err.status, 422);
  assert.equal(err.ambiguous, false);
  assert.equal(err.providerMessage, "Invalid status '0' for transaction while authorizing.");
  for (const status of [400, 401, 404]) {
    const e = await rejection(requestJson(base(fakeFetch(() => response(status, "no es json")))));
    assert.equal(e.kind, "HTTP_4XX");
    assert.equal(e.ambiguous, false);
    assert.equal(e.providerMessage, null);
  }
});

test("408, 429 y 5xx = ambiguos (nunca se asume un fracaso)", async () => {
  for (const status of [408, 429]) {
    const err = await rejection(requestJson(base(fakeFetch(() => response(status, "{}")))));
    assert.equal(err.ambiguous, true, String(status));
  }
  for (const status of [500, 502, 503]) {
    const err = await rejection(requestJson(base(fakeFetch(() => response(status, '{"message":"down"}')))));
    assert.equal(err.kind, "HTTP_5XX");
    assert.equal(err.ambiguous, true);
  }
});

test("JSON inválido en un 2xx → INVALID_RESPONSE (ambiguo); respuesta > 1 MB también", async () => {
  const err = await rejection(requestJson(base(fakeFetch(() => response(200, "<html>")))));
  assert.equal(err.kind, "INVALID_RESPONSE");
  assert.equal(err.ambiguous, true);
  const big = await rejection(requestJson(base(fakeFetch(() => response(200, `"${"a".repeat(1024 * 1024 + 10)}"`)))));
  assert.equal(big.kind, "INVALID_RESPONSE");
  const declared = await rejection(requestJson(base(fakeFetch(() => response(200, "{}", { "content-length": String(5 * 1024 * 1024) })))));
  assert.equal(declared.kind, "INVALID_RESPONSE");
});

test("error de red → NETWORK (ambiguo)", async () => {
  const err = await rejection(requestJson(base(fakeFetch(() => Promise.reject(new TypeError("fetch failed"))))));
  assert.equal(err.kind, "NETWORK");
  assert.equal(err.ambiguous, true);
});

test("timeout con AbortSignal → TIMEOUT (ambiguo)", async () => {
  const fetchImpl = fakeFetch(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      })
  );
  const err = await rejection(requestJson(base(fetchImpl, { timeoutMs: 20 })));
  assert.equal(err.kind, "TIMEOUT");
  assert.equal(err.ambiguous, true);
});

test("host fuera de la lista blanca o sin https → rechazado ANTES de enviar", async () => {
  const fetchImpl = fakeFetch(() => response(200, "{}"));
  const err = await rejection(requestJson(base(fetchImpl, { url: "https://evil.example.com/x" })));
  assert.equal(err.kind, "HOST_NOT_ALLOWED");
  assert.equal(err.ambiguous, false);
  const insecure = await rejection(requestJson(base(fetchImpl, { url: "http://webpay3gint.transbank.cl/x" })));
  assert.equal(insecure.kind, "HOST_NOT_ALLOWED");
  const tricky = await rejection(requestJson(base(fetchImpl, { url: "https://webpay3gint.transbank.cl.evil.com/x" })));
  assert.equal(tricky.kind, "HOST_NOT_ALLOWED");
  assert.equal(fetchImpl.calls.length, 0);
});

test("http permitido solo para hosts de desarrollo declarados explícitamente", async () => {
  const fetchImpl = fakeFetch(() => response(200, "{}"));
  const result = await requestJson(base(fetchImpl, { url: "http://127.0.0.1:4999/v1/payments/1", allowedHosts: ["127.0.0.1:4999"], insecureHosts: ["127.0.0.1:4999"] }));
  assert.equal(result.status, 200);
});

test("los errores nunca incluyen los headers de la solicitud (secretos)", async () => {
  const cases = [
    fakeFetch(() => response(401, '{"error_message":"Not Authorized"}')),
    fakeFetch(() => Promise.reject(new TypeError(`fetch failed ${SECRET}`))),
    fakeFetch(() => response(500, `{"message":"${SECRET}"}`)),
  ];
  for (const fetchImpl of cases) {
    const err = await rejection(requestJson(base(fetchImpl)));
    const text = `${String(err)} ${err.message} ${JSON.stringify(err)} ${err.stack}`;
    assert.equal(text.includes(SECRET), false);
  }
});
