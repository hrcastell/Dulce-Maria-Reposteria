const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyWebpayReturn } = require("../../src/lib/payments/webpay/returnClassifier");

const TOKEN = "01ab7ef7671c42020d22a02561a94f4d68811e84e9079c6a6443efdb9535f9e6";
const BUY_ORDER = "DM3F-K9X2M4QZ";
const SESSION = "00000000-0000-4000-8000-000000000001";

test("NORMAL: solo token_ws, por GET (API ≥ 1.1) o por POST", () => {
  assert.deepEqual(classifyWebpayReturn({ method: "GET", query: { token_ws: TOKEN }, body: {} }), {
    variant: "NORMAL",
    token: TOKEN,
    buyOrder: null,
    sessionId: null,
  });
  assert.equal(classifyWebpayReturn({ method: "POST", query: {}, body: { token_ws: TOKEN } }).variant, "NORMAL");
});

test("ABORTED: TBK_TOKEN + TBK_ORDEN_COMPRA + TBK_ID_SESION (POST en integración, GET en producción)", () => {
  const params = { TBK_TOKEN: TOKEN, TBK_ORDEN_COMPRA: BUY_ORDER, TBK_ID_SESION: SESSION };
  assert.deepEqual(classifyWebpayReturn({ method: "POST", query: {}, body: params }), {
    variant: "ABORTED",
    token: TOKEN,
    buyOrder: BUY_ORDER,
    sessionId: SESSION,
  });
  assert.equal(classifyWebpayReturn({ method: "GET", query: params, body: {} }).variant, "ABORTED");
});

test("TIMEOUT: TBK_ORDEN_COMPRA + TBK_ID_SESION, sin token", () => {
  assert.deepEqual(
    classifyWebpayReturn({ method: "POST", query: {}, body: { TBK_ORDEN_COMPRA: BUY_ORDER, TBK_ID_SESION: SESSION } }),
    { variant: "TIMEOUT", token: null, buyOrder: BUY_ORDER, sessionId: SESSION }
  );
});

test("FORM_ERROR: token_ws y TBK_TOKEN juntos (con o sin TBK_*)", () => {
  const all = { token_ws: TOKEN, TBK_TOKEN: TOKEN, TBK_ORDEN_COMPRA: BUY_ORDER, TBK_ID_SESION: SESSION };
  assert.deepEqual(classifyWebpayReturn({ method: "GET", query: all, body: {} }), {
    variant: "FORM_ERROR",
    token: TOKEN,
    buyOrder: BUY_ORDER,
    sessionId: SESSION,
  });
  assert.equal(classifyWebpayReturn({ method: "GET", query: { token_ws: TOKEN, TBK_TOKEN: TOKEN }, body: {} }).variant, "FORM_ERROR");
});

test("parámetros de GET y POST se combinan; un mismo valor repetido en ambos se acepta", () => {
  const r = classifyWebpayReturn({ method: "POST", query: { TBK_ORDEN_COMPRA: BUY_ORDER }, body: { TBK_ORDEN_COMPRA: BUY_ORDER, TBK_ID_SESION: SESSION } });
  assert.equal(r.variant, "TIMEOUT");
});

test("INVALID: combinaciones no documentadas", () => {
  const cases = [
    {},
    { TBK_TOKEN: TOKEN },
    { TBK_TOKEN: TOKEN, TBK_ORDEN_COMPRA: BUY_ORDER },
    { TBK_ORDEN_COMPRA: BUY_ORDER },
    { TBK_ID_SESION: SESSION },
    { token_ws: TOKEN, TBK_ORDEN_COMPRA: BUY_ORDER, TBK_ID_SESION: SESSION },
  ];
  for (const query of cases) {
    const r = classifyWebpayReturn({ method: "GET", query, body: {} });
    assert.equal(r.variant, "INVALID", JSON.stringify(query));
    assert.equal(r.token, null);
  }
});

test("INVALID: valores que no son texto, demasiado largos o con caracteres no permitidos", () => {
  const cases = [
    { token_ws: [TOKEN, TOKEN] },
    { token_ws: { a: "b" } },
    { token_ws: "a".repeat(129) },
    { token_ws: "abc<script>" },
    { token_ws: "abc def" },
    { TBK_ORDEN_COMPRA: "DM3F K9X2", TBK_ID_SESION: SESSION },
    { TBK_ORDEN_COMPRA: "x".repeat(27), TBK_ID_SESION: SESSION },
    { TBK_ORDEN_COMPRA: BUY_ORDER, TBK_ID_SESION: "s".repeat(62) },
  ];
  for (const query of cases) {
    assert.equal(classifyWebpayReturn({ method: "GET", query, body: {} }).variant, "INVALID", JSON.stringify(query).slice(0, 60));
  }
});

test("INVALID: el mismo parámetro con valores distintos en GET y POST, o tokens distintos en FORM_ERROR", () => {
  assert.equal(classifyWebpayReturn({ method: "POST", query: { token_ws: TOKEN }, body: { token_ws: TOKEN.replace("0", "f") } }).variant, "INVALID");
  assert.equal(classifyWebpayReturn({ method: "GET", query: { token_ws: TOKEN, TBK_TOKEN: TOKEN.replace("0", "f") }, body: {} }).variant, "INVALID");
});

test("INVALID: cuerpo ilegible; los valores vacíos cuentan como ausentes; se ignoran parámetros ajenos", () => {
  assert.equal(classifyWebpayReturn({ method: "POST", query: {}, body: {}, bodyError: true }).variant, "INVALID");
  assert.equal(classifyWebpayReturn({ method: "GET", query: { token_ws: TOKEN, TBK_TOKEN: "" }, body: {} }).variant, "NORMAL");
  assert.equal(classifyWebpayReturn({ method: "GET", query: { token_ws: TOKEN, utm_source: "x" }, body: {} }).variant, "NORMAL");
  assert.equal(classifyWebpayReturn({ method: "GET", query: undefined, body: undefined }).variant, "INVALID");
});
