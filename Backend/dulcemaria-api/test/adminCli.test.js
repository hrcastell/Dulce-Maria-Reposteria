const test = require("node:test");
const assert = require("node:assert/strict");

const { parseCliArgs, validateNewPassword, stripSingleTrailingNewline } = require("../scripts/admin-cli");

test("parseCliArgs reconoce los comandos y el email", () => {
  assert.deepEqual(parseCliArgs(["create-superadmin", "--email", "Dueno@Example.com", "--name", "Dueña"]), {
    command: "create-superadmin",
    email: "dueno@example.com",
    name: "Dueña",
    help: false,
    errors: [],
  });
  assert.equal(parseCliArgs(["reset-password", "--email=a@b.cl"]).email, "a@b.cl");
  assert.equal(parseCliArgs(["revoke-sessions", "--email", "a@b.cl"]).command, "revoke-sessions");
});

test("parseCliArgs nunca acepta la contraseña como argumento", () => {
  for (const argv of [
    ["reset-password", "--email", "a@b.cl", "--password", "x"],
    ["reset-password", "--email", "a@b.cl", "--password=x"],
    ["reset-password", "--email", "a@b.cl", "-p", "x"],
  ]) {
    const parsed = parseCliArgs(argv);
    assert.ok(parsed.errors.some((e) => /contraseña/i.test(e)), argv.join(" "));
  }
});

test("parseCliArgs reporta comandos, flags y emails inválidos", () => {
  assert.ok(parseCliArgs(["borrar-todo"]).errors.length > 0);
  assert.ok(parseCliArgs(["reset-password"]).errors.some((e) => /--email/.test(e)));
  assert.ok(parseCliArgs(["reset-password", "--email", "no-es-correo"]).errors.length > 0);
  assert.ok(parseCliArgs(["reset-password", "--email", "a@b.cl", "--otra"]).errors.length > 0);
  assert.equal(parseCliArgs(["--help"]).help, true);
  assert.equal(parseCliArgs([]).help, true);
});

test("validateNewPassword exige 12 a 200 caracteres sin caracteres de control", () => {
  assert.equal(validateNewPassword("corta").ok, false);
  assert.equal(validateNewPassword("x".repeat(201)).ok, false);
  assert.equal(validateNewPassword("una clave larga y segura").ok, true);
  assert.equal(validateNewPassword("linea1\nlinea2-larga").ok, false);
  assert.equal(validateNewPassword("            ").ok, false);
  assert.equal(typeof validateNewPassword("corta").error, "string");
});

test("stripSingleTrailingNewline quita solo el salto final de stdin", () => {
  assert.equal(stripSingleTrailingNewline("clave\n"), "clave");
  assert.equal(stripSingleTrailingNewline("clave\r\n"), "clave");
  assert.equal(stripSingleTrailingNewline("clave"), "clave");
  assert.equal(stripSingleTrailingNewline("clave\n\n"), "clave\n");
});
