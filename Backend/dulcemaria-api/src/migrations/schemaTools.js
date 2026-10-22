/**
 * Utilidades puras sobre las sentencias del esquema canónico (complete.js):
 *   - etiqueta legible de cada sentencia (para logs de fallos),
 *   - huella (fingerprint) para saltar el DDL cuando nada cambió,
 *   - clasificación de errores transitorios,
 *   - manifiesto esperado (tablas, columnas, índices, triggers, funciones y
 *     restricciones) derivado de las propias sentencias, para que
 *     `npm run db:validate` nunca quede desfasado respecto de complete.js.
 */

const crypto = require("crypto");

// Cambiar este valor fuerza una re-aplicación completa aunque las sentencias no cambien.
const MIGRATION_FORMAT_VERSION = "2";
const PG_MAX_IDENTIFIER = 63;

const CONSTRAINT_TYPES = { "PRIMARY KEY": "p", UNIQUE: "u", CHECK: "c", "FOREIGN KEY": "f", EXCLUDE: "x" };

function normalizeSql(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Etiqueta estable de una sentencia, p. ej. "table:users" o "constraint:orders_status_check_v2". */
function describeStatement(sql) {
  const s = normalizeSql(sql);
  let m;
  if (/^SET /i.test(s)) return "session";
  if ((m = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(s))) return `table:${m[1]}`;
  if ((m = /^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/i.exec(s))) return `column:${m[1]}.${m[2]}`;
  if ((m = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/i.exec(s))) return `index:${m[1]}`;
  if ((m = /^DROP INDEX IF EXISTS (\w+)/i.exec(s))) return `drop-index:${m[1]}`;
  if ((m = /^DROP TRIGGER IF EXISTS (\w+)/i.exec(s))) return `drop-trigger:${m[1]}`;
  if ((m = /^CREATE TRIGGER (\w+)/i.exec(s))) return `trigger:${m[1]}`;
  if ((m = /^CREATE OR REPLACE FUNCTION (\w+)/i.exec(s))) return `function:${m[1]}`;
  if ((m = /^INSERT INTO (\w+)/i.exec(s))) return `seed:${m[1]}`;
  if ((m = /^UPDATE (\w+)/i.exec(s))) return `data:${m[1]}`;
  if ((m = /^ALTER TABLE (\w+) (?:ADD|DROP|VALIDATE) CONSTRAINT (?:IF EXISTS )?(\w+)/i.exec(s))) return `constraint:${m[2]}`;
  if (/^DO \$\$/i.test(s)) {
    if ((m = /ADD CONSTRAINT (\w+)/i.exec(s))) return `constraint:${m[1]}`;
    if ((m = /VALIDATE CONSTRAINT (\w+)/i.exec(s))) return `constraint:${m[1]}`;
    if ((m = /DROP CONSTRAINT (?:IF EXISTS )?(\w+)/i.exec(s))) return `constraint:${m[1]}`;
    if ((m = /DROP INDEX (?:IF EXISTS )?(\w+)/i.exec(s))) return `drop-index:${m[1]}`;
    if ((m = /ADD COLUMN (?:IF NOT EXISTS )?(\w+)/i.exec(s))) return `column:${m[1]}`;
    return "block";
  }
  return "statement";
}

function computeSchemaFingerprint(statements, version = MIGRATION_FORMAT_VERSION) {
  const hash = crypto.createHash("sha256");
  hash.update(`dulcemaria-schema:${version}\n`);
  for (const sql of statements) hash.update(`${normalizeSql(sql)}\n;\n`);
  return hash.digest("hex");
}

/** SQLSTATE de fallas pasajeras (timeouts, bloqueos, conexión): conviene reintentar en el próximo arranque. */
function isTransientDbError(code) {
  if (typeof code !== "string") return false;
  return (
    code === "55P03" ||
    code === "57014" ||
    code === "40P01" ||
    code === "40001" ||
    code.startsWith("08") ||
    code.startsWith("53") ||
    code.startsWith("57P")
  );
}

function stripQuoted(text) {
  return String(text).replace(/'(?:[^']|'')*'/g, "''");
}

/** Divide por comas de primer nivel (fuera de paréntesis y de literales). */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let inQuote = false;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inQuote) {
      current += ch;
      if (ch === "'") {
        if (body[i + 1] === "'") {
          current += body[++i];
        } else {
          inQuote = false;
        }
      }
      continue;
    }
    if (ch === "'") inQuote = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function emptyManifest() {
  return {
    tables: new Map(),
    indexes: new Set(),
    triggers: new Map(),
    functions: new Set(),
    constraints: new Map(),
    mustBeValidated: new Set(),
  };
}

function setConstraint(manifest, name, table, type) {
  const key = name.toLowerCase();
  // Nombres que PostgreSQL truncaría no son predecibles con certeza: se omiten.
  if (key.length > PG_MAX_IDENTIFIER) return;
  manifest.constraints.set(key, { table, type });
}

