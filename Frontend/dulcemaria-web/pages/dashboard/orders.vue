<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">Órdenes</h1>
          <NuxtLink to="/dashboard" class="text-sm text-primary-600 hover:text-primary-500">
            ← Dashboard
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <div v-if="loading" class="text-center py-12">
          <p class="text-gray-500">Cargando órdenes...</p>
        </div>

        <div v-else-if="error" class="rounded-md bg-red-50 p-4 mb-4">
          <p class="text-sm text-red-800">{{ error }}</p>
        </div>

        <div v-else>
          <div class="mb-4 flex justify-between items-center">
            <p class="text-sm text-gray-600">
              Total: {{ orders.length }} órdenes
            </p>
            <button class="btn-primary text-sm" @click="openCreateModal">
              + Nueva Orden
            </button>
          </div>

          <div v-if="orders.length === 0" class="text-center py-12">
            <p class="text-gray-500">No hay órdenes registradas</p>
          </div>

          <div v-else class="bg-white shadow overflow-hidden sm:rounded-lg">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cliente
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Fecha
                  </th>
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr v-for="order in orders" :key="order.id">
                  <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    #{{ order.order_no }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">{{ order.customer_name }}</div>
                    <div class="text-sm text-gray-500">{{ order.customer_email }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span
                      :class="getStatusColor(order.status)"
                      class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                    >
                      {{ formatStatus(order.status) }}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${{ formatPrice(order.total_clp) }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {{ formatDate(order.created_at) }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      class="text-primary-600 hover:text-primary-900 mr-3"
                      @click="openStatusModal(order)"
                    >
                      Actualizar Estado
                    </button>
                    <button 
                      v-if="order.status !== 'CANCELLED' && order.status !== 'DELIVERED'"
                      class="text-red-600 hover:text-red-900"
                      @click="openCancelDialog(order)"
                    >
                      Cancelar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>

    <!-- Create Order Modal -->
    <Modal
      v-model="showCreateModal"
      title="Nueva Orden"
      :loading="saving"
      @submit="handleCreateOrder"
    >
      <OrderForm ref="orderFormRef" @submit="handleSubmitOrder" />
    </Modal>

    <!-- Update Order Status Modal -->
    <Modal
      v-model="showStatusModal"
      title="Actualizar Estado de Orden"
      :loading="saving"
      @submit="handleUpdateStatus"
    >
      <OrderStatusForm ref="statusFormRef" :order="selectedOrder" @submit="handleSubmitStatus" />
    </Modal>

    <!-- Cancel Confirmation -->
    <ConfirmDialog
      v-model="showCancelDialog"
      title="Cancelar Orden"
      :message="`¿Estás seguro de que deseas cancelar la orden #${orderToCancel?.order_no}? Esta acción no se puede deshacer.`"
      confirm-text="Cancelar Orden"
      :loading="cancelling"
      @confirm="handleCancelOrder"
    />
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({
  middleware: 'auth'
})

useHead({
  title: 'Órdenes'
})

interface Order {
  id: string
  order_no: number
  customer_name: string
  customer_email: string
  status: string
  payment_status: string
  total_clp: number
  created_at: string
}

const orders = ref<Order[]>([])
const loading = ref(true)
const error = ref('')
const showCreateModal = ref(false)
const showStatusModal = ref(false)
const showCancelDialog = ref(false)
const saving = ref(false)
const cancelling = ref(false)
const orderFormRef = ref<any>(null)
const statusFormRef = ref<any>(null)
const selectedOrder = ref<Order | null>(null)
const orderToCancel = ref<Order | null>(null)

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('es-CL', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatStatus = (status: string) => {
  const statusMap: Record<string, string> = {
    'PENDING_PAYMENT': 'Pendiente Pago',
    'PAID': 'Pagado',
    'PREPARING': 'Preparando',
    'READY': 'Listo',
    'DELIVERED': 'Entregado',
    'CANCELLED': 'Cancelado'
  }
  return statusMap[status] || status
}

const getStatusColor = (status: string) => {
  const colorMap: Record<string, string> = {
    'PENDING_PAYMENT': 'bg-yellow-100 text-yellow-800',
    'PAID': 'bg-blue-100 text-blue-800',
    'PREPARING': 'bg-purple-100 text-purple-800',
    'READY': 'bg-green-100 text-green-800',
    'DELIVERED': 'bg-gray-100 text-gray-800',
    'CANCELLED': 'bg-red-100 text-red-800'
  }
  return colorMap[status] || 'bg-gray-100 text-gray-800'
}

const loadOrders = async () => {
  try {
    loading.value = true
    error.value = ''
    
    const response = await api.get<{ ok: boolean; items: Order[] }>('/admin/orders')
    
    if (response.ok && response.items) {
      orders.value = response.items
    }
  } catch (e: any) {
    console.error('Error loading orders:', e)
    error.value = e?.data?.error || 'Error al cargar las órdenes'
  } finally {
    loading.value = false
  }
}

const openCreateModal = () => {
  showCreateModal.value = true
}

const handleCreateOrder = () => {
  orderFormRef.value?.submit()
}

const handleSubmitOrder = async (data: any) => {
  try {
    saving.value = true
    error.value = ''
    
    const response = await api.post<{ ok: boolean; order: Order }>('/admin/orders', data)
    
    if (response.ok && response.order) {
      orders.value.unshift(response.order)
      showCreateModal.value = false
    }
  } catch (e: any) {
    console.error('Error creating order:', e)
    error.value = e?.data?.error || 'Error al crear la orden'
  } finally {
    saving.value = false
  }
}

const openStatusModal = (order: Order) => {
  selectedOrder.value = order
  showStatusModal.value = true
}

const handleUpdateStatus = () => {
  statusFormRef.value?.submit()
}

const handleSubmitStatus = async (data: any) => {
  if (!selectedOrder.value) return
  
  try {
    saving.value = true
    error.value = ''
    
    // Actualizar estado de orden
    await api.patch(`/admin/orders/${selectedOrder.value.id}/status`, {
      status: data.status
    })
    
    // Actualizar estado de pago
    await api.patch(`/admin/orders/${selectedOrder.value.id}/payment`, {
      paymentStatus: data.paymentStatus
    })
    
    // Recargar órdenes
    await loadOrders()
    showStatusModal.value = false
    selectedOrder.value = null
  } catch (e: any) {
    console.error('Error updating order status:', e)
    error.value = e?.data?.error || 'Error al actualizar el estado de la orden'
  } finally {
    saving.value = false
  }
}

const openCancelDialog = (order: Order) => {
  orderToCancel.value = order
  showCancelDialog.value = true
}

const handleCancelOrder = async () => {
  if (!orderToCancel.value) return
  
  try {
    cancelling.value = true
    error.value = ''
    
    // Actualizar estado a CANCELLED
    await api.patch(`/admin/orders/${orderToCancel.value.id}/status`, {
      status: 'CANCELLED'
    })
    
    // Recargar órdenes
    await loadOrders()
    showCancelDialog.value = false
    orderToCancel.value = null
  } catch (e: any) {
    console.error('Error cancelling order:', e)
    error.value = e?.data?.error || 'Error al cancelar la orden'
  } finally {
    cancelling.value = false
  }
}

onMounted(() => {
  loadOrders()
})
</script>
