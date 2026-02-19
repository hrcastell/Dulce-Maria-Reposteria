<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">Clientes</h1>
          <NuxtLink to="/dashboard" class="text-sm text-primary-600 hover:text-primary-500">
            ← Dashboard
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <div v-if="loading" class="text-center py-12">
          <p class="text-gray-500">Cargando clientes...</p>
        </div>

        <div v-else-if="error" class="rounded-md bg-red-50 p-4 mb-4">
          <p class="text-sm text-red-800">{{ error }}</p>
        </div>

        <div v-else>
          <div class="mb-4 flex justify-between items-center">
            <div class="flex-1 max-w-lg">
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Buscar clientes..."
                class="input"
                @input="handleSearch"
              >
            </div>
            <button class="btn-primary text-sm ml-4" @click="openCreateModal">
              + Nuevo Cliente
            </button>
          </div>

          <div v-if="customers.length === 0" class="text-center py-12">
            <p class="text-gray-500">No hay clientes registrados</p>
          </div>

          <div v-else class="bg-white shadow overflow-hidden sm:rounded-lg">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Teléfono
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Dirección
                  </th>
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr v-for="customer in customers" :key="customer.id">
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">{{ customer.full_name }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">{{ customer.email || '-' }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">{{ customer.phone || '-' }}</div>
                  </td>
                  <td class="px-6 py-4">
                    <div class="text-sm text-gray-900 truncate max-w-xs">{{ customer.address || '-' }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      class="text-primary-600 hover:text-primary-900 mr-3"
                      @click="openEditModal(customer)"
                    >
                      Editar
                    </button>
                    <button 
                      class="text-red-600 hover:text-red-900"
                      @click="openDeleteDialog(customer)"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="customers.length > 0" class="mt-4 text-sm text-gray-600">
            Total: {{ customers.length }} clientes
          </div>
        </div>
      </div>
    </main>

    <!-- Create Customer Modal -->
    <Modal
      v-model="showCreateModal"
      title="Nuevo Cliente"
      :loading="saving"
      @submit="handleCreateCustomer"
    >
      <CustomerForm ref="customerFormRef" @submit="handleSubmitCustomer" />
    </Modal>

    <!-- Edit Customer Modal -->
    <Modal
      v-model="showEditModal"
      title="Editar Cliente"
      :loading="saving"
      @submit="handleEditCustomer"
    >
      <CustomerForm ref="editFormRef" :customer="selectedCustomer" @submit="handleUpdateCustomer" />
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
const api = useApi()

definePageMeta({
  middleware: 'auth'
})

useHead({
  title: 'Clientes'
})

interface Customer {
  id: string
  full_name: string
  email?: string
  phone?: string
  address?: string
  notes?: string
}

const customers = ref<Customer[]>([])
const loading = ref(true)
const error = ref('')
const searchQuery = ref('')
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteDialog = ref(false)
const saving = ref(false)
const deleting = ref(false)
const customerFormRef = ref<any>(null)
const editFormRef = ref<any>(null)
const selectedCustomer = ref<Customer | null>(null)
const customerToDelete = ref<Customer | null>(null)
let searchTimeout: NodeJS.Timeout

const loadCustomers = async (search?: string) => {
  try {
    loading.value = true
    error.value = ''
    
    const endpoint = search 
      ? `/admin/customers?search=${encodeURIComponent(search)}`
      : '/admin/customers'
    
    const response = await api.get<{ ok: boolean; items: Customer[] }>(endpoint)
    
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

const handleSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    loadCustomers(searchQuery.value)
  }, 500)
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
      const index = customers.value.findIndex(c => c.id === selectedCustomer.value?.id)
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

onMounted(() => {
  loadCustomers()
})
</script>
