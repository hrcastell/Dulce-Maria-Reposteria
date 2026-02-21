<template>
  <div>
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Órdenes</h1>
        <p class="mt-1 text-warm-500">Gestiona los pedidos de tus clientes</p>
      </div>
      <button
        @click="openCreateModal"
        class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft hover:shadow-md"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span>Nueva Orden</span>
      </button>
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center py-16">
      <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      <p class="mt-4 text-warm-500">Cargando órdenes...</p>
    </div>

    <div v-else-if="error" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-error-500 text-xl">⚠️</span>
        <p class="text-error-700">{{ error }}</p>
      </div>
    </div>

    <div v-else>
      <!-- Stats Bar -->
      <div class="flex items-center justify-between mb-6">
        <p class="text-sm text-warm-500">
          <span class="font-medium text-warm-700">{{ orders.length }}</span> órdenes en total
        </p>
      </div>

      <!-- Empty State -->
      <div v-if="orders.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
        <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-4xl">📦</span>
        </div>
        <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay órdenes</h3>
        <p class="text-warm-500 mb-6">Aún no tienes pedidos registrados en el sistema</p>
        <button
          @click="openCreateModal"
          class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Crear Primera Orden</span>
        </button>
      </div>

      <!-- Desktop Table -->
      <div v-if="orders.length > 0" class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">#</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Cliente</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Total</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Fecha</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-warm-100">
            <tr v-for="order in orders" :key="order.id" class="hover:bg-warm-50/50 transition-colors">
              <td class="px-4 py-3 text-sm font-medium text-warm-800">#{{ order.order_no }}</td>
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-warm-800">{{ order.customer_name }}</div>
                <div class="text-sm text-warm-400">{{ order.customer_email }}</div>
              </td>
              <td class="px-4 py-3">
                <span :class="getStatusBadgeClass(order.status)" class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium">
                  {{ formatStatus(order.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm font-semibold text-warm-800">${{ formatPrice(order.total_clp) }}</td>
              <td class="px-4 py-3 text-sm text-warm-500">{{ formatDate(order.created_at) }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-warm-600 hover:text-warm-800 mr-3 transition-colors"
                  @click="openDetailModal(order)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Ver
                </button>
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 mr-3 transition-colors"
                  @click="openStatusModal(order)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  Estado
                </button>
                <button
                  v-if="order.status !== 'CANCELLED' && order.status !== 'DELIVERED'"
                  class="inline-flex items-center gap-1 text-sm font-medium text-error-600 hover:text-error-700 transition-colors"
                  @click="openCancelDialog(order)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                  Cancelar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div v-if="orders.length > 0" class="sm:hidden space-y-3">
        <div v-for="order in orders" :key="order.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
          <div class="flex items-start justify-between">
            <div>
              <p class="font-semibold text-warm-800">#{{ order.order_no }}</p>
              <p class="text-sm text-warm-600 mt-0.5">{{ order.customer_name }}</p>
              <p class="text-xs text-warm-400">{{ order.customer_email }}</p>
            </div>
            <span :class="getStatusBadgeClass(order.status)" class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium">
              {{ formatStatus(order.status) }}
            </span>
          </div>
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-warm-100">
            <p class="font-semibold text-primary-600">${{ formatPrice(order.total_clp) }}</p>
            <p class="text-xs text-warm-400">{{ formatDate(order.created_at) }}</p>
          </div>
          <div class="flex items-center gap-2 mt-3">
            <button
              class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-warm-700 bg-warm-50 hover:bg-warm-100 rounded-lg transition-colors"
              @click="openDetailModal(order)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Ver
            </button>
            <button
              class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
              @click="openStatusModal(order)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Estado
            </button>
            <button
              v-if="order.status !== 'CANCELLED' && order.status !== 'DELIVERED'"
              class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-error-600 bg-error-50 hover:bg-error-100 rounded-lg transition-colors"
              @click="openCancelDialog(order)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>

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
      title="Actualizar Estado"
      :loading="saving"
      @submit="handleUpdateStatus"
    >
      <OrderStatusForm ref="statusFormRef" :order="selectedOrder" @submit="handleSubmitStatus" />
    </Modal>

    <!-- Order Details Modal -->
    <Modal
      v-model="showDetailModal"
      title="Detalle de Orden"
      :hide-submit="true"
    >
      <div class="w-full">
        <div v-if="loadingDetail" key="loading" class="flex justify-center py-8">
          <div class="w-10 h-10 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
        </div>
        <div v-else-if="detailError" key="error" class="text-center py-8 text-error-600">
          {{ detailError }}
        </div>
        <OrderDetail v-else-if="selectedOrderDetail" key="content" :order="selectedOrderDetail" />
      </div>
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
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Órdenes | Dulce María'
})

const api = useApi()

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
const showDetailModal = ref(false)
const showCancelDialog = ref(false)
const saving = ref(false)
const cancelling = ref(false)
const orderFormRef = ref<any>(null)
const statusFormRef = ref<any>(null)
const selectedOrder = ref<Order | null>(null)
const selectedOrderDetail = ref<any>(null)
const loadingDetail = ref(false)
const detailError = ref('')
const orderToCancel = ref<Order | null>(null)

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('es-CL', {
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

const getStatusBadgeClass = (status: string) => {
  const colorMap: Record<string, string> = {
    'PENDING_PAYMENT': 'bg-warning-100 text-warning-700',
    'PAID': 'bg-info-100 text-info-700',
    'PREPARING': 'bg-primary-100 text-primary-700',
    'READY': 'bg-success-100 text-success-700',
    'DELIVERED': 'bg-warm-100 text-warm-700',
    'CANCELLED': 'bg-error-100 text-error-700'
  }
  return colorMap[status] || 'bg-warm-100 text-warm-700'
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

    await api.patch(`/admin/orders/${selectedOrder.value.id}/status`, {
      status: data.status
    })

    await api.patch(`/admin/orders/${selectedOrder.value.id}/payment`, {
      paymentStatus: data.paymentStatus
    })

    await loadOrders()
    showStatusModal.value = false
    selectedOrder.value = null
  } catch (e: any) {
    console.error('Error updating order status:', e)
    error.value = e?.data?.error || 'Error al actualizar el estado'
  } finally {
    saving.value = false
  }
}

const openDetailModal = async (order: Order) => {
  selectedOrderDetail.value = null
  detailError.value = ''
  showDetailModal.value = true
  loadingDetail.value = true
  
  try {
    const response = await api.get<{ ok: boolean; order: any; items: any[] }>(`/admin/orders/${order.id}`)
    if (response.ok && response.order) {
      const items = (response.items || []).map((i: any) => ({
        id: i.id,
        product_name: i.product_name_snapshot,
        quantity: i.qty,
        unit_price: i.unit_price_clp,
        total_price: i.line_total_clp
      }))
      
      selectedOrderDetail.value = {
        ...response.order,
        delivery_fee: response.order.delivery_fee_clp,
        delivery_address: response.order.delivery_address || response.order.customer_address,
        items
      }
    } else {
       detailError.value = 'No se pudieron cargar los detalles'
    }
  } catch (e: any) {
    console.error('Error loading order details:', e)
    detailError.value = e?.data?.error || 'Error al cargar el detalle'
  } finally {
    loadingDetail.value = false
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

    await api.patch(`/admin/orders/${orderToCancel.value.id}/status`, {
      status: 'CANCELLED'
    })

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
