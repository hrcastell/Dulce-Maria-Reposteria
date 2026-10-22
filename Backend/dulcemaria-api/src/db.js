const { Pool, types } = require("pg");
const { installPgTypeParsers } = require("./lib/pgTypes");

// BIGINT → number (con resguardo de precisión) y DATE → texto AAAA-MM-DD,
// para toda la app (ver lib/pgTypes.js).
installPgTypeParsers(types);

let pool = null;

// Límites por conexión (PostgreSQL 10 los acepta como parámetros de inicio):
// - statement_timeout: ninguna consulta de la app puede quedar colgada más de
//   15 s (incluye esperas por bloqueos de filas, p. ej. FOR UPDATE).
// - idle_in_transaction_session_timeout: una transacción abandonada (request
//   que murió a mitad de camino) libera sus bloqueos a los 30 s.
// La migración de arranque amplía statement_timeout con SET LOCAL.
const STATEMENT_TIMEOUT_MS = 15000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30000;

function getPool() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada en Environment Variables.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      application_name: "dulcemaria-api",
    });
    // Sin este listener, la caída de una conexión inactiva (reinicio de
    // PostgreSQL, corte de red del hosting) emite 'error' sin manejar y
    // termina el proceso de Node. El pool descarta esa conexión solo.
    pool.on("error", (err) => {
      console.error(`[pg] Error en una conexión inactiva del pool [${err.code || "sin código"}]: ${err.message}`);
    });
  }
  return pool;
}

/**
 * Ejecuta `work(client)` en una transacción (BEGIN … COMMIT). Ante cualquier
 * error hace ROLLBACK y relanza; si el ROLLBACK falla, la conexión se descarta.
 */
async function withTransaction(work) {
  const client = await getPool().connect();
  let broken;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

module.exports = { getPool, withTransaction };
