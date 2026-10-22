const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldRevokeSessions } = require("../src/lib/sessions");

const existing = { role: "STAFF", is_active: true };

test("cambiar la contraseña revoca todas las sesiones", () => {
  assert.equal(shouldRevokeSessions(existing, { password: "nueva-clave-segura" }), true);
});

test("cambiar el rol o desactivar revoca; repetir el mismo valor no", () => {
  assert.equal(shouldRevokeSessions(existing, { role: "ADMIN" }), true);
  assert.equal(shouldRevokeSessions(existing, { role: "STAFF" }), false);
  assert.equal(shouldRevokeSessions(existing, { isActive: false }), true);
  assert.equal(shouldRevokeSessions(existing, { isActive: true }), false);
});

test("reactivar una cuenta también invalida cualquier sesión previa", () => {
  assert.equal(shouldRevokeSessions({ role: "ADMIN", is_active: false }, { isActive: true }), true);
});

test("editar nombre o permisos no cierra sesiones", () => {
  assert.equal(shouldRevokeSessions(existing, { fullName: "Otro nombre", permissions: {} }), false);
  assert.equal(shouldRevokeSessions(existing, {}), false);
});
