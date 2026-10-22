const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");

const {
  GENERIC_INTERNAL_ERROR,
  installSpanishErrorMap,
  formatZodError,
  isDatabaseError,
  mapDatabaseError,
  describeRouteError,
  coerceErrorBody,
  AppError,
  appError,
  sendError,
  validationError,
} = require("../src/lib/httpErrors");

installSpanishErrorMap();

function dbError(code, message = "mensaje interno de postgres") {
  return Object.assign(new Error(message), { code, severity: "ERROR", detail: "Key (email)=(x@y.cl) already exists." });
}

test("formatZodError devuelve un string en español y los detalles aparte", () => {
  const schema = z.object({ fullName: z.string().min(2), email: z.string().email() });
  const parsed = schema.safeParse({ fullName: "A", email: "no-es-correo" });
  assert.equal(parsed.success, false);
  const { error, details } = formatZodError(parsed.error);
  assert.equal(typeof error, "string");
  assert.match(error, /^Datos inválidos/);
  assert.match(error, /fullName: Debe tener al menos 2 caracteres/);
  assert.match(error, /email: Correo electrónico inválido/);
  assert.ok(details.fieldErrors.fullName);
  assert.ok(details.fieldErrors.email);
});

test("el mapa de errores traduce los casos comunes de zod", () => {
  const cases = [
    [z.object({ a: z.string() }), {}, /a: Campo obligatorio/],
    [z.object({ a: z.number() }), { a: "x" }, /se esperaba número/],
    [z.object({ a: z.number().int() }), { a: 1.5 }, /número entero/],
    [z.object({ a: z.number().max(10) }), { a: 11 }, /menor o igual a 10/],
    [z.object({ a: z.number().positive() }), { a: 0 }, /mayor a 0/],
    [z.object({ a: z.string().max(3) }), { a: "abcd" }, /a lo más 3 caracteres/],
    [z.object({ a: z.array(z.number()).max(1) }), { a: [1, 2] }, /a lo más 1 elemento/],
    [z.object({ a: z.string().uuid() }), { a: "x" }, /UUID/],
    [z.object({ a: z.enum(["X", "Y"]) }), { a: "Z" }, /Opciones: X, Y/],
    [z.object({ a: z.string() }).strict(), { a: "x", b: 1 }, /Campos no permitidos: b/],
    [z.object({ a: z.string().regex(/^\d+$/) }), { a: "x" }, /Formato inválido/],
  ];
  for (const [schema, input, expected] of cases) {
    const parsed = schema.safeParse(input);
    assert.equal(parsed.success, false);
    assert.match(formatZodError(parsed.error).error, expected);
  }
});

test("los mensajes personalizados de refine se conservan", () => {
  const schema = z.object({ a: z.number() }).refine((d) => d.a > 5, { message: "El valor debe superar 5" });
  const parsed = schema.safeParse({ a: 1 });
  assert.match(formatZodError(parsed.error).error, /El valor debe superar 5/);
});

test("formatZodError resume como máximo tres problemas", () => {
  const schema = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() });
  const parsed = schema.safeParse({});
  const { error } = formatZodError(parsed.error);
  assert.match(error, /y 2 más/);
});

test("isDatabaseError distingue errores de PostgreSQL de errores de la app", () => {
  assert.equal(isDatabaseError(dbError("23505")), true);
  assert.equal(isDatabaseError(new Error("Stock insuficiente")), false);
  assert.equal(isDatabaseError(Object.assign(new Error("x"), { code: "ENOENT" })), false);
  assert.equal(isDatabaseError(null), false);
});

test("mapDatabaseError nunca devuelve el texto interno de PostgreSQL", () => {
  const codes = ["23505", "23503", "23514", "23502", "22P02", "22003", "22001", "40P01", "55P03", "57014", "XX000"];
  for (const code of codes) {
    const mapped = mapDatabaseError(dbError(code, "texto-secreto-del-motor"));
    assert.equal(typeof mapped.status, "number");
    assert.equal(typeof mapped.error, "string");
    assert.equal(mapped.error.includes("texto-secreto-del-motor"), false);
    assert.equal(mapped.error.includes("x@y.cl"), false);
  }
  assert.equal(mapDatabaseError(dbError("23505")).status, 409);
  assert.equal(mapDatabaseError(dbError("22003")).status, 400);
  assert.equal(mapDatabaseError(dbError("57014")).status, 503);
  assert.deepEqual(mapDatabaseError(dbError("XX000")), { status: 500, error: GENERIC_INTERNAL_ERROR });
});

