<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-md bg-red-50 p-4">
      <p class="text-sm text-red-800">{{ error }}</p>
    </div>

    <div>
      <label class="label">Email *</label>
      <input
        v-model="form.email"
        type="email"
        required
        :disabled="!!user"
        class="input"
        :class="{ 'bg-gray-100': !!user }"
        placeholder="usuario@ejemplo.com"
      >
      <p v-if="!!user" class="text-xs text-gray-500 mt-1">El email no se puede modificar</p>
    </div>

    <div>
      <label class="label">Nombre Completo</label>
      <input
        v-model="form.fullName"
        type="text"
        class="input"
        placeholder="Juan Pérez"
      >
    </div>

    <div v-if="!user">
      <label class="label">Contraseña *</label>
      <input
        v-model="form.password"
        type="password"
        required
        minlength="8"
        class="input"
        placeholder="Mínimo 8 caracteres"
      >
    </div>

    <div v-else>
      <label class="label">Nueva Contraseña (opcional)</label>
      <input
        v-model="form.password"
        type="password"
        minlength="8"
        class="input"
        placeholder="Dejar vacío para mantener la actual"
      >
      <p class="text-xs text-gray-500 mt-1">Solo completa si deseas cambiar la contraseña</p>
    </div>

    <div>
      <label class="label">Rol *</label>
      <select v-model="form.role" required class="input">
        <option value="STAFF">STAFF - Personal de ventas</option>
        <option value="ADMIN">ADMIN - Administrador</option>
      </select>
    </div>

    <div>
      <label class="flex items-center">
        <input
          v-model="form.isActive"
          type="checkbox"
          class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        >
        <span class="ml-2 text-sm text-gray-700">Usuario activo</span>
      </label>
    </div>

    <div class="border-t pt-4">
      <h3 class="text-lg font-medium text-gray-900 mb-3">Permisos</h3>
      <p class="text-sm text-gray-500 mb-4">Configura qué acciones puede realizar este usuario</p>

      <div class="space-y-4">
        <!-- Permisos de Productos -->
        <div class="bg-gray-50 rounded-lg p-4">
          <h4 class="font-medium text-gray-900 mb-2">🍰 Productos</h4>
          <div class="space-y-2">
            <label class="flex items-center">
              <input
                v-model="form.permissions.products.canView"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Ver productos</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.products.canCreate"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Crear productos</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.products.canEdit"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Editar productos</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.products.canDelete"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Eliminar productos</span>
            </label>
          </div>
        </div>

        <!-- Permisos de Clientes -->
        <div class="bg-gray-50 rounded-lg p-4">
          <h4 class="font-medium text-gray-900 mb-2">👥 Clientes</h4>
          <div class="space-y-2">
            <label class="flex items-center">
              <input
                v-model="form.permissions.customers.canView"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Ver clientes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.customers.canCreate"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Crear clientes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.customers.canEdit"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Editar clientes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.customers.canDelete"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Eliminar clientes</span>
            </label>
          </div>
        </div>

        <!-- Permisos de Órdenes -->
        <div class="bg-gray-50 rounded-lg p-4">
          <h4 class="font-medium text-gray-900 mb-2">📦 Órdenes</h4>
          <div class="space-y-2">
            <label class="flex items-center">
              <input
                v-model="form.permissions.orders.canView"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Ver órdenes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.orders.canCreate"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Crear órdenes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.orders.canEdit"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Editar órdenes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.orders.canUpdateStatus"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Actualizar estado de órdenes</span>
            </label>
            <label class="flex items-center">
              <input
                v-model="form.permissions.orders.canDelete"
                type="checkbox"
                class="rounded border-gray-300 text-primary-600"
              >
              <span class="ml-2 text-sm">Cancelar órdenes</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  user?: any
}>()

const emit = defineEmits<{
  submit: [data: any]
}>()

const form = ref({
  email: props.user?.email || '',
  fullName: props.user?.full_name || '',
  password: '',
  role: props.user?.role || 'STAFF',
  isActive: props.user?.is_active ?? true,
  permissions: {
    products: {
      canView: props.user?.permissions?.products?.canView ?? true,
      canCreate: props.user?.permissions?.products?.canCreate ?? false,
      canEdit: props.user?.permissions?.products?.canEdit ?? false,
      canDelete: props.user?.permissions?.products?.canDelete ?? false
    },
    customers: {
      canView: props.user?.permissions?.customers?.canView ?? true,
      canCreate: props.user?.permissions?.customers?.canCreate ?? false,
      canEdit: props.user?.permissions?.customers?.canEdit ?? false,
      canDelete: props.user?.permissions?.customers?.canDelete ?? false
    },
    orders: {
      canView: props.user?.permissions?.orders?.canView ?? true,
      canCreate: props.user?.permissions?.orders?.canCreate ?? true,
      canEdit: props.user?.permissions?.orders?.canEdit ?? false,
      canUpdateStatus: props.user?.permissions?.orders?.canUpdateStatus ?? false,
      canDelete: props.user?.permissions?.orders?.canDelete ?? false
    }
  }
})

const error = ref('')

const validate = () => {
  if (!form.value.email.trim()) {
    error.value = 'El email es requerido'
    return false
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(form.value.email)) {
    error.value = 'El email no es válido'
    return false
  }

  if (!props.user && !form.value.password) {
    error.value = 'La contraseña es requerida'
    return false
  }

  if (form.value.password && form.value.password.length < 8) {
    error.value = 'La contraseña debe tener al menos 8 caracteres'
    return false
  }

  error.value = ''
  return true
}

const submit = () => {
  if (validate()) {
    const data: any = {
      email: form.value.email,
      role: form.value.role,
      isActive: form.value.isActive,
      permissions: form.value.permissions
    }

    if (form.value.fullName) {
      data.fullName = form.value.fullName
    }

    if (form.value.password) {
      data.password = form.value.password
    }

    emit('submit', data)
  }
}

defineExpose({ submit })
</script>