/** Restricciones declaradas en línea en una definición de columna (nombres automáticos de PostgreSQL). */
function addInlineConstraints(manifest, table, column, definition) {
  const rest = stripQuoted(definition).toUpperCase();
  if (/\bPRIMARY KEY\b/.test(rest)) setConstraint(manifest, `${table}_pkey`, table, "p");
  if (/\bUNIQUE\b/.test(rest)) setConstraint(manifest, `${table}_${column}_key`, table, "u");
  if (/\bREFERENCES\b/.test(rest)) setConstraint(manifest, `${table}_${column}_fkey`, table, "f");
  if (/\bCHECK\s*\(/.test(rest)) setConstraint(manifest, `${table}_${column}_check`, table, "c");
}

const ALTER_OPERATION =
  /ALTER TABLE (?:ONLY )?(\w+) (?:ADD CONSTRAINT (\w+) (PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)|DROP CONSTRAINT (?:IF EXISTS )?(\w+)|VALIDATE CONSTRAINT (\w+)|ADD COLUMN (?:IF NOT EXISTS )?(\w+)([^;]*))|DROP INDEX (?:IF EXISTS )?(\w+)/gi;

/** Recorre, en orden, las operaciones ALTER/DROP de una sentencia suelta o de un bloque DO. */
function applyAlterOperations(manifest, sql) {
  for (const m of sql.matchAll(ALTER_OPERATION)) {
    const table = m[1] ? m[1].toLowerCase() : null;
    if (m[2]) setConstraint(manifest, m[2], table, CONSTRAINT_TYPES[m[3].toUpperCase()]);
    else if (m[4]) manifest.constraints.delete(m[4].toLowerCase());
    else if (m[5]) manifest.mustBeValidated.add(m[5].toLowerCase());
    else if (m[6]) {
      const column = m[6].toLowerCase();
      if (!manifest.tables.has(table)) manifest.tables.set(table, new Set());
      manifest.tables.get(table).add(column);
      addInlineConstraints(manifest, table, column, m[7] || "");
    } else if (m[8]) manifest.indexes.delete(m[8].toLowerCase());
  }
}

/** Manifiesto esperado a partir de las sentencias del esquema canónico. */
function extractSchemaManifest(statements) {
  const manifest = emptyManifest();
  const columnsOf = (table) => {
    if (!manifest.tables.has(table)) manifest.tables.set(table, new Set());
    return manifest.tables.get(table);
  };

  for (const raw of statements) {
    const s = normalizeSql(raw);
    let m;

    if ((m = /^CREATE TABLE IF NOT EXISTS (\w+) \((.*)\);?$/i.exec(s))) {
      const table = m[1].toLowerCase();
      const columns = columnsOf(table);
      for (const part of splitTopLevel(m[2])) {
        const def = part.trim();
        if (!def) continue;
        const named = /^CONSTRAINT (\w+) (PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)/i.exec(def);
        if (named) {
          setConstraint(manifest, named[1], table, CONSTRAINT_TYPES[named[2].toUpperCase()]);
          continue;
        }
        // Restricciones de tabla sin nombre: el nombre automático no se predice.
        if (/^(PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(def)) continue;
        const column = /^(\w+)/.exec(def)[1].toLowerCase();
        columns.add(column);
        addInlineConstraints(manifest, table, column, def.slice(column.length));
      }
      continue;
    }

    if ((m = /^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)(.*)$/i.exec(s))) {
      const table = m[1].toLowerCase();
      const column = m[2].toLowerCase();
      columnsOf(table).add(column);
      addInlineConstraints(manifest, table, column, m[3]);
      continue;
    }

    if ((m = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)/i.exec(s))) {
      manifest.indexes.add(m[1].toLowerCase());
      continue;
    }

    if ((m = /^CREATE TRIGGER (\w+) .*? ON (\w+)/i.exec(s))) {
      manifest.triggers.set(m[1].toLowerCase(), { table: m[2].toLowerCase() });
      continue;
    }

    if ((m = /^CREATE OR REPLACE FUNCTION (\w+)/i.exec(s))) {
      manifest.functions.add(m[1].toLowerCase());
      continue;
    }

    applyAlterOperations(manifest, s);
  }

  return manifest;
}

/**
 * Compara el manifiesto esperado con el estado real de la BD.
 * `actual` = { columns: Map<tabla, Set<col>>, indexes: Set, triggers: Map<nombre, {table}>,
 *              functions: Set, constraints: Map<nombre, {table, type, validated}> }
 */
function diffSchema(expected, actual) {
  const missing = [];
  const warnings = [];

  for (const [table, columns] of expected.tables) {
    const actualColumns = actual.columns.get(table);
    if (!actualColumns) {
      missing.push(`tabla ${table}`);
      continue;
    }
    for (const column of columns) {
      if (!actualColumns.has(column)) missing.push(`columna ${table}.${column}`);
    }
  }
  for (const index of expected.indexes) {
    if (!actual.indexes.has(index)) missing.push(`índice ${index}`);
  }
  for (const [name, { table }] of expected.triggers) {
    const found = actual.triggers.get(name);
    if (!found || found.table !== table) missing.push(`trigger ${name} (${table})`);
  }
  for (const fn of expected.functions) {
    if (!actual.functions.has(fn)) missing.push(`función ${fn}`);
  }
  for (const [name, { table, type }] of expected.constraints) {
    const found = actual.constraints.get(name);
    if (!found) {
      missing.push(`restricción ${name} (${table})`);
      continue;
    }
    if (found.table !== table || found.type !== type) {
      warnings.push(`restricción ${name}: se esperaba tipo "${type}" en ${table}, existe tipo "${found.type}" en ${found.table}.`);
    }
  }
  for (const [name, found] of actual.constraints) {
    if (found.validated === false) {
      warnings.push(`restricción ${name} (${found.table}) existe pero NO está validada: hay filas antiguas sin verificar.`);
    }
  }
  return { missing, warnings };
}

module.exports = {
  MIGRATION_FORMAT_VERSION,
  normalizeSql,
  describeStatement,
  computeSchemaFingerprint,
  isTransientDbError,
  extractSchemaManifest,
  diffSchema,
};
