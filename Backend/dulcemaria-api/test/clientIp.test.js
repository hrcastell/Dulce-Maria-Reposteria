const test = require("node:test");
const assert = require("node:assert/strict");

const { rateLimitKeyFromIp, normalizeLoginEmail } = require("../src/lib/clientIp");

test("IPv4 se usa tal cual", () => {
  assert.equal(rateLimitKeyFromIp("203.0.113.7"), "203.0.113.7");
});

test("IPv4 mapeada en IPv6 se normaliza a IPv4", () => {
  assert.equal(rateLimitKeyFromIp("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(rateLimitKeyFromIp("::FFFF:203.0.113.7"), "203.0.113.7");
});

test("IPv6 se agrupa por prefijo /64 (un cliente suele controlar todo el /64)", () => {
  assert.equal(rateLimitKeyFromIp("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd:12::/64");
  assert.equal(rateLimitKeyFromIp("2001:DB8:ABCD:0012:ffff:0:0:1"), "2001:db8:abcd:12::/64");
  assert.equal(rateLimitKeyFromIp("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(rateLimitKeyFromIp("::1"), "0:0:0:0::/64");
  assert.equal(rateLimitKeyFromIp("fe80::1%eth0"), "fe80:0:0:0::/64");
});

test("valores ausentes o inválidos caen en una clave fija", () => {
  assert.equal(rateLimitKeyFromIp(undefined), "ip-desconocida");
  assert.equal(rateLimitKeyFromIp(""), "ip-desconocida");
  assert.equal(rateLimitKeyFromIp("no-es-ip"), "ip-desconocida");
});

test("normalizeLoginEmail recorta, pasa a minúsculas y acota el largo", () => {
  assert.equal(normalizeLoginEmail("  Admin@Example.COM "), "admin@example.com");
  assert.equal(normalizeLoginEmail("a".repeat(400)).length, 254);
  assert.equal(normalizeLoginEmail(undefined), "");
  assert.equal(normalizeLoginEmail({ $ne: 1 }), "");
});
