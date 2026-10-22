const test = require("node:test");
const assert = require("node:assert/strict");

const { assessJwtSecret } = require("../src/config/secrets");

// Valores fijos (no aleatorios) para que las pruebas sean deterministas.
const STRONG_HEX = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const STRONG_BASE64URL = "Xq3Vb8LmZp2RtYw9KcNf4HsJdA7gUe1o0iBxMvTzWkQ";

test("acepta secretos aleatorios largos en producción", () => {
  for (const secret of [STRONG_HEX, STRONG_BASE64URL]) {
    const result = assessJwtSecret(secret, { production: true });
    assert.equal(result.ok, true, `debería aceptar ${secret.length} caracteres`);
    assert.equal(result.fatal, false);
    assert.deepEqual(result.problems, []);
  }
});

test("menos de 32 caracteres es fatal en cualquier modo", () => {
  for (const production of [true, false]) {
    const result = assessJwtSecret("aB3$dE6&gH9*jK2", { production });
    assert.equal(result.ok, false);
    assert.equal(result.fatal, true);
    assert.ok(result.problems.some((p) => p.code === "too_short"));
  }
});

test("rechaza los placeholders publicados en la documentación", () => {
  const placeholders = [
    "local-dev-only-jwt-secret-change-me-0123456789",
    "tu_secret_muy_largo_y_seguro_minimo_32_caracteres",
  ];
  for (const secret of placeholders) {
    const result = assessJwtSecret(secret, { production: true });
    assert.equal(result.ok, false);
    assert.equal(result.fatal, true);
    assert.ok(result.problems.some((p) => p.code === "placeholder"));
  }
});

test("rechaza marcadores típicos de valores de ejemplo", () => {
  const result = assessJwtSecret("Kq8Zr2Lm5Np9Tx4Vb7Wc1Yd6CHANGEME3Fh0Gj8Hk2Jl5", { production: true });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === "placeholder"));
});

test("rechaza secretos con poca variedad de caracteres o baja entropía", () => {
  const repeated = "a".repeat(64);
  const result = assessJwtSecret(repeated, { production: true });
  assert.equal(result.ok, false);
  assert.equal(result.fatal, true);
  const codes = result.problems.map((p) => p.code);
  assert.ok(codes.includes("low_variety"));
  assert.ok(codes.includes("low_entropy"));
});

test("en producción exige al menos 43 caracteres (~32 bytes aleatorios)", () => {
  const forty = STRONG_BASE64URL.slice(0, 40);
  const prod = assessJwtSecret(forty, { production: true });
  assert.equal(prod.ok, false);
  assert.equal(prod.fatal, true);
  assert.ok(prod.problems.some((p) => p.code === "too_short_for_production"));

  const dev = assessJwtSecret(forty, { production: false });
  assert.equal(dev.ok, true);
});

test("en desarrollo un placeholder solo advierte (no es fatal)", () => {
  const result = assessJwtSecret("local-dev-only-jwt-secret-change-me-0123456789", { production: false });
  assert.equal(result.ok, false);
  assert.equal(result.fatal, false);
});

test("cada problema trae un mensaje legible en español", () => {
  const result = assessJwtSecret("short", { production: true });
  for (const problem of result.problems) {
    assert.equal(typeof problem.message, "string");
    assert.ok(problem.message.length > 10);
  }
});
