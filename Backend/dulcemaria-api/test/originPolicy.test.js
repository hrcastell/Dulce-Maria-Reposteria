const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOrigin,
  parseOriginList,
  resolveOriginPolicy,
  buildCorsHeaders,
  decideFetchMetadata,
} = require("../src/lib/originPolicy");

const ADMIN = "https://admin.dulcemaria.hrcastell.com";
const STORE = "https://dulcemaria.hrcastell.com";

test("normalizeOrigin acepta solo orígenes http(s) y los canoniza", () => {
  assert.equal(normalizeOrigin("https://Admin.Example.com/"), "https://admin.example.com");
  assert.equal(normalizeOrigin("http://localhost:4302"), "http://localhost:4302");
  assert.equal(normalizeOrigin("https://example.com/ruta/x"), "https://example.com");
  assert.equal(normalizeOrigin("null"), null);
  assert.equal(normalizeOrigin("*"), null);
  assert.equal(normalizeOrigin("ftp://example.com"), null);
  assert.equal(normalizeOrigin(""), null);
  assert.equal(normalizeOrigin(undefined), null);
});

test("parseOriginList separa por comas, ignora vacíos y reporta inválidos", () => {
  const { origins, invalid } = parseOriginList(" https://a.example.com , ,http://localhost:4302/,*, nada ");
  assert.deepEqual(origins, ["https://a.example.com", "http://localhost:4302"]);
  assert.deepEqual(invalid, ["*", "nada"]);
});

test("con ADMIN_ORIGINS y PUBLIC_ORIGINS explícitos se usan tal cual", () => {
  const policy = resolveOriginPolicy({
    NODE_ENV: "production",
    ADMIN_ORIGINS: ADMIN,
    PUBLIC_ORIGINS: STORE,
    FRONTEND_URL: "https://otro.example.com",
  });
  assert.deepEqual([...policy.admin], [ADMIN]);
  assert.deepEqual([...policy.public], [STORE]);
  assert.equal(policy.legacyAdmin, false);
  assert.equal(policy.legacyPublic, false);
  assert.deepEqual(policy.errors, []);
});

test("sin ADMIN_ORIGINS cae a FRONTEND_URL con advertencia ruidosa (compatibilidad)", () => {
  const policy = resolveOriginPolicy({ NODE_ENV: "production", FRONTEND_URL: "https://panel.example.com" });
  assert.equal(policy.legacyAdmin, true);
  assert.ok(policy.admin.has("https://panel.example.com"));
  assert.ok(policy.admin.has(ADMIN), "mantiene el origen histórico del panel");
  assert.ok(policy.warnings.some((w) => w.includes("ADMIN_ORIGINS")));
});

test("el sitio público nunca queda como origen de administración en el modo heredado", () => {
  const policy = resolveOriginPolicy({ NODE_ENV: "production", FRONTEND_URL: `${ADMIN},${STORE}` });
  assert.equal(policy.admin.has(STORE), false);
  assert.equal(policy.public.has(STORE), true);
});

test("en el modo heredado PUBLIC_ORIGINS explícito también se excluye del panel", () => {
  const policy = resolveOriginPolicy({
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:4302,http://localhost:4303",
    PUBLIC_ORIGINS: "http://localhost:4303",
  });
  assert.equal(policy.admin.has("http://localhost:4302"), true);
  assert.equal(policy.admin.has("http://localhost:4303"), false);
  assert.equal(policy.public.has("http://localhost:4303"), true);
});

test("los orígenes de FRONTEND_URL siguen recibiendo CORS público en el modo heredado", () => {
  const policy = resolveOriginPolicy({ NODE_ENV: "development", FRONTEND_URL: "http://localhost:4303" });
  assert.equal(policy.public.has("http://localhost:4303"), true);
});

test("localhost solo se agrega por defecto fuera de producción", () => {
  const dev = resolveOriginPolicy({ NODE_ENV: "development" });
  assert.equal(dev.admin.has("http://localhost:3000"), true);
  assert.equal(dev.public.has("http://localhost:5173"), true);
  const prod = resolveOriginPolicy({ NODE_ENV: "production", FRONTEND_URL: ADMIN });
  assert.equal(prod.admin.has("http://localhost:3000"), false);
  assert.equal(prod.public.has("http://localhost:5173"), false);
});

