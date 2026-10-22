/**
 * Identidad de clientes para el checkout público (C-13).
 *
 * Un pedido web puede REUTILIZAR una ficha creada por la web (customers.source
 * = 'WEB') solo si coinciden el teléfono (normalizado) y el nombre
 * (normalizado) y no hay choque de correo. Nunca modifica la ficha reutilizada
 * y nunca usa fichas privadas del panel (source = 'ADMIN'): conocer el
 * teléfono o el correo de alguien no permite cambiar ni "adoptar" su ficha.
 * Los datos propios de cada pedido (dirección, correo) se guardan en la orden.
 */

/** Solo dígitos. */
function normalizePhoneDigits(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * Claves equivalentes de un teléfono: en Chile el mismo número puede venir con
 * o sin código de país (56 + 9 dígitos). Otros países: solo sus dígitos.
 */
function phoneMatchKeys(raw) {
  const digits = normalizePhoneDigits(raw);
  if (!digits) return [];
  const keys = new Set([digits]);
  if (digits.length === 9) keys.add(`56${digits}`);
  if (digits.length === 11 && digits.startsWith("56")) keys.add(digits.slice(2));
  return [...keys];
}

/** Minúsculas, sin tildes y con espacios simples (misma regla que el panel). */
function normalizePersonName(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmail(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return value || null;
}

/** Primera ficha web reutilizable entre los candidatos (ya filtrados por teléfono). */
function pickReusableWebCustomer(candidates, { name, email } = {}) {
  const wantedName = normalizePersonName(name);
  const wantedEmail = normalizeEmail(email);
  if (!wantedName) return null;
  for (const candidate of candidates || []) {
    if (normalizePersonName(candidate.full_name) !== wantedName) continue;
    const candidateEmail = normalizeEmail(candidate.email);
    if (wantedEmail && candidateEmail && wantedEmail !== candidateEmail) continue;
    return candidate;
  }
  return null;
}

module.exports = { normalizePhoneDigits, phoneMatchKeys, normalizePersonName, normalizeEmail, pickReusableWebCustomer };
