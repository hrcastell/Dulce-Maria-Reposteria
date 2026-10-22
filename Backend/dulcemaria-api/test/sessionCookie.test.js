const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSessionCookie, SESSION_TTL_MS } = require("../src/lib/sessionCookie");

test("en producción usa el prefijo __Host- con Secure, Path=/ y sin Domain", () => {
  const cookie = buildSessionCookie({ production: true });
  assert.equal(cookie.name, "__Host-dm_session");
  assert.equal(cookie.options.secure, true);
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, "strict");
  assert.equal(cookie.options.path, "/");
  assert.equal("domain" in cookie.options, false);
  assert.equal(cookie.options.maxAge, SESSION_TTL_MS);
});

test("en desarrollo (http://localhost) usa dm_session sin Secure", () => {
  const cookie = buildSessionCookie({ production: false });
  assert.equal(cookie.name, "dm_session");
  assert.equal(cookie.options.secure, false);
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.path, "/");
  assert.equal("domain" in cookie.options, false);
});

test("la sesión dura 8 horas", () => {
  assert.equal(SESSION_TTL_MS, 8 * 60 * 60 * 1000);
});

test("clearCookies borra ambos nombres con atributos compatibles y sin maxAge", () => {
  for (const production of [true, false]) {
    const { clearCookies } = buildSessionCookie({ production });
    const names = clearCookies.map((c) => c.name).sort();
    assert.deepEqual(names, ["__Host-dm_session", "dm_session"]);
    for (const { name, options } of clearCookies) {
      assert.equal(options.path, "/");
      assert.equal("maxAge" in options, false);
      assert.equal("domain" in options, false);
      if (name.startsWith("__Host-")) assert.equal(options.secure, true);
    }
  }
});