test("un comodín o un valor inválido en ADMIN_ORIGINS es un error de configuración", () => {
  const policy = resolveOriginPolicy({ NODE_ENV: "production", ADMIN_ORIGINS: `${ADMIN},*` });
  assert.ok(policy.errors.some((e) => e.includes("ADMIN_ORIGINS")));
});

test("advierte si un origen figura a la vez como panel y como sitio público", () => {
  const policy = resolveOriginPolicy({ NODE_ENV: "production", ADMIN_ORIGINS: STORE, PUBLIC_ORIGINS: STORE });
  assert.ok(policy.warnings.some((w) => w.includes(STORE)));
});

test("advierte orígenes http en producción", () => {
  const policy = resolveOriginPolicy({ NODE_ENV: "production", ADMIN_ORIGINS: "http://admin.example.com" });
  assert.ok(policy.warnings.some((w) => w.includes("http://admin.example.com")));
});

test("buildCorsHeaders refleja el origen permitido con credenciales", () => {
  const headers = buildCorsHeaders({ origin: ADMIN, allowed: true, credentials: true, preflight: false });
  assert.equal(headers["Access-Control-Allow-Origin"], ADMIN);
  assert.equal(headers["Access-Control-Allow-Credentials"], "true");
  assert.equal(headers["Access-Control-Allow-Methods"], undefined);
});

test("buildCorsHeaders nunca usa comodín ni credenciales para orígenes públicos", () => {
  const headers = buildCorsHeaders({ origin: STORE, allowed: true, credentials: false, preflight: false });
  assert.equal(headers["Access-Control-Allow-Origin"], STORE);
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
});

test("buildCorsHeaders omite cabeceras CORS (sin error) para un origen desconocido", () => {
  const headers = buildCorsHeaders({
    origin: "https://webpay3g.transbank.cl",
    allowed: false,
    credentials: true,
    preflight: false,
  });
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
});

test("buildCorsHeaders agrega métodos, cabeceras y max-age en preflight permitido", () => {
  const headers = buildCorsHeaders({
    origin: ADMIN,
    allowed: true,
    credentials: true,
    preflight: true,
    methods: ["GET", "POST"],
    allowHeaders: ["Content-Type"],
    maxAgeSeconds: 600,
  });
  assert.equal(headers["Access-Control-Allow-Methods"], "GET, POST");
  assert.equal(headers["Access-Control-Allow-Headers"], "Content-Type");
  assert.equal(headers["Access-Control-Max-Age"], "600");
});

test("decideFetchMetadata permite clientes sin Sec-Fetch-Site (curl, REST Client)", () => {
  const admin = new Set([ADMIN]);
  assert.equal(decideFetchMetadata({ site: undefined, origin: undefined, adminOrigins: admin }).allowed, true);
});

test("decideFetchMetadata permite same-origin y navegación directa (none)", () => {
  const admin = new Set([ADMIN]);
  assert.equal(decideFetchMetadata({ site: "same-origin", origin: undefined, adminOrigins: admin }).allowed, true);
  assert.equal(decideFetchMetadata({ site: "none", origin: undefined, adminOrigins: admin }).allowed, true);
});

test("decideFetchMetadata permite same-site solo desde un origen del panel", () => {
  const admin = new Set([ADMIN]);
  assert.equal(decideFetchMetadata({ site: "same-site", origin: ADMIN, adminOrigins: admin }).allowed, true);
  assert.equal(decideFetchMetadata({ site: "same-site", origin: STORE, adminOrigins: admin }).allowed, false);
  assert.equal(decideFetchMetadata({ site: "same-site", origin: undefined, adminOrigins: admin }).allowed, false);
});

test("decideFetchMetadata bloquea cross-site ajeno y valores desconocidos", () => {
  const admin = new Set([ADMIN]);
  assert.equal(
    decideFetchMetadata({ site: "cross-site", origin: "https://evil.example", adminOrigins: admin }).allowed,
    false
  );
  assert.equal(decideFetchMetadata({ site: "cross-site", origin: "null", adminOrigins: admin }).allowed, false);
  assert.equal(decideFetchMetadata({ site: "algo-nuevo", origin: ADMIN, adminOrigins: admin }).allowed, false);
});
