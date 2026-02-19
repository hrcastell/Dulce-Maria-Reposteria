<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-900">Gestión de Usuarios</h1>
            <p class="text-sm text-gray-500 mt-1">Administra usuarios y sus permisos</p>
          </div>
          <button
            v-if="canManageUsers"
            class="btn-primary"
            @click="showCreateModal = true"
          >
            + Crear Usuario
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div v-if="!canManageUsers" class="rounded-md bg-yellow-50 p-4">
        <div class="flex">
          <div class="flex-shrink-0">
            <svg class="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </div>
          <div class="ml-3">
            <h3 class="text-sm font-medium text-yellow-800">Acceso Restringido</h3>
            <div class="mt-2 text-sm text-yellow-700">
              <p>Solo el administrador principal puede gestionar usuarios.</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="bg-white rounded-lg shadow">
        <div v-if="loading" class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          <p class="mt-4 text-gray-600">Cargando usuarios...</p>
        </div>

        <div v-else-if="error" class="rounded-md bg-red-50 p-4 m-6">
          <p class="text-sm text-red-800">{{ error }}</p>
        </div>

        <div v-else-if="users.length === 0" class="text-center py-12">
          <p class="text-gray-500">No hay usuarios registrados</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usuario</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permisos</th>
                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha Creación</th>
                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr v-for="user in users" :key="user.id">
                <td class="px-6 py-4 whitespace-nowrap">
                  <div class="flex items-center">
                    <div>
                      <div class="text-sm font-medium text-gray-900">{{ user.full_name || 'Sin nombre' }}</div>
                      <div class="text-sm text-gray-500">{{ user.email }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span 
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                    :class="{
                      'bg-purple-100 text-purple-800': user.role === 'SUPERADMIN',
                      'bg-blue-100 text-blue-800': user.role === 'ADMIN',
                      'bg-green-100 text-green-800': user.role === 'STAFF'
                    }"
                  >
                    {{ user.role }}
                  </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                  <span 
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                    :class="user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
                  >
                    {{ user.is_active ? 'Activo' : 'Inactivo' }}
                  </span>
                </td>
                <td class="px-6 py-4">
                  <div v-if="user.permissions" class="text-xs text-gray-600 space-y-1">
                    <div v-if="user.permissions.products">
                      <strong>Productos:</strong> 
                      <span v-if="user.permissions.products.canCreate">✅C</span>
                      <span v-if="user.permissions.products.canEdit">✏️E</span>
                      <span v-if="user.permissions.products.canDelete">🗑️D</span>
                    </div>
                    <div v-if="user.permissions.orders">
                      <strong>Órdenes:</strong> 
                      <span v-if="user.permissions.orders.canCreate">✅C</span>
                      <span v-if="user.permissions.orders.canUpdateStatus">📝S</span>
                    </div>
                  </div>
                  <span v-else class="text-xs text-gray-400">Sin permisos</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {{ formatDate(user.created_at) }}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button 
                    v-if="user.email !== 'hernan.castellanos@hrcastell.com'"
                    class="text-primary-600 hover:text-primary-900 mr-3"
                    @click="openEditModal(user)"
                  >
                    Editar
                  </button>
                  <button 
                    v-if="user.email !== 'hernan.castellanos@hrcastell.com'"
                    class="text-red-600 hover:text-red-900"
                    @click="openDeleteDialog(user)"
                  >
                    Eliminar
                  </button>
                  <span v-else class="text-gray-400 text-xs">Admin Principal</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- Create User Modal -->
    <Modal
      v-model="showCreateModal"
      title="Crear Nuevo Usuario"
      :loading="saving"
      @submit="handleCreateUser"
    >
      <UserForm ref="userFormRef" @submit="handleSubmitUser" />
    </Modal>

    <!-- Edit User Modal -->
    <Modal
      v-model="showEditModal"
      title="Editar Usuario"
      :loading="saving"
      @submit="handleEditUser"
    >
      <UserForm ref="editFormRef" :user="selectedUser" @submit="handleUpdateUser" />
    </Modal>

    <!-- Delete Confirmation -->
    <ConfirmDialog
      v-model="showDeleteDialog"
      title="Eliminar Usuario"
      :message="`¿Estás seguro de que deseas eliminar a ${userToDelete?.email}? Esta acción no se puede deshacer.`"
      :loading="deleting"
      @confirm="handleDeleteUser"
    />
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({
  middleware: 'auth'
})

interface User {
  id: string
  email: string
  full_name?: string
  role: string
  is_active: boolean
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
const userFormRef = ref<any>(null)
const editFormRef = ref<any>(null)
const selectedUser = ref<User | null>(null)
const userToDelete = ref<User | null>(null)
const currentUserEmail = ref('')

const canManageUsers = computed(() => {
  return currentUserEmail.value === 'hernan.castellanos@hrcastell.com'
})

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('es-CL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
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

const handleCreateUser = () => {
  userFormRef.value?.submit()
}

const handleSubmitUser = async (data: any) => {
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

const handleEditUser = () => {
  editFormRef.value?.submit()
}

const handleUpdateUser = async (data: any) => {
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