test("describeRouteError: errores de BD se traducen y se marcan para log", () => {
  const result = describeRouteError(dbError("22P02"), { defaultStatus: 400 });
  assert.equal(result.status, 400);
  assert.equal(result.error.includes("mensaje interno"), false);
  assert.equal(result.log, true);
});

test("describeRouteError: errores de negocio explícitos conservan su mensaje", () => {
  const err = Object.assign(new Error("Orden no encontrada"), { statusCode: 404 });
  assert.deepEqual(describeRouteError(err), { status: 404, error: "Orden no encontrada", log: false });
});

test("describeRouteError: Error simple usa el estado por defecto de la ruta", () => {
  const result = describeRouteError(new Error("Stock insuficiente para X"), { defaultStatus: 400 });
  assert.deepEqual(result, { status: 400, error: "Stock insuficiente para X", log: false });
});

test("describeRouteError: fallas de programación nunca exponen su mensaje", () => {
  const result = describeRouteError(new TypeError("Cannot read properties of undefined"), { defaultStatus: 400 });
  assert.deepEqual(result, { status: 500, error: GENERIC_INTERNAL_ERROR, log: true });
});

test("describeRouteError: sin estado por defecto un Error simple es 500 genérico", () => {
  const result = describeRouteError(new Error("algo interno"));
  assert.deepEqual(result, { status: 500, error: GENERIC_INTERNAL_ERROR, log: true });
});

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("AppError: errores de dominio con código estable y campos extra", () => {
  const err = appError(409, "OUT_OF_STOCK", "Stock insuficiente para Pie.", { product_id: "p1" });
  assert.ok(err instanceof AppError);
  assert.ok(err instanceof Error);
  assert.deepEqual(describeRouteError(err), {
    status: 409,
    error: "Stock insuficiente para Pie.",
    code: "OUT_OF_STOCK",
    extra: { product_id: "p1" },
    log: false,
  });
});

test("sendError incluye `code` y los campos extra sin pisar ok/error", () => {
  const res = fakeRes();
  sendError(res, appError(403, "RESIDENTS_ONLY", "Solo residentes.", { whatsapp_number: "569", ok: true, error: "x" }));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { whatsapp_number: "569", ok: false, error: "Solo residentes.", code: "RESIDENTS_ONLY" });
});

test("un AppError 5xx nunca expone su mensaje", () => {
  const result = describeRouteError(appError(500, "BROKEN", "detalle interno"));
  assert.deepEqual(result, { status: 500, error: GENERIC_INTERNAL_ERROR, log: true });
});

test("unavailableError: 503 con mensaje y código escritos por la app (proveedor de pago no disponible)", () => {
  const { unavailableError } = require("../src/lib/httpErrors");
  assert.deepEqual(describeRouteError(unavailableError("PROVIDER_UNAVAILABLE", "Intenta más tarde.", { whatsapp_number: "569" })), {
    status: 503,
    error: "Intenta más tarde.",
    code: "PROVIDER_UNAVAILABLE",
    extra: { whatsapp_number: "569" },
    log: false,
  });
  // Un AppError 503 común sigue enmascarado.
  assert.deepEqual(describeRouteError(appError(503, "X", "detalle")), { status: 500, error: GENERIC_INTERNAL_ERROR, log: true });
});

test("validationError responde 400 con code VALIDATION_ERROR", () => {
  const parsed = z.object({ a: z.string() }).safeParse({});
  const res = fakeRes();
  validationError(res, parsed.error);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, "VALIDATION_ERROR");
  assert.match(res.body.error, /a: Campo obligatorio/);
});

test("coerceErrorBody convierte un error-objeto en string y lo mueve a details", () => {
  const flattened = { formErrors: [], fieldErrors: { name: ["Campo obligatorio."] } };
  assert.deepEqual(coerceErrorBody({ ok: false, error: flattened }), {
    ok: false,
    error: "Datos inválidos — name: Campo obligatorio.",
    details: flattened,
  });
  assert.deepEqual(coerceErrorBody({ ok: false, error: "ya es texto" }), { ok: false, error: "ya es texto" });
});
