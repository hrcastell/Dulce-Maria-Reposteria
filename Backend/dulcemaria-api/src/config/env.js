/**
 * Environment Variables Validation
 *
 * Valida que todas las variables de entorno requeridas estén configuradas
 * y cumplan con requisitos mínimos de seguridad. Cualquier error impide
 * arrancar; las advertencias se muestran y el arranque continúa.
 */

const { describeSecurityMode } = require("./runtime");
const { assessJwtSecret } = require("./secrets");
const { resolveOriginPolicy } = require("../lib/originPolicy");
const { parsePaymentsConfig } = require("../lib/payments/config");

/**
 * Variables de pagos en línea (todas opcionales; ver src/lib/payments/config.js
 * y payments-design §11). La configuración de pagos NUNCA impide arrancar: un
 * proveedor mal configurado queda deshabilitado con una advertencia.
 */
const PAYMENT_ENV_VARS = Object.freeze([
  "WEBPAY_ENABLED",
  "TRANSBANK_ENV",
  "TRANSBANK_COMMERCE_CODE",
  "TRANSBANK_API_KEY_SECRET",
  "TRANSBANK_RETURN_URL",
  "MERCADOPAGO_ENABLED",
  "MERCADOPAGO_ENV",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "MERCADOPAGO_MAX_INSTALLMENTS",
  "MERCADOPAGO_STATEMENT_DESCRIPTOR",
  "PUBLIC_SITE_URL",
  "PUBLIC_PAYMENT_PAGE_PATH",
  "API_PUBLIC_URL",
  "PAYMENT_ORDER_TTL_MINUTES",
  "PAYMENT_ORDER_MAX_MINUTES",
  "PAYMENT_MAX_ATTEMPTS_PER_ORDER",
  "PAYMENTS_CRON_TOKEN",
  "PAYMENTS_DEV_MP_API_BASE",
]);

/** Advertencias de la configuración de pagos (sin valores secretos). */
function paymentWarnings(env) {
  const payments = parsePaymentsConfig(env);
  const out = [...payments.problems, ...payments.warnings].map((text) => `Pagos: ${text}`);
  for (const provider of Object.values(payments.providers)) {
    if (provider.requested && !provider.enabled && provider.problems.length) {
      out.push(`Pagos: ${provider.id} queda DESHABILITADO — ${provider.problems.join(" ")}`);
    }
  }
  return out;
}

const BOOLEAN_FLAGS = ["MIGRATIONS_STRICT", "MIGRATIONS_FORCE", "TRUST_PROXY_DIAGNOSTIC", "AUTO_BOOTSTRAP_SUPERADMIN"];

/** Número de proxies de confianza delante de Node (ver SECURITY_TRANSBANK.md). */
function getTrustProxyHops(env = process.env) {
  const raw = String(env.TRUST_PROXY_HOPS ?? "").trim();
  return raw === "" ? 1 : Number(raw);
}

function validateEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  // Variables requeridas
  for (const key of ["DATABASE_URL", "JWT_SECRET"]) {
    if (!env[key] || String(env[key]).trim() === "") {
      errors.push(`Falta la variable de entorno obligatoria ${key}.`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Validación del entorno fallida:\n${errors.join("\n")}`);
  }

  const mode = describeSecurityMode(env);
  if (mode.implicit) {
    warnings.push(
      mode.nodeEnv
        ? `NODE_ENV="${env.NODE_ENV}" no es reconocido: se aplica el modo producción (seguro por defecto).`
        : "NODE_ENV no está definido: se aplica el modo producción (seguro por defecto). En local usa NODE_ENV=development."
    );
  }

  // JWT_SECRET fuerte (fatal en producción; advertencia en desarrollo)
  const secret = assessJwtSecret(env.JWT_SECRET, { production: mode.production });
  for (const problem of secret.problems) {
    (secret.fatal ? errors : warnings).push(problem.message);
  }

  // Validar DATABASE_URL formato
  if (!String(env.DATABASE_URL).startsWith("postgres")) {
    errors.push("DATABASE_URL debe comenzar con postgresql:// o postgres://");
  }

  // Orígenes del panel y del sitio público (CORS / CSRF)
  const origins = resolveOriginPolicy(env);
  errors.push(...origins.errors);
  warnings.push(...origins.warnings);

  if (mode.production && env.ENABLE_BOOTSTRAP === "true") {
    errors.push("ENABLE_BOOTSTRAP no puede quedar activo en producción (usa npm run admin:create-superadmin).");
  }

  if (env.TRUST_PROXY_HOPS && !/^\d+$/.test(String(env.TRUST_PROXY_HOPS).trim())) {
    errors.push("TRUST_PROXY_HOPS debe ser un entero no negativo.");
  }

  for (const flag of BOOLEAN_FLAGS) {
    const value = env[flag];
    if (value !== undefined && value !== "" && !["true", "false"].includes(String(value).trim().toLowerCase())) {
      warnings.push(`${flag}="${value}" no es true/false; se ignora.`);
    }
  }
  if (String(env.MIGRATIONS_FORCE).trim().toLowerCase() === "true") {
    warnings.push("MIGRATIONS_FORCE=true: el esquema se re-aplica en cada arranque. Quítalo después de usarlo.");
  }

  // Pagos en línea: solo advertencias (un proveedor mal configurado se deshabilita).
  warnings.push(...paymentWarnings(env));

  // Si hay errores críticos, fallar
  if (errors.length > 0) {
    throw new Error(`Validación del entorno fallida:\n${errors.join("\n")}`);
  }

  // Mostrar advertencias
  if (warnings.length > 0) {
    console.warn("⚠️  Advertencias de configuración:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
  }

  console.log(
    `✅ Entorno validado. Modo de seguridad: ${mode.production ? "PRODUCCIÓN" : "desarrollo"}` +
      `${mode.implicit ? " (implícito)" : ""}; trust proxy: ${getTrustProxyHops(env)} salto(s).`
  );
  console.log(`   Orígenes del panel (con sesión): ${[...origins.admin].join(", ") || "(ninguno)"}`);
  console.log(`   Orígenes del sitio público (sin credenciales): ${[...origins.public].join(", ") || "(ninguno)"}`);
}

module.exports = {
  validateEnv,
  getTrustProxyHops,
  paymentWarnings,
  PAYMENT_ENV_VARS,
};
