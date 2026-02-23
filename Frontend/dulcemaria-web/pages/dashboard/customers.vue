<template>
  <div>
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Clientes</h1>
        <p class="mt-1 text-warm-500">Gestiona tu base de clientes</p>
      </div>
      <button
        @click="openCreateModal"
        class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft hover:shadow-md"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span>Nuevo Cliente</span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex flex-col items-center justify-center py-16">
      <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      <p class="mt-4 text-warm-500">Cargando clientes...</p>
    </div>

    <div v-else-if="error" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-error-500 text-xl">⚠️</span>
        <p class="text-error-700">{{ error }}</p>
      </div>
    </div>

    <div v-else>
      <!-- Search Bar -->
      <div class="mb-6">
        <div class="relative max-w-md">
          <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg class="h-5 w-5 text-warm-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Buscar clientes..."
            class="block w-full pl-11 pr-4 py-3 border border-warm-200 rounded-xl text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
            @input="handleSearch"
          >
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="filteredCustomers.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
        <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-4xl">👥</span>
        </div>
        <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay clientes</h3>
        <p class="text-warm-500 mb-6">{{ searchQuery ? 'No se encontraron resultados para tu búsqueda' : 'Aún no tienes clientes registrados' }}</p>
        <button
          v-if="!searchQuery"
          @click="openCreateModal"
          class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Agregar Cliente</span>
        </button>
      </div>

      <div v-else class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Nombre</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Email</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Teléfono</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Dirección</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-warm-100">
            <tr v-for="customer in filteredCustomers" :key="customer.id" class="hover:bg-warm-50/50 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg">
                    {{ customer.full_name?.charAt(0).toUpperCase() || '?' }}
                  </div>
                  <div class="text-sm font-medium text-warm-800">{{ customer.full_name }}</div>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-warm-600">{{ customer.email || '-' }}</td>
              <td class="px-4 py-3 text-sm text-warm-600">{{ customer.phone || '-' }}</td>
              <td class="px-4 py-3 text-sm text-warm-600 max-w-xs truncate">{{ customer.address || '-' }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 mr-3 transition-colors"
                  @click="openEditModal(customer)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  Editar
                </button>
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-error-600 hover:text-error-700 transition-colors"
                  @click="openDeleteDialog(customer)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                  Eliminar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div v-if="filteredCustomers.length > 0" class="sm:hidden space-y-3">
        <div v-for="customer in filteredCustomers" :key="customer.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-xl flex-shrink-0">
              {{ customer.full_name?.charAt(0).toUpperCase() || '?' }}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-warm-800">{{ customer.full_name }}</h3>
              <p v-if="customer.email" class="text-sm text-warm-500 mt-0.5">{{ customer.email }}</p>
              <p v-if="customer.phone" class="text-sm text-warm-500">{{ customer.phone }}</p>
              <p v-if="customer.address" class="text-sm text-warm-400 mt-1 truncate">{{ customer.address }}</p>
              <div class="flex items-center gap-2 mt-3 pt-3 border-t border-warm-100">
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                  @click="openEditModal(customer)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  Editar
                </button>
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-error-600 bg-error-50 hover:bg-error-100 rounded-lg transition-colors"
                  @click="openDeleteDialog(customer)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Results Count -->
      <p v-if="filteredCustomers.length > 0" class="mt-4 text-sm text-warm-500">
        Mostrando <span class="font-medium text-warm-700">{{ filteredCustomers.length }}</span> de {{ customers.length }} clientes
      </p>
    </div>

    <!-- Create Customer Modal -->
    <Modal
      v-model="showCreateModal"
      title="Nuevo Cliente"
      :loading="saving"
      @submit="handleCreateCustomer"
    >
      <CustomerForm 
        ref="customerFormRef" 
        :existing-customers="customers"
        @submit="handleSubmitCustomer" 
      />
    </Modal>

    <!-- Edit Customer Modal -->
    <Modal
      v-model="showEditModal"
      title="Editar Cliente"
      :loading="saving"
      @submit="handleEditCustomer"
    >
      <CustomerForm 
        ref="editFormRef" 
        :customer="selectedCustomer" 
        :existing-customers="customers"
        @submit="handleUpdateCustomer" 
      />
    </Modal>

    <!-- Delete Confirmation -->
    <ConfirmDialog
      v-model="showDeleteDialog"
      title="Eliminar Cliente"
      :message="`¿Estás seguro de que deseas eliminar a ${customerToDelete?.full_name}? Esta acción no se puede deshacer.`"
      :loading="deleting"
      @confirm="handleDeleteCustomer"
    />
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Clientes | Dulce María'
})

