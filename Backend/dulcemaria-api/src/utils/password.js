const crypto = require("crypto");

let bcrypt = null;
try {
  bcrypt = require("bcryptjs");
} catch {
  bcrypt = null;
}

// Costo de bcrypt para hashes nuevos. Los hashes con costo menor (o PBKDF2
// heredado) se re-hashean de forma transparente en el siguiente login exitoso.
const BCRYPT_TARGET_COST = 12;

// Formato PBKDF2: pbkdf2$sha256$150000$salt$hash
function pbkdf2Hash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iter = 150000;
  const keylen = 32;
  const digest = "sha256";
  const derived = crypto.pbkdf2Sync(password, salt, iter, keylen, digest).toString("hex");
  return `pbkdf2$${digest}$${iter}$${salt}$${derived}`;
}

function pbkdf2Verify(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  const [, digest, iterStr, salt, hash] = parts;
  const iter = Number(iterStr);
  const keylen = hash.length / 2;
  const derived = crypto.pbkdf2Sync(password, salt, iter, keylen, digest).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

async function hashPassword(password) {
  if (bcrypt) return await bcrypt.hash(password, BCRYPT_TARGET_COST);
  return pbkdf2Hash(password);
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith("pbkdf2$")) return pbkdf2Verify(password, storedHash);
  if (bcrypt) return await bcrypt.compare(password, storedHash);
  return false;
}

/**
 * ¿Conviene re-hashear este hash tras un login exitoso?
 * Verdadero para PBKDF2 heredado y para bcrypt con costo menor al objetivo.
 * Formatos desconocidos no se tocan.
 */
function needsRehash(storedHash, { bcryptAvailable = Boolean(bcrypt) } = {}) {
  const value = String(storedHash || "");
  if (value.startsWith("pbkdf2$")) return bcryptAvailable;
  const match = /^\$2[abxy]\$(\d{2})\$/.exec(value);
  if (match) return Number(match[1]) < BCRYPT_TARGET_COST;
  return false;
}

module.exports = { hashPassword, verifyPassword, needsRehash, BCRYPT_TARGET_COST };
