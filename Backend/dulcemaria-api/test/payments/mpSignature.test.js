const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { verifyWebhookSignature, buildManifest, DEFAULT_MAX_AGE_SEC, DEFAULT_MAX_FUTURE_SKEW_SEC } = require("../../src/lib/payments/mercadopago/signature");

const SECRET = "clave-secreta-de-prueba";
const TS_SEC = "1704908010";
const NOW_MS = Number(TS_SEC) * 1000 + 5000;

function hmac(manifest, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(manifest).digest("hex");
}

function header(manifest, ts = TS_SEC, secret = SECRET) {
  return `ts=${ts},v1=${hmac(manifest, secret)}`;
}

test("manifiesto documentado: id:[data.id];request-id:[x-request-id];ts:[ts]; (se omite el par ausente)", () => {
  assert.equal(buildManifest({ dataId: "123", requestId: "req-1", ts: TS_SEC }), `id:123;request-id:req-1;ts:${TS_SEC};`);
  assert.equal(buildManifest({ dataId: undefined, requestId: "req-1", ts: TS_SEC }), `request-id:req-1;ts:${TS_SEC};`);
  assert.equal(buildManifest({ dataId: "123", requestId: undefined, ts: TS_SEC }), `id:123;ts:${TS_SEC};`);
  // data.id alfanumérico va en minúsculas.
  assert.equal(buildManifest({ dataId: "ABC123", requestId: "R", ts: TS_SEC }), `id:abc123;request-id:R;ts:${TS_SEC};`);
});

test("firma válida → ok (ts en segundos)", () => {
  const manifest = `id:123456;request-id:bb56a2f1-6aae-46ac-982e-9dcd3581d08e;ts:${TS_SEC};`;
  const result = verifyWebhookSignature({
    xSignature: header(manifest),
    xRequestId: "bb56a2f1-6aae-46ac-982e-9dcd3581d08e",
    dataId: "123456",
    secret: SECRET,
    nowMs: NOW_MS,
  });
  assert.deepEqual(result, { ok: true, ts: TS_SEC });
});

test("firma válida con ts en milisegundos y con espacios en el header", () => {
  const tsMs = String(NOW_MS - 1000);
  const manifest = `id:1;request-id:r;ts:${tsMs};`;
  const result = verifyWebhookSignature({ xSignature: ` ts=${tsMs} , v1=${hmac(manifest).toUpperCase()} `, xRequestId: "r", dataId: "1", secret: SECRET, nowMs: NOW_MS });
  assert.equal(result.ok, true);
});

test("data.id en mayúsculas se firma en minúsculas", () => {
  const manifest = `id:abc;request-id:r;ts:${TS_SEC};`;
  assert.equal(verifyWebhookSignature({ xSignature: header(manifest), xRequestId: "r", dataId: "ABC", secret: SECRET, nowMs: NOW_MS }).ok, true);
});

test("sin data.id ni x-request-id: el manifiesto los omite", () => {
  const manifest = `ts:${TS_SEC};`;
  assert.equal(verifyWebhookSignature({ xSignature: header(manifest), xRequestId: undefined, dataId: undefined, secret: SECRET, nowMs: NOW_MS }).ok, true);
});

test("rechazos sin lanzar: secreto incorrecto, datos alterados, header ausente o mal formado", () => {
  const manifest = `id:1;request-id:r;ts:${TS_SEC};`;
  const cases = [
    [{ xSignature: header(manifest, TS_SEC, "otra-clave"), xRequestId: "r", dataId: "1" }, "SIGNATURE_MISMATCH"],
    [{ xSignature: header(manifest), xRequestId: "r", dataId: "2" }, "SIGNATURE_MISMATCH"],
    [{ xSignature: header(manifest), xRequestId: "otro", dataId: "1" }, "SIGNATURE_MISMATCH"],
    [{ xSignature: undefined, xRequestId: "r", dataId: "1" }, "MISSING_SIGNATURE"],
    [{ xSignature: "", xRequestId: "r", dataId: "1" }, "MISSING_SIGNATURE"],
    [{ xSignature: `v1=${hmac(manifest)}`, xRequestId: "r", dataId: "1" }, "MALFORMED_TS"],
    [{ xSignature: `ts=abc,v1=${hmac(manifest)}`, xRequestId: "r", dataId: "1" }, "MALFORMED_TS"],
    [{ xSignature: `ts=${TS_SEC}`, xRequestId: "r", dataId: "1" }, "MALFORMED_V1"],
    [{ xSignature: `ts=${TS_SEC},v1=abcd`, xRequestId: "r", dataId: "1" }, "MALFORMED_V1"],
    [{ xSignature: `ts=${TS_SEC},v1=${"z".repeat(64)}`, xRequestId: "r", dataId: "1" }, "MALFORMED_V1"],
    [{ xSignature: [header(manifest), header(manifest)], xRequestId: "r", dataId: "1" }, "MALFORMED_HEADER"],
    [{ xSignature: `ts=${TS_SEC},ts=1704908011,v1=${hmac(manifest)}`, xRequestId: "r", dataId: "1" }, "MALFORMED_HEADER"],
    [{ xSignature: header(manifest), xRequestId: ["r", "r"], dataId: "1" }, "MALFORMED_HEADER"],
  ];
  for (const [input, reason] of cases) {
    const result = verifyWebhookSignature({ ...input, secret: SECRET, nowMs: NOW_MS });
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason, JSON.stringify(input).slice(0, 80));
  }
});

test("sin secreto configurado → MISSING_SECRET", () => {
  assert.deepEqual(verifyWebhookSignature({ xSignature: "ts=1,v1=2", secret: "", nowMs: NOW_MS }), { ok: false, reason: "MISSING_SECRET" });
});

function signedAt(offsetSec) {
  const ts = String(Math.floor(NOW_MS / 1000) + offsetSec);
  return verifyWebhookSignature({ xSignature: header(`id:1;request-id:r;ts:${ts};`, ts), xRequestId: "r", dataId: "1", secret: SECRET, nowMs: NOW_MS });
}

test("tolerancia de ts: acepta los reintentos documentados de MP (hasta ~14 días) y rechaza lo absurdo", () => {
  // Reintentos de MP: 0, 15 min, 30 min, 6 h, 48 h, 96 h ×3. La documentación no dice si `ts`
  // se regenera por reintento: una firma vieja pero válida se acepta (el cuerpo nunca se cree y
  // cada notificación se procesa una sola vez).
  assert.equal(DEFAULT_MAX_AGE_SEC, 15 * 24 * 60 * 60);
  assert.equal(DEFAULT_MAX_FUTURE_SKEW_SEC, 300);
  for (const offset of [-15 * 60, -6 * 3600, -48 * 3600, -14 * 24 * 3600, 299]) {
    assert.deepEqual(signedAt(offset).ok, true, String(offset));
  }
  for (const offset of [-(15 * 24 * 3600 + 1), 301, 3600]) {
    const result = signedAt(offset);
    assert.equal(result.ok, false, String(offset));
    assert.equal(result.reason, "TS_OUT_OF_TOLERANCE", String(offset));
  }
});
