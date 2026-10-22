const test = require("node:test");
const assert = require("node:assert/strict");

const { isProductionMode, describeSecurityMode } = require("../src/config/runtime");

test("NODE_ENV=production activa el modo producción", () => {
  assert.equal(isProductionMode({ NODE_ENV: "production" }), true);
  assert.equal(isProductionMode({ NODE_ENV: " Production " }), true);
});

test("sin NODE_ENV (o con un valor desconocido) se asume producción: seguro por defecto", () => {
  assert.equal(isProductionMode({}), true);
  assert.equal(isProductionMode({ NODE_ENV: "" }), true);
  assert.equal(isProductionMode({ NODE_ENV: "staging" }), true);
  assert.equal(isProductionMode({ NODE_ENV: "prod" }), true);
});

test("solo development y test desactivan el modo producción", () => {
  assert.equal(isProductionMode({ NODE_ENV: "development" }), false);
  assert.equal(isProductionMode({ NODE_ENV: "DEVELOPMENT" }), false);
  assert.equal(isProductionMode({ NODE_ENV: "test" }), false);
});

test("describeSecurityMode marca cuando producción es implícita", () => {
  assert.deepEqual(describeSecurityMode({ NODE_ENV: "production" }), {
    production: true,
    nodeEnv: "production",
    implicit: false,
  });
  assert.deepEqual(describeSecurityMode({}), { production: true, nodeEnv: null, implicit: true });
  assert.deepEqual(describeSecurityMode({ NODE_ENV: "staging" }), {
    production: true,
    nodeEnv: "staging",
    implicit: true,
  });
  assert.deepEqual(describeSecurityMode({ NODE_ENV: "development" }), {
    production: false,
    nodeEnv: "development",
    implicit: false,
  });
});
