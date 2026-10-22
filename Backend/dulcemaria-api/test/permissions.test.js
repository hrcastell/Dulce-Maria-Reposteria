const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PERMISSION_RESOURCES,
  ROLE_DEFAULT_PERMISSIONS,
  resolveEffectivePermissions,
  hasPermission,
  summarizePermissions,
  decideRoleUpdate,
} = require("../src/lib/permissions");

const allFalse = {
  products: { canView: false, canCreate: false, canEdit: false, canDelete: false },
  customers: { canView: false, canCreate: false, canEdit: false, canDelete: false },
  orders: { canView: false, canCreate: false, canEdit: false, canDelete: false, canUpdateStatus: false },
};

test("la matriz cubre productos, clientes y órdenes", () => {
  assert.deepEqual(Object.keys(PERMISSION_RESOURCES), ["products", "customers", "orders"]);
  assert.ok(PERMISSION_RESOURCES.orders.includes("canUpdateStatus"));
});

test("los permisos por defecto reflejan lo que cada rol puede hacer hoy", () => {
  const staff = ROLE_DEFAULT_PERMISSIONS.STAFF;
  assert.deepEqual(staff.products, { canView: true, canCreate: false, canEdit: false, canDelete: false });
  assert.deepEqual(staff.customers, { canView: true, canCreate: true, canEdit: true, canDelete: false });
  assert.equal(staff.orders.canCreate, true);
  assert.equal(staff.orders.canUpdateStatus, true);
  assert.equal(staff.orders.canEdit, false);
  const admin = ROLE_DEFAULT_PERMISSIONS.ADMIN;
  assert.equal(admin.products.canDelete, true);
  assert.equal(admin.customers.canDelete, true);
  assert.equal(admin.orders.canEdit, true);
});

test("SUPERADMIN pasa siempre, aunque tenga banderas en falso", () => {
  const user = { role: "SUPERADMIN", permissions: allFalse, permissions_configured_at: new Date() };
  assert.equal(hasPermission(user, "products", "canDelete"), true);
  assert.equal(hasPermission(user, "orders", "canUpdateStatus"), true);
});

test("sin configuración confirmada se ignoran las banderas antiguas: nadie pierde acceso al desplegar", () => {
  const legacyStaff = { role: "STAFF", permissions: allFalse, permissions_configured_at: null };
  assert.equal(hasPermission(legacyStaff, "customers", "canCreate"), true);
  assert.equal(hasPermission(legacyStaff, "orders", "canUpdateStatus"), true);
  assert.equal(hasPermission(legacyStaff, "products", "canCreate"), false);
});

test("con configuración confirmada: falso niega, ausente = rol, verdadero no supera al rol", () => {
  const staff = {
    role: "STAFF",
    permissions_configured_at: new Date(),
    permissions: { orders: { canUpdateStatus: false }, products: { canDelete: true } },
  };
  assert.equal(hasPermission(staff, "orders", "canUpdateStatus"), false);
  assert.equal(hasPermission(staff, "orders", "canCreate"), true);
  assert.equal(hasPermission(staff, "customers", "canEdit"), true);
  assert.equal(hasPermission(staff, "products", "canDelete"), false);
});

test("valores que no son booleanos se tratan como ausentes", () => {
  const admin = {
    role: "ADMIN",
    permissions_configured_at: new Date(),
    permissions: { products: { canDelete: "false", canEdit: 0 } },
  };
  assert.equal(hasPermission(admin, "products", "canDelete"), true);
  assert.equal(hasPermission(admin, "products", "canEdit"), true);
});

test("rol desconocido o acción inexistente: denegado", () => {
  assert.equal(hasPermission({ role: "GOD", permissions: {} }, "products", "canView"), false);
  assert.equal(hasPermission({ role: "ADMIN", permissions: {} }, "products", "canFly"), false);
  assert.equal(hasPermission({ role: "ADMIN", permissions: {} }, "recetas", "canView"), false);
  assert.equal(hasPermission(null, "products", "canView"), false);
});

test("resolveEffectivePermissions devuelve la matriz completa de booleanos", () => {
  const matrix = resolveEffectivePermissions({ role: "STAFF", permissions: null });
  for (const [resource, actions] of Object.entries(PERMISSION_RESOURCES)) {
    for (const action of actions) assert.equal(typeof matrix[resource][action], "boolean", `${resource}.${action}`);
  }
});

test("summarizePermissions resume la matriz en las banderas que lee la pantalla de usuarios", () => {
  assert.deepEqual(summarizePermissions(ROLE_DEFAULT_PERMISSIONS.STAFF), {
    can_view: true,
    can_create: true,
    can_edit: true,
    can_delete: false,
  });
  assert.deepEqual(summarizePermissions(allFalse), {
    can_view: false,
    can_create: false,
    can_edit: false,
    can_delete: false,
  });
});

test("decideRoleUpdate: reenviar el mismo rol (incluido SUPERADMIN) no es un cambio", () => {
  assert.deepEqual(decideRoleUpdate({ currentRole: "SUPERADMIN", requestedRole: "SUPERADMIN" }), { ok: true, change: false });
  assert.deepEqual(decideRoleUpdate({ currentRole: "STAFF", requestedRole: undefined }), { ok: true, change: false });
  assert.deepEqual(decideRoleUpdate({ currentRole: "STAFF", requestedRole: "ADMIN" }), { ok: true, change: true, role: "ADMIN" });
});

test("decideRoleUpdate: nadie puede ser ascendido a SUPERADMIN desde la API", () => {
  const result = decideRoleUpdate({ currentRole: "ADMIN", requestedRole: "SUPERADMIN" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.code, "ROLE_NOT_ASSIGNABLE");
});

test("decideRoleUpdate: roles inválidos se rechazan", () => {
  assert.equal(decideRoleUpdate({ currentRole: "STAFF", requestedRole: "GOD" }).ok, false);
});
