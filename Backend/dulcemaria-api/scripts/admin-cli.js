#!/usr/bin/env node
/**
 * CLI de administración para producción (terminal SSH de cPanel).
 * Reemplaza al bootstrap HTTP y al script legado seed:superadmin.
 *
 * Uso (desde la carpeta de la app, con el mismo entorno que la API):
 *   npm run admin:create-superadmin -- --email dueno@ejemplo.cl [--name "Nombre"]
 *   npm run admin:reset-password    -- --email usuario@ejemplo.cl
 *   npm run admin:revoke-sessions   -- --email usuario@ejemplo.cl
 *
 * La contraseña NUNCA se pasa como argumento (quedaría en el historial del
 * shell y en la lista de procesos): se pide de forma oculta en la terminal o
 * se lee desde stdin, p. ej.  `npm run admin:reset-password -- --email x@y.cl < archivo`
 *
 * reset-password y revoke-sessions incrementan users.session_version, lo que
 * cierra de inmediato todas las sesiones abiertas de ese usuario.
 */

const crypto = require("crypto");

const COMMANDS = new Set(["create-superadmin", "reset-password", "revoke-sessions"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 200;

const USAGE = `Uso:
  node scripts/admin-cli.js create-superadmin --email <correo> [--name "<nombre>"]
  node scripts/admin-cli.js reset-password    --email <correo>
  node scripts/admin-cli.js revoke-sessions   --email <correo>

La contraseña se pide de forma oculta (terminal) o se lee desde stdin.
Nunca la pases como argumento.`;

/** Argumentos → { command, email, name, help, errors }. */
function parseCliArgs(argv) {
  const result = { command: null, email: null, name: null, help: false, errors: [] };
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args.length === 0) {
    result.help = true;
    return result;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--password" || arg === "-p" || arg.startsWith("--password=")) {
      result.errors.push("La contraseña nunca se pasa como argumento: se pide de forma oculta o se lee desde stdin.");
      if (arg === "--password" || arg === "-p") i++;
      continue;
    }
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (flag === "--email" || flag === "--name") {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined || String(value).startsWith("--")) {
        result.errors.push(`Falta el valor de ${flag}.`);
        continue;
      }
      if (flag === "--email") result.email = String(value).trim().toLowerCase();
      else result.name = String(value).trim();
      continue;
    }
    if (arg.startsWith("-")) {
      result.errors.push(`Opción desconocida: ${arg}`);
      continue;
    }
    if (!result.command) {
      if (COMMANDS.has(arg)) result.command = arg;
      else result.errors.push(`Comando desconocido: ${arg}`);
      continue;
    }
    result.errors.push(`Argumento inesperado: ${arg}`);
  }

  if (result.command && !result.email) result.errors.push("Falta --email <correo>.");
  if (result.email && !EMAIL_PATTERN.test(result.email)) result.errors.push(`Email inválido: ${result.email}`);
  if (!result.command && !result.errors.length) result.help = true;
  return result;
}

/** Misma regla que la API (12 a 200 caracteres) y sin caracteres de control. */
function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return { ok: false, error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };
  }
  if (password.length > PASSWORD_MAX) {
    return { ok: false, error: `La contraseña no puede superar ${PASSWORD_MAX} caracteres.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(password)) {
    return { ok: false, error: "La contraseña no puede contener saltos de línea ni caracteres de control." };
  }
  if (!password.trim()) return { ok: false, error: "La contraseña no puede ser solo espacios." };
  return { ok: true };
}

/** stdin suele terminar con un salto de línea que no forma parte de la contraseña. */
function stripSingleTrailingNewline(value) {
  if (value.endsWith("\r\n")) return value.slice(0, -2);
  if (value.endsWith("\n")) return value.slice(0, -1);
  return value;
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const finish = (error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") return finish(new Error("Operación cancelada."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
      return undefined;
    };
    stdin.on("data", onData);
  });
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function readNewPassword() {
  let password;
  if (process.stdin.isTTY) {
    password = await promptHidden("Nueva contraseña: ");
    const confirmation = await promptHidden("Repite la contraseña: ");
    if (password !== confirmation) throw new Error("Las contraseñas no coinciden.");
  } else {
    password = stripSingleTrailingNewline(await readAllStdin());
  }
  const check = validateNewPassword(password);
  if (!check.ok) throw new Error(check.error);
  return password;
}

async function ensureSchemaReady(pool) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'session_version'`
  );
  if (r.rowCount === 0) {
    throw new Error("La tabla users aún no tiene el esquema actual. Arranca la API una vez para que aplique las migraciones.");
  }
}

async function createSuperadmin(pool, { email, name }) {
  const exists = await pool.query("SELECT 1 FROM users WHERE email = $1 LIMIT 1", [email]);
  if (exists.rowCount > 0) throw new Error(`Ya existe un usuario con ese email. Usa reset-password si necesitas cambiar su contraseña.`);

  const { hashPassword } = require("../src/utils/password");
  const password = await readNewPassword();
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, is_active, permissions, session_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'SUPERADMIN', true, '{}'::jsonb, 0, NOW(), NOW())`,
    [crypto.randomUUID(), email, passwordHash, name || "Dulce María - Superadmin"]
  );
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'SUPERADMIN'");
  console.log(`✅ SUPERADMIN creado: ${email} (SUPERADMIN totales: ${count.rows[0].n}).`);
}

async function resetPassword(pool, { email }) {
  const exists = await pool.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  if (exists.rowCount === 0) throw new Error("No existe un usuario con ese email.");

  const { hashPassword } = require("../src/utils/password");
  const password = await readNewPassword();
  const passwordHash = await hashPassword(password);
  await pool.query(
    `UPDATE users
     SET password_hash = $1, session_version = session_version + 1, updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, exists.rows[0].id]
  );
  console.log(`✅ Contraseña actualizada para ${email}. Todas sus sesiones abiertas quedaron cerradas.`);
}

async function revokeSessions(pool, { email }) {
  const r = await pool.query(
    `UPDATE users SET session_version = session_version + 1, updated_at = NOW() WHERE email = $1 RETURNING id`,
    [email]
  );
  if (r.rowCount === 0) throw new Error("No existe un usuario con ese email.");
  console.log(`✅ Sesiones de ${email} revocadas.`);
}

async function main(argv) {
  const args = parseCliArgs(argv);
  if (args.errors.length) {
    for (const error of args.errors) console.error(`✖ ${error}`);
    console.error(`\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  require("dotenv").config();
  if (!process.env.DATABASE_URL) {
    console.error("✖ Falta DATABASE_URL en el entorno.");
    return 1;
  }

  const { getPool } = require("../src/db");
  const pool = getPool();
  try {
    await ensureSchemaReady(pool);
    if (args.command === "create-superadmin") await createSuperadmin(pool, args);
    else if (args.command === "reset-password") await resetPassword(pool, args);
    else await revokeSessions(pool, args);
    return 0;
  } catch (e) {
    console.error(`✖ ${e?.message || e}`);
    return 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { parseCliArgs, validateNewPassword, stripSingleTrailingNewline, main };