const api = useApi()

interface Customer {
  id: string
  full_name: string
  email?: string
  phone?: string
  address?: string
}

const customers = ref<Customer[]>([])
const loading = ref(true)
const error = ref('')
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteDialog = ref(false)
const saving = ref(false)
const deleting = ref(false)
const customerFormRef = ref<any>(null)
const editFormRef = ref<any>(null)
const selectedCustomer = ref<Customer | null>(null)
const customerToDelete = ref<Customer | null>(null)
const searchQuery = ref('')

const filteredCustomers = computed(() => {
  if (!searchQuery.value) return customers.value
  const query = searchQuery.value.toLowerCase()
  return customers.value.filter(c =>
    c.full_name.toLowerCase().includes(query) ||
    (c.email?.toLowerCase().includes(query) ?? false) ||
    (c.phone?.includes(query) ?? false)
  )
})

const loadCustomers = async () => {
  try {
    loading.value = true
    error.value = ''

    const response = await api.get<{ ok: boolean; items: Customer[] }>('/admin/customers')

    if (response.ok && response.items) {
      customers.value = response.items
    }
  } catch (e: any) {
    console.error('Error loading customers:', e)
    error.value = e?.data?.error || 'Error al cargar los clientes'
  } finally {
    loading.value = false
  }
}

const openCreateModal = () => {
  showCreateModal.value = true
}

const handleCreateCustomer = () => {
  customerFormRef.value?.submit()
}

const handleSubmitCustomer = async (data: any) => {
  try {
    saving.value = true
    error.value = ''

    const response = await api.post<{ ok: boolean; customer: Customer }>('/admin/customers', data)

    if (response.ok && response.customer) {
      customers.value.unshift(response.customer)
      showCreateModal.value = false
    }
  } catch (e: any) {
    console.error('Error creating customer:', e)
    error.value = e?.data?.error || 'Error al crear el cliente'
  } finally {
    saving.value = false
  }
}

const openEditModal = (customer: Customer) => {
  selectedCustomer.value = customer
  showEditModal.value = true
}

const handleEditCustomer = () => {
  editFormRef.value?.submit()
}

const handleUpdateCustomer = async (data: any) => {
  if (!selectedCustomer.value) return

  try {
    saving.value = true
    error.value = ''

    const response = await api.patch<{ ok: boolean; customer: Customer }>(
      `/admin/customers/${selectedCustomer.value.id}`,
      data
    )

    if (response.ok && response.customer) {
      const index = customers.value.findIndex(c => c.id === response.customer.id)
      if (index !== -1) {
        customers.value[index] = response.customer
      }
      showEditModal.value = false
      selectedCustomer.value = null
    }
  } catch (e: any) {
    console.error('Error updating customer:', e)
    error.value = e?.data?.error || 'Error al actualizar el cliente'
  } finally {
    saving.value = false
  }
}

const openDeleteDialog = (customer: Customer) => {
  customerToDelete.value = customer
  showDeleteDialog.value = true
}

const handleDeleteCustomer = async () => {
  if (!customerToDelete.value) return

  try {
    deleting.value = true
    error.value = ''

    await api.delete(`/admin/customers/${customerToDelete.value.id}`)

    customers.value = customers.value.filter(c => c.id !== customerToDelete.value?.id)
    showDeleteDialog.value = false
    customerToDelete.value = null
  } catch (e: any) {
    console.error('Error deleting customer:', e)
    error.value = e?.data?.error || 'Error al eliminar el cliente'
  } finally {
    deleting.value = false
  }
}

let searchTimeout: any = null
const handleSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    // La búsqueda se maneja automáticamente por el computed
  }, 300)
}

onMounted(() => {
  loadCustomers()
})
</script>
