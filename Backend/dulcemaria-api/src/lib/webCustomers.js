/**
 * Clientes y límites del canal web (checkout público), sobre la transacción
 * del llamador. Reglas de identidad en customerIdentity.js (C-13).
 */

const crypto = require("crypto");
const { phoneMatchKeys, pickReusableWebCustomer, normalizeEmail } = require("./customerIdentity");

// Teléfono normalizado en SQL con la misma regla que normalizePhoneDigits().
const PHONE_DIGITS_SQL = (column) => `regexp_replace(COALESCE(${column}, ''), '[^0-9]', '', 'g')`;

/**
 * Reutiliza una ficha creada por la web (mismo teléfono y nombre, sin choque
 * de correo) o crea una nueva con source = 'WEB'. Nunca modifica una ficha
 * existente ni usa fichas del panel. El correo solo se guarda en la ficha
 * nueva si ningún otro cliente lo tiene (customers.email es único).
 * @returns {{ customerId: string, reused: boolean }}
 */
async function findOrCreateWebCustomer(client, { name, phone, email, address }) {
  const keys = phoneMatchKeys(phone);
  if (keys.length) {
    const r = await client.query(
      `SELECT id, full_name, email FROM customers
       WHERE source = 'WEB' AND ${PHONE_DIGITS_SQL("phone")} = ANY($1::text[])
       ORDER BY created_at DESC
       LIMIT 25`,
      [keys]
    );
    const reusable = pickReusableWebCustomer(r.rows, { name, email });
    if (reusable) return { customerId: reusable.id, reused: true };
  }

  const wantedEmail = normalizeEmail(email);
  let storedEmail = null;
  if (wantedEmail) {
    const taken = await client.query(`SELECT 1 FROM customers WHERE lower(email) = $1 LIMIT 1`, [wantedEmail]);
    storedEmail = taken.rowCount ? null : wantedEmail;
  }

  const customerId = crypto.randomUUID();
  const insert = (emailValue) =>
    client.query(
      `INSERT INTO customers (id, full_name, phone, address, email, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'WEB', NOW(), NOW())`,
      [customerId, name, phone, address || null, emailValue]
    );

  if (!storedEmail) {
    await insert(null);
    return { customerId, reused: false };
  }
  // Carrera improbable con otro pedido que use el mismo correo: se guarda sin él.
  await client.query("SAVEPOINT web_customer_email");
  try {
    await insert(storedEmail);
    await client.query("RELEASE SAVEPOINT web_customer_email");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT web_customer_email");
    if (e?.code !== "23505") throw e;
    await insert(null);
  }
  return { customerId, reused: false };
}

/** Pedidos de catálogo web de este teléfono en los últimos `minutes` minutos. */
async function countRecentWebOrders(client, phone, { minutes = 60 } = {}) {
  const keys = phoneMatchKeys(phone);
  if (!keys.length) return 0;
  const r = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.order_code LIKE 'WEB-%'
       AND o.created_at >= NOW() - ($2::int * INTERVAL '1 minute')
       AND ${PHONE_DIGITS_SQL("c.phone")} = ANY($1::text[])`,
    [keys, minutes]
  );
  return r.rows[0].n;
}

/** Pedidos de torta web de este teléfono en los últimos `minutes` minutos. */
async function countRecentCakeOrders(client, phone, { minutes = 60 } = {}) {
  const keys = phoneMatchKeys(phone);
  if (!keys.length) return 0;
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM cake_orders
     WHERE created_at >= NOW() - ($2::int * INTERVAL '1 minute')
       AND ${PHONE_DIGITS_SQL("customer_phone")} = ANY($1::text[])`,
    [keys, minutes]
  );
  return r.rows[0].n;
}

module.exports = { findOrCreateWebCustomer, countRecentWebOrders, countRecentCakeOrders };
