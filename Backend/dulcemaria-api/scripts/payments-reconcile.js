#!/usr/bin/env node
/**
 * Conciliador de pagos en línea para el cron de cPanel:
 *   npm run payments:reconcile
 *
 * 1. Concilia los intentos abiertos que vencieron su próxima revisión
 *    (Webpay: status / commit de prueba; Mercado Pago: búsqueda por referencia).
 * 2. Vence las órdenes y tortas en línea impagas cuyo plazo pasó, liberando el
 *    stock reservado (origen SYSTEM).
 *
 * Exclusión entre ejecuciones superpuestas y entre procesos: advisory lock de
 * sesión (pg_try_advisory_lock); si otra ejecución lo tiene, termina sin hacer
 * nada. Imprime un resumen JSON y sale con 0 (ok) o 1 (error).
 *
 * Necesita las mismas variables de entorno que la app (DATABASE_URL y las de
 * pagos). Si el cron de cPanel no las ve, usar el disparador HTTP
 * POST /internal/payments/reconcile con PAYMENTS_CRON_TOKEN (ver w2-changes / INSTALL_CPANEL).
 */

require("dotenv").config();

const { getPool } = require("../src/db");
const { initPayments } = require("../src/lib/payments/runtime");
const { runReconcileBatchExclusive } = require("../src/lib/payments/reconciler");

function parseLimit(argv) {
  const arg = argv.find((a) => a.startsWith("--limit="));
  const n = arg ? Number(arg.slice("--limit=".length)) : 25;
  return Number.isInteger(n) && n > 0 && n <= 200 ? n : 25;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "Falta DATABASE_URL en el entorno del cron." }));
    process.exitCode = 1;
    return;
  }
  const pool = getPool();
  // Silencioso salvo errores: el log del cron debe ser una línea por ejecución.
  const quiet = { log: () => {}, warn: () => {}, error: (...args) => console.error(...args) };
  try {
    await initPayments(pool, quiet);
    const summary = await runReconcileBatchExclusive({ limit: parseLimit(process.argv.slice(2)) });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, at: new Date().toISOString(), error: error?.code || error?.errorCode || error?.message || "error" }));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
