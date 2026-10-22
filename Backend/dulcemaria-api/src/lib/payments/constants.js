/**
 * Vocabularios compartidos de pagos: una sola fuente para el código y para
 * los CHECK del esquema (complete.js).
 */

const PAYMENT_PROVIDERS = Object.freeze(["WEBPAY", "MERCADOPAGO"]);

// Origen de cada evento de pago (payment_events.source).
const PAYMENT_EVENT_SOURCES = Object.freeze(["API_CALL", "RETURN", "BACK_URL", "WEBHOOK", "RECONCILER", "STATUS_POLL", "ADMIN", "SYSTEM"]);

// Entorno de configuración → código guardado en payments.environment.
const ENVIRONMENT_CODES = Object.freeze({ integration: "TEST", production: "LIVE" });

const PROVIDER_LABELS = Object.freeze({
  WEBPAY: "Webpay: crédito, débito o prepago",
  MERCADOPAGO: "Mercado Pago",
});

const MANUAL_METHOD_LABEL = "Transferencia o efectivo (coordinar por WhatsApp)";

module.exports = { PAYMENT_PROVIDERS, PAYMENT_EVENT_SOURCES, ENVIRONMENT_CODES, PROVIDER_LABELS, MANUAL_METHOD_LABEL };
