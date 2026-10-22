const test = require("node:test");
const assert = require("node:assert/strict");

const { installSpanishErrorMap } = require("../src/lib/httpErrors");
const {
  SALES_MODES,
  SALES_SETTINGS_KEYS,
  DEFAULT_SALES_SETTINGS,
  parseSalesSettingsRows,
  normalizeWhatsappNumber,
  salesSettingsPatchSchema,
  residencyInputSchema,
  evaluateResidency,
  residentsOnlyErrorBody,
  resolveWebDelivery,
  toPublicSalesSettings,
} = require("../src/lib/salesSettings");

installSpanishErrorMap();

const residentsOnly = { ...DEFAULT_SALES_SETTINGS };
const open = { ...DEFAULT_SALES_SETTINGS, sales_mode: "OPEN" };

test("por defecto la instancia vende solo a residentes del condominio", () => {
  assert.deepEqual(SALES_MODES, ["RESIDENTS_ONLY", "OPEN"]);
  assert.deepEqual(SALES_SETTINGS_KEYS, ["sales_mode", "condo_name", "condo_address", "whatsapp_number"]);
  assert.equal(DEFAULT_SALES_SETTINGS.sales_mode, "RESIDENTS_ONLY");
  assert.equal(DEFAULT_SALES_SETTINGS.condo_name, "Condominio Vicuña Mackenna 2585");
  assert.equal(DEFAULT_SALES_SETTINGS.condo_address, "Vicuña Mackenna 2585");
  assert.match(DEFAULT_SALES_SETTINGS.whatsapp_number, /^\d{8,15}$/);
});

test("parseSalesSettingsRows completa con valores por defecto y falla hacia el modo seguro", () => {
  assert.deepEqual(parseSalesSettingsRows([]), DEFAULT_SALES_SETTINGS);
  const parsed = parseSalesSettingsRows([
    { key: "sales_mode", value: "OPEN" },
    { key: "whatsapp_number", value: "56911112222" },
    { key: "cake_base_price", value: "30000" },
  ]);
  assert.equal(parsed.sales_mode, "OPEN");
  assert.equal(parsed.whatsapp_number, "56911112222");
  assert.equal(parsed.cake_base_price, undefined);
  assert.equal(parseSalesSettingsRows([{ key: "sales_mode", value: "ABIERTO" }]).sales_mode, "RESIDENTS_ONLY");
  assert.equal(parseSalesSettingsRows([{ key: "condo_name", value: "   " }]).condo_name, DEFAULT_SALES_SETTINGS.condo_name);
});

test("normalizeWhatsappNumber acepta formatos humanos y devuelve solo dígitos", () => {
  assert.equal(normalizeWhatsappNumber("+56 9 3242 3459"), "56932423459");
  assert.equal(normalizeWhatsappNumber("56-9-3242-3459"), "56932423459");
  assert.equal(normalizeWhatsappNumber("123"), null);
  assert.equal(normalizeWhatsappNumber("0956932423459"), null);
  assert.equal(normalizeWhatsappNumber(undefined), null);
});

test("salesSettingsPatchSchema valida y normaliza una actualización parcial", () => {
  const ok = salesSettingsPatchSchema.safeParse({ sales_mode: "OPEN", whatsapp_number: "+56 9 3242 3459" });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { sales_mode: "OPEN", whatsapp_number: "56932423459" });
  assert.equal(salesSettingsPatchSchema.safeParse({}).success, false);
  assert.equal(salesSettingsPatchSchema.safeParse({ sales_mode: "TODOS" }).success, false);
  assert.equal(salesSettingsPatchSchema.safeParse({ whatsapp_number: "12" }).success, false);
  assert.equal(salesSettingsPatchSchema.safeParse({ condo_name: "A" }).success, false);
  assert.equal(salesSettingsPatchSchema.safeParse({ otra: "x" }).success, false);
  assert.equal(salesSettingsPatchSchema.safeParse({ condo_address: "x".repeat(201) }).success, false);
});

test("residencyInputSchema acota la unidad a 60 caracteres", () => {
  assert.equal(residencyInputSchema.safeParse({ declared: true, unit: "Torre B, depto 1203" }).success, true);
  assert.equal(residencyInputSchema.safeParse({ declared: true, unit: "x".repeat(61) }).success, false);
  assert.equal(residencyInputSchema.safeParse({ declared: "si", unit: "1" }).success, false);
  assert.equal(residencyInputSchema.safeParse({ declared: true, unit: "1", extra: 1 }).success, false);
});

test("evaluateResidency: en modo solo residentes exige declaración y unidad", () => {
  assert.equal(evaluateResidency(residentsOnly, undefined).allowed, false);
  assert.equal(evaluateResidency(residentsOnly, { declared: false, unit: "1203" }).allowed, false);
  assert.equal(evaluateResidency(residentsOnly, { declared: true, unit: "   " }).allowed, false);
  assert.equal(evaluateResidency(residentsOnly, { declared: true }).allowed, false);
  assert.deepEqual(evaluateResidency(residentsOnly, { declared: true, unit: " Torre B 1203 " }), {
    allowed: true,
    residency: { unit: "Torre B 1203" },
  });
});

test("evaluateResidency: en modo abierto la declaración es opcional", () => {
  assert.deepEqual(evaluateResidency(open, undefined), { allowed: true, residency: null });
  assert.deepEqual(evaluateResidency(open, { declared: true, unit: "Depto 5" }), {
    allowed: true,
    residency: { unit: "Depto 5" },
  });
  assert.deepEqual(evaluateResidency(open, { declared: false, unit: "Depto 5" }), { allowed: true, residency: null });
});

test("residentsOnlyErrorBody nombra el condominio e invita a coordinar por WhatsApp", () => {
  const body = residentsOnlyErrorBody(residentsOnly);
  assert.equal(body.ok, false);
  assert.equal(body.code, "RESIDENTS_ONLY");
  assert.match(body.error, /Condominio Vicuña Mackenna 2585/);
  assert.match(body.error, /WhatsApp/);
  assert.equal(body.whatsapp_number, residentsOnly.whatsapp_number);
});

test("resolveWebDelivery: en modo residentes entrega en el condominio sin costo", () => {
  assert.deepEqual(resolveWebDelivery(residentsOnly, { residencyUnit: "Depto 1203", customerAddress: "Otra calle 1" }), {
    delivery_method: "DELIVERY",
    delivery_fee_clp: 0,
    delivery_address: "Vicuña Mackenna 2585, Depto 1203",
  });
});

test("resolveWebDelivery: en modo abierto conserva el despacho con la dirección del cliente", () => {
  assert.deepEqual(resolveWebDelivery(open, { residencyUnit: null, customerAddress: "  Calle 1  " }), {
    delivery_method: "DELIVERY",
    delivery_fee_clp: 0,
    delivery_address: "Calle 1",
  });
  assert.equal(resolveWebDelivery(open, { residencyUnit: null, customerAddress: "" }).delivery_address, null);
});

test("toPublicSalesSettings solo expone datos no sensibles", () => {
  assert.deepEqual(toPublicSalesSettings({ ...residentsOnly, secreto: "x" }), {
    sales_mode: "RESIDENTS_ONLY",
    residents_only: true,
    condo_name: residentsOnly.condo_name,
    condo_address: residentsOnly.condo_address,
    whatsapp_number: residentsOnly.whatsapp_number,
  });
  assert.equal(toPublicSalesSettings(open).residents_only, false);
});
