const test = require("node:test");
const assert = require("node:assert/strict");

const w = require("../../src/lib/payments/window");

const NOW = new Date("2026-10-21T21:00:00.000Z");
const MIN = 60 * 1000;
const at = (minutes) => new Date(NOW.getTime() + minutes * MIN);
const WINDOW = { ttlMinutes: 30, maxMinutes: 60, maxAttempts: 5 };

test("plazo inicial de una orden en línea = creación + TTL", () => {
  assert.deepEqual(w.initialPaymentDeadline(NOW, WINDOW), at(30));
});

test("tope de la orden = creación + max(TTL, máximo); sin plazo (orden del panel) = sin tope", () => {
  assert.deepEqual(w.paymentCap({ created_at: NOW, payment_expires_at: at(30) }, WINDOW), at(60));
  assert.deepEqual(w.paymentCap({ created_at: NOW, payment_expires_at: at(30) }, { ...WINDOW, maxMinutes: 20 }), at(30));
  assert.equal(w.paymentCap({ created_at: NOW, payment_expires_at: null }, WINDOW), null);
});

test("vencimiento de un intento Webpay: token 5 + formulario (4 producción / 10 integración) + 2 de margen", () => {
  assert.deepEqual(w.attemptExpiresAt({ provider: "WEBPAY", environment: "production", now: NOW, cap: at(60) }), at(11));
  assert.deepEqual(w.attemptExpiresAt({ provider: "WEBPAY", environment: "integration", now: NOW, cap: at(60) }), at(17));
  // Transbank fija su ventana: el tope de la orden no la acorta.
  assert.deepEqual(w.attemptExpiresAt({ provider: "WEBPAY", environment: "production", now: NOW, cap: at(5) }), at(11));
});

test("vencimiento de un intento Mercado Pago: min(ahora + 30, tope); sin tope = ahora + 30", () => {
  assert.deepEqual(w.attemptExpiresAt({ provider: "MERCADOPAGO", environment: "production", now: NOW, cap: at(60) }), at(30));
  assert.deepEqual(w.attemptExpiresAt({ provider: "MERCADOPAGO", environment: "production", now: NOW, cap: at(12) }), at(12));
  assert.deepEqual(w.attemptExpiresAt({ provider: "MERCADOPAGO", environment: "production", now: NOW, cap: null }), at(30));
});

test("¿se puede iniciar un intento? antes del plazo sí; después o con < 3 min para MP, no", () => {
  assert.deepEqual(w.checkCanStart({ deadline: at(10), cap: at(40), provider: "WEBPAY", now: NOW }), { ok: true });
  assert.equal(w.checkCanStart({ deadline: at(-1), cap: at(40), provider: "WEBPAY", now: NOW }).code, "PAYMENT_WINDOW_EXPIRED");
  assert.equal(w.checkCanStart({ deadline: at(0), cap: at(40), provider: "WEBPAY", now: NOW }).code, "PAYMENT_WINDOW_EXPIRED");
  assert.equal(w.checkCanStart({ deadline: at(10), cap: at(2), provider: "MERCADOPAGO", now: NOW }).code, "PAYMENT_WINDOW_EXPIRED");
  assert.deepEqual(w.checkCanStart({ deadline: null, cap: null, provider: "MERCADOPAGO", now: NOW }), { ok: true });
});

test("cada intento extiende el plazo de la orden (vencimiento del intento + 2 min) sin pasar el tope", () => {
  assert.deepEqual(w.extendDeadline({ deadline: at(30), attemptExpiresAt: at(17), cap: at(60) }), at(30));
  assert.deepEqual(w.extendDeadline({ deadline: at(20), attemptExpiresAt: at(25), cap: at(60) }), at(27));
  assert.deepEqual(w.extendDeadline({ deadline: at(50), attemptExpiresAt: at(70), cap: at(60) }), at(60));
  assert.equal(w.extendDeadline({ deadline: null, attemptExpiresAt: at(30), cap: null }), null);
});

test("primera conciliación: Webpay al vencer el intento (nunca antes: el cliente puede estar en el formulario); MP a los 2 min", () => {
  assert.deepEqual(w.initialReconcileAt({ provider: "WEBPAY", expiresAt: at(17), now: NOW }), at(17));
  assert.deepEqual(w.initialReconcileAt({ provider: "MERCADOPAGO", expiresAt: at(30), now: NOW }), at(2));
});

test("backoff entre consultas al proveedor (siempre ≥ 30 s)", () => {
  // COMMITTING: 20 s, 40 s, 80 s... hasta 10 min (mínimo 30 s).
  assert.deepEqual(w.nextReconcileAt({ provider: "WEBPAY", status: "COMMITTING", reconcileAttempts: 0, expiresAt: at(-5), now: NOW }), new Date(NOW.getTime() + 30000));
  assert.deepEqual(w.nextReconcileAt({ provider: "WEBPAY", status: "COMMITTING", reconcileAttempts: 2, expiresAt: at(-5), now: NOW }), new Date(NOW.getTime() + 80000));
  assert.deepEqual(w.nextReconcileAt({ provider: "WEBPAY", status: "COMMITTING", reconcileAttempts: 20, expiresAt: at(-5), now: NOW }), at(10));
  // Webpay PENDING antes de su vencimiento: esperar al vencimiento.
  assert.deepEqual(w.nextReconcileAt({ provider: "WEBPAY", status: "PENDING", reconcileAttempts: 0, expiresAt: at(9), now: NOW }), at(9));
  // MP PENDING: 1, 2, 4... hasta 60 min.
  assert.deepEqual(w.nextReconcileAt({ provider: "MERCADOPAGO", status: "PENDING", reconcileAttempts: 0, expiresAt: at(20), now: NOW }), at(1));
  assert.deepEqual(w.nextReconcileAt({ provider: "MERCADOPAGO", status: "PENDING", reconcileAttempts: 3, expiresAt: at(20), now: NOW }), at(8));
  assert.deepEqual(w.nextReconcileAt({ provider: "MERCADOPAGO", status: "PENDING", reconcileAttempts: 30, expiresAt: at(20), now: NOW }), at(60));
  assert.deepEqual(w.nextReconcileAt({ provider: "MERCADOPAGO", status: "CREATED", reconcileAttempts: 0, expiresAt: at(20), now: NOW }), at(2));
});

test("umbrales: CREATED viejo a los 2 min, commit sin confirmar a los 10, ventana de status de Webpay al día 6", () => {
  assert.equal(w.isStaleCreated({ created_at: at(-3) }, NOW), true);
  assert.equal(w.isStaleCreated({ created_at: at(-1) }, NOW), false);
  assert.equal(w.isCommitUnconfirmed({ commit_started_at: at(-11) }, NOW), true);
  assert.equal(w.isCommitUnconfirmed({ commit_started_at: at(-9) }, NOW), false);
  assert.equal(w.isCommitUnconfirmed({ commit_started_at: null }, NOW), false);
  assert.equal(w.webpayStatusWindow({ created_at: at(-6 * 24 * 60 - 1) }, NOW), "CLOSING");
  assert.equal(w.webpayStatusWindow({ created_at: at(-7 * 24 * 60 - 1) }, NOW), "CLOSED");
  assert.equal(w.webpayStatusWindow({ created_at: at(-60) }, NOW), "OPEN");
});
