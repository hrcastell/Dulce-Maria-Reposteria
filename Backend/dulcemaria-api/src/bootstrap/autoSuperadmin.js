/**
 * Auto-bootstrap del SUPERADMIN (comodidad de desarrollo).
 *
 * Crea el primer usuario SUPERADMIN automáticamente al iniciar la API, para
 * no depender del paso manual `POST /auth/bootstrap?token=...` cada vez que
 * se levanta el stack de Docker local con una base recién creada.
 *
 * Solo actúa cuando se cumplen TODAS estas condiciones:
 *   - NODE_ENV !== "production"                  (nunca corre en producción)
 *   - AUTO_BOOTSTRAP_SUPERADMIN !== "false"      (opt-out explícito por env)
 *   - La tabla `users` está vacía               (jamás toca una BD con datos)
 *   - ADMIN_EMAIL y ADMIN_PASSWORD definidos     (mismas vars que el endpoint)
 *
 * Replica lo que hace POST /auth/bootstrap, pero sin token ni request. En
 * producción el bootstrap sigue siendo únicamente ese endpoint, protegido
 * por BOOTSTRAP_TOKEN.
 *
 * Para re-aplicar credenciales sobre una BD que YA tiene usuarios, usar el
 * endpoint manual (hace upsert). Esta función, a propósito, solo cubre el
 * caso "base vacía".
 *
 * Nunca lanza: cualquier error se loguea y el arranque continúa. Un admin de
 * desarrollo que no se pudo crear no debe impedir que la API levante.
 */

const crypto = require("crypto");
const { getPool } = require("../db");
const { hashPassword } = require("../utils/password");

async function autoBootstrapSuperadmin() {
  if (process.env.NODE_ENV === "production") return;
  if (String(process.env.AUTO_BOOTSTRAP_SUPERADMIN).toLowerCase() === "false") return;

  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !password) {
    console.warn(
      "⚠️  Auto-bootstrap omitido: faltan ADMIN_EMAIL o ADMIN_PASSWORD en el entorno."
    );
    return;
  }

  try {
    const pool = getPool();

    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
    if (rows[0].n > 0) return; // ya hay usuarios: no hacemos nada

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    // ON CONFLICT como red de seguridad ante dos arranques simultáneos
    // (el chequeo de COUNT ya cubre el caso normal).
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'SUPERADMIN', true, NOW(), NOW())
       ON CONFLICT (email) DO NOTHING`,
      [id, email, passwordHash, "Dulce María - Superadmin"]
    );

    console.log(`✅ Auto-bootstrap: SUPERADMIN creado (${email})`);
  } catch (e) {
    console.warn(
      "⚠️  Auto-bootstrap falló (no bloquea el arranque):",
      e?.message || e
    );
  }
}

module.exports = { autoBootstrapSuperadmin };
