/**
 * Matriz de permisos por usuario (users.permissions), aplicada en el servidor
 * con requirePermission(resource, action) en productos, clientes y órdenes.
 *
 * Reglas:
 *   - SUPERADMIN pasa siempre.
 *   - El ROL es el techo: una bandera nunca da más de lo que el rol puede
 *     hacer hoy (ROLE_DEFAULT_PERMISSIONS refleja los requireRole actuales).
 *   - Bandera ausente (o no booleana) = lo que el rol puede hacer hoy.
 *   - Bandera en false = denegado.
 *   - Las banderas solo rigen desde que la matriz del usuario se guarda con
 *     esta versión (users.permissions_configured_at). Antes nunca se
 *     aplicaron y el panel las creaba con casillas desmarcadas por defecto:
 *     aplicarlas tal cual al desplegar quitaría acceso diario (p. ej. a STAFF
 *     cambiar estados). Así nadie pierde acceso al desplegar y lo que se guarde
 *     en adelante se cumple.
 */

const PERMISSION_RESOURCES = Object.freeze({
  products: Object.freeze(["canView", "canCreate", "canEdit", "canDelete"]),
  customers: Object.freeze(["canView", "canCreate", "canEdit", "canDelete"]),
  orders: Object.freeze(["canView", "canCreate", "canEdit", "canDelete", "canUpdateStatus"]),
});

const ASSIGNABLE_ROLES = Object.freeze(["ADMIN", "STAFF"]);
const ALL_ROLES = Object.freeze(["SUPERADMIN", "ADMIN", "STAFF"]);

function matrix(fill) {
  const result = {};
  for (const [resource, actions] of Object.entries(PERMISSION_RESOURCES)) {
    result[resource] = {};
    for (const action of actions) result[resource][action] = fill(resource, action);
  }
  return result;
}

// Lo que cada rol puede hacer HOY según los requireRole de las rutas.
// orders.canDelete: no existe endpoint para borrar órdenes (queda en false).
const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  ADMIN: matrix((resource, action) => !(resource === "orders" && action === "canDelete")),
  STAFF: matrix((resource, action) => {
    if (resource === "products") return action === "canView";
    if (resource === "customers") return action !== "canDelete";
    return ["canView", "canCreate", "canUpdateStatus"].includes(action);
  }),
});

function isConfigured(user) {
  const value = user?.permissions_configured_at ?? user?.permissionsConfiguredAt;
  return value !== null && value !== undefined && value !== false;
}

/** Matriz efectiva (completa, solo booleanos) de un usuario. */
function resolveEffectivePermissions(user) {
  const role = user?.role;
  if (role === "SUPERADMIN") return matrix(() => true);
  const base = ROLE_DEFAULT_PERMISSIONS[role];
  if (!base) return matrix(() => false);
  if (!isConfigured(user)) return matrix((resource, action) => base[resource][action]);
  const stored = user?.permissions && typeof user.permissions === "object" ? user.permissions : {};
  return matrix((resource, action) => {
    const flag = stored?.[resource]?.[action];
    return base[resource][action] && flag !== false;
  });
}

function hasPermission(user, resource, action) {
  if (!user || !PERMISSION_RESOURCES[resource] || !PERMISSION_RESOURCES[resource].includes(action)) return false;
  return resolveEffectivePermissions(user)[resource][action] === true;
}

/** Banderas planas que muestra la pantalla de usuarios (alguna sección lo permite). */
function summarizePermissions(effective) {
  const any = (action) => Object.values(effective || {}).some((section) => section?.[action] === true);
  return {
    can_view: any("canView"),
    can_create: any("canCreate"),
    can_edit: any("canEdit"),
    can_delete: any("canDelete"),
  };
}

/**
 * Cambio de rol pedido en PATCH /admin/users/:id. Reenviar el rol actual
 * (incluido SUPERADMIN, que el formulario manda tal cual) no es un cambio;
 * nadie puede ser ascendido a SUPERADMIN desde la API.
 */
function decideRoleUpdate({ currentRole, requestedRole }) {
  if (requestedRole === undefined || requestedRole === null || requestedRole === currentRole) {
    return { ok: true, change: false };
  }
  if (!ALL_ROLES.includes(requestedRole)) {
    return { ok: false, status: 400, code: "INVALID_ROLE", error: "Rol inválido." };
  }
  if (!ASSIGNABLE_ROLES.includes(requestedRole)) {
    return {
      ok: false,
      status: 403,
      code: "ROLE_NOT_ASSIGNABLE",
      error: "El rol SUPERADMIN no se puede asignar desde el panel.",
    };
  }
  return { ok: true, change: true, role: requestedRole };
}

module.exports = {
  PERMISSION_RESOURCES,
  ROLE_DEFAULT_PERMISSIONS,
  ASSIGNABLE_ROLES,
  resolveEffectivePermissions,
  hasPermission,
  summarizePermissions,
  decideRoleUpdate,
};
