<template>
  <div>
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Gestión de Usuarios</h1>
        <p class="mt-1 text-warm-500">Administra usuarios y sus permisos</p>
      </div>
      <button
        v-if="canManageUsers"
        @click="showCreateModal = true"
        class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span>Crear Usuario</span>
      </button>
    </div>

    <div v-if="!canManageUsers" class="rounded-2xl bg-warning-50 border border-warning-100 p-6">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-warning-100 flex items-center justify-center">
          <svg class="h-5 w-5 text-warning-600" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold text-warning-800">Acceso Restringido</h3>
          <p class="mt-1 text-warning-700">Solo el administrador principal puede gestionar usuarios.</p>
        </div>
      </div>
    </div>

    <div v-else class="bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
      <div v-if="loading" class="flex flex-col items-center justify-center py-16">
        <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
        <p class="mt-4 text-warm-500">Cargando usuarios...</p>
      </div>

      <div v-else-if="error" class="rounded-2xl bg-error-50 border border-error-100 p-6 m-6">
        <div class="flex items-center gap-3">
          <span class="text-error-500 text-xl">⚠️</span>
          <p class="text-error-700">{{ error }}</p>
        </div>
      </div>

      <div v-else-if="users.length === 0" class="text-center py-16">
        <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-4xl">👤</span>
        </div>
        <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay usuarios</h3>
        <p class="text-warm-500 mb-6">Aún no hay usuarios registrados en el sistema</p>
        <button
          @click="showCreateModal = true"
          class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Crear Usuario</span>
        </button>
      </div>

      <!-- Desktop Table -->
      <div v-if="!loading && !error && users.length > 0" class="hidden sm:block">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Usuario</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Rol</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Permisos</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-warm-100">
            <tr v-for="user in users" :key="user.id" class="hover:bg-warm-50/50 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg font-semibold text-primary-600">
                    {{ (user.full_name || user.email).charAt(0).toUpperCase() }}
                  </div>
                  <div>
                    <div class="text-sm font-medium text-warm-800">{{ user.full_name || 'Sin nombre' }}</div>
                    <div class="text-sm text-warm-400">{{ user.email }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3">
                <span 
                  class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                  :class="{
                    'bg-primary-100 text-primary-700': user.role === 'SUPERADMIN',
                    'bg-info-100 text-info-700': user.role === 'ADMIN',
                    'bg-success-100 text-success-700': user.role === 'STAFF'
                  }"
                >
                  {{ formatRole(user.role) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span 
                  class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                  :class="user.is_active ? 'bg-success-100 text-success-700' : 'bg-warm-100 text-warm-600'"
                >
                  {{ user.is_active ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap gap-1">
                  <span v-if="user.can_view" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warm-100 text-warm-600">Ver</span>
                  <span v-if="user.can_create" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-success-100 text-success-600">Crear</span>
                  <span v-if="user.can_edit" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning-100 text-warning-600">Editar</span>
                  <span v-if="user.can_delete" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-error-100 text-error-600">Eliminar</span>
                </div>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                  @click="openEditModal(user)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  Editar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div v-if="!loading && !error && users.length > 0" class="sm:hidden space-y-3 p-4">
        <div v-for="user in users" :key="user.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-xl font-semibold text-primary-600 flex-shrink-0">
              {{ (user.full_name || user.email).charAt(0).toUpperCase() }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="font-semibold text-warm-800">{{ user.full_name || 'Sin nombre' }}</h3>
                  <p class="text-sm text-warm-400">{{ user.email }}</p>
                </div>
                <span 
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                  :class="{
                    'bg-primary-100 text-primary-700': user.role === 'SUPERADMIN',
                    'bg-info-100 text-info-700': user.role === 'ADMIN',
                    'bg-success-100 text-success-700': user.role === 'STAFF'
                  }"
                >
                  {{ formatRole(user.role) }}
                </span>
              </div>
              <div class="flex flex-wrap gap-1 mt-2">
                <span v-if="user.can_view" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warm-100 text-warm-600">Ver</span>
                <span v-if="user.can_create" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-success-100 text-success-600">Crear</span>
                <span v-if="user.can_edit" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning-100 text-warning-600">Editar</span>
                <span v-if="user.can_delete" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-error-100 text-error-600">Eliminar</span>
              </div>
              <div class="flex items-center gap-2 mt-3 pt-3 border-t border-warm-100">
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                  @click="openEditModal(user)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  Editar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create User Modal -->
    <Modal
      v-model="showCreateModal"
      title="Crear Usuario"
      :loading="saving"
      @submit="createUser"
    >
      <UserForm ref="createFormRef" @submit="handleCreateSubmit" />
    </Modal>

    <!-- Edit User Modal -->
    <Modal
      v-model="showEditModal"
      title="Editar Usuario"
      :loading="saving"
      @submit="updateUser"
    >
      <UserForm ref="editFormRef" :user="selectedUser" @submit="handleEditSubmit" />
    </Modal>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Gestión de Usuarios | Dulce María'
})

const api = useApi()

interface User {
  id: string
  email: string
  full_name?: string
  role: string
  is_active: boolean
  can_view?: boolean
  can_create?: boolean
  can_edit?: boolean
  can_delete?: boolean
  permissions?: any
  created_at: string
}

const users = ref<User[]>([])
const loading = ref(true)
const error = ref('')
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteDialog = ref(false)
const saving = ref(false)
const deleting = ref(false)
const createFormRef = ref<any>(null)
const editFormRef = ref<any>(null)
const selectedUser = ref<User | null>(null)
const userToDelete = ref<User | null>(null)
const currentUserEmail = ref('')

const canManageUsers = computed(() => {
  return currentUserEmail.value === 'hernan.castellanos@hrcastell.com'
})

const formatRole = (role: string) => {
  const roleMap: Record<string, string> = {
    'SUPERADMIN': 'Super Admin',
    'ADMIN': 'Administrador',
    'STAFF': 'Staff'
  }
  return roleMap[role] || role
}

const loadUsers = async () => {
  try {
    loading.value = true
    error.value = ''
    const response = await api.get<{ ok: boolean; items: User[] }>('/admin/users')
    if (response.ok) {
      users.value = response.items
    }
  } catch (e: any) {
    console.error('Error loading users:', e)
    error.value = e?.data?.error || 'Error al cargar usuarios'
  } finally {
    loading.value = false
  }
}

const getCurrentUser = () => {
  try {
    const token = localStorage.getItem('auth_token')
    if (!token) return
    const payload = JSON.parse(atob(token.split('.')[1]))
    currentUserEmail.value = payload.email || ''
  } catch (e: any) {
    console.error('Error getting current user from token:', e)
  }
}

const createUser = () => {
  createFormRef.value?.submit()
}

const handleCreateSubmit = async (data: any) => {
  try {
    saving.value = true
    error.value = ''
    const response = await api.post<{ ok: boolean; user: User }>('/admin/users', data)
    if (response.ok && response.user) {
      await loadUsers()
      showCreateModal.value = false
    }
  } catch (e: any) {
    console.error('Error creating user:', e)
    error.value = e?.data?.error || 'Error al crear usuario'
  } finally {
    saving.value = false
  }
}

const openEditModal = (user: User) => {
  selectedUser.value = user
  showEditModal.value = true
}

const updateUser = () => {
  editFormRef.value?.submit()
}

const handleEditSubmit = async (data: any) => {
  if (!selectedUser.value) return
  try {
    saving.value = true
    error.value = ''
    const response = await api.patch<{ ok: boolean; user: User }>(
      `/admin/users/${selectedUser.value.id}`,
      data
    )
    if (response.ok) {
      await loadUsers()
      showEditModal.value = false
      selectedUser.value = null
    }
  } catch (e: any) {
    console.error('Error updating user:', e)
    error.value = e?.data?.error || 'Error al actualizar usuario'
  } finally {
    saving.value = false
  }
}

const openDeleteDialog = (user: User) => {
  userToDelete.value = user
  showDeleteDialog.value = true
}

const handleDeleteUser = async () => {
  if (!userToDelete.value) return
  try {
    deleting.value = true
    error.value = ''
    await api.delete(`/admin/users/${userToDelete.value.id}`)
    users.value = users.value.filter(u => u.id !== userToDelete.value?.id)
    showDeleteDialog.value = false
    userToDelete.value = null
  } catch (e: any) {
    console.error('Error deleting user:', e)
    error.value = e?.data?.error || 'Error al eliminar usuario'
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  getCurrentUser()
  if (canManageUsers.value) {
    await loadUsers()
  } else {
    loading.value = false
  }
})
</script>
