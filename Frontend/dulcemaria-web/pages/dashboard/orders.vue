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
      <!-- Search Bar & Date Range Filter -->
      <div class="mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
        <div class="relative max-w-md w-full">
          <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg class="h-5 w-5 text-warm-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Buscar por orden, cliente, email..."
            class="block w-full pl-11 pr-4 py-3 border border-warm-200 rounded-xl text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
            @input="handleSearch"
          >
        </div>

        <!-- Filtro externo de rango de fechas — independiente del orden por columna -->
        <div class="flex items-end gap-3">
          <div>
            <label class="block text-xs font-medium text-warm-500 mb-1">Desde</label>
            <input
              v-model="dateFrom"
              type="date"
              class="block px-3 py-2.5 border border-warm-200 rounded-xl text-warm-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
            >
          </div>
          <div>
            <label class="block text-xs font-medium text-warm-500 mb-1">Hasta</label>
            <input
              v-model="dateTo"
              type="date"
              class="block px-3 py-2.5 border border-warm-200 rounded-xl text-warm-800 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
            >
          </div>
        </div>
      </div>

      <!-- Stats Bar -->
      <div class="flex items-center justify-between mb-6">
        <p class="text-sm text-warm-500">
          <span class="font-medium text-warm-700">{{ sortedOrders.length }}</span> {{ (searchQuery || dateFrom || dateTo) ? 'de ' + orders.length + ' órdenes' : 'órdenes en total' }}
        </p>
      </div>

      <!-- Empty State -->
      <div v-if="sortedOrders.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
        <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-4xl">📦</span>
        </div>
        <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay órdenes</h3>
        <p class="text-warm-500 mb-6">{{ (searchQuery || dateFrom || dateTo) ? 'No se encontraron resultados para tu búsqueda' : 'Aún no tienes pedidos registrados en el sistema' }}</p>
        <button
          v-if="!searchQuery && !dateFrom && !dateTo"
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
      <div v-if="sortedOrders.length > 0" class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">#</th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider cursor-pointer select-none hover:text-warm-800 transition-colors"
                @click="toggleSort('customer_name')"
              >
                Cliente
                <span v-if="sortColumn === 'customer_name'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
              </th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider cursor-pointer select-none hover:text-warm-800 transition-colors"
                @click="toggleSort('status')"
              >
                Estado
                <span v-if="sortColumn === 'status'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
              </th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider cursor-pointer select-none hover:text-warm-800 transition-colors"
                @click="toggleSort('payment_status')"
              >
                Pago
                <span v-if="sortColumn === 'payment_status'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
              </th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider cursor-pointer select-none hover:text-warm-800 transition-colors"
                @click="toggleSort('total_clp')"
              >
                Total
                <span v-if="sortColumn === 'total_clp'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
              </th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider cursor-pointer select-none hover:text-warm-800 transition-colors"
                @click="toggleSort('created_at')"
              >
                Fecha
                <span v-if="sortColumn === 'created_at'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
              </th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-warm-100">
            <tr v-for="order in sortedOrders" :key="order.id" class="hover:bg-warm-50/50 transition-colors">
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
              <td class="px-4 py-3">
                <span :class="getPaymentStatusBadgeClass(order.payment_status)" class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium">
                  {{ formatPaymentStatus(order.payment_status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm font-semibold text-warm-800">${{ formatPrice(order.total_clp) }}</td>
              <td class="px-4 py-3 text-sm text-warm-500">{{ formatDate(order.created_at) }}</td>
              <td class="px-4 py-3 text-right">
                <div class="relative inline-block text-left" @click.stop>
                  <button
                    type="button"
                    class="p-2 text-warm-500 hover:text-warm-800 hover:bg-warm-100 rounded-lg transition-colors"
                    aria-label="Acciones"
                    @click="toggleActionsMenu(order.id)"
                  >
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>

                  <div
                    v-if="openMenuId === order.id"
                    class="absolute right-0 z-20 mt-1 w-48 bg-white border border-warm-200 rounded-xl shadow-lg py-1"
                  >
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition-colors"
                      @click="openMenuId = null; openDetailModal(order)"
                    >
                      <span>👁️</span> Ver
                    </button>
                    <button
                      v-if="canEdit && order.status !== 'CANCELLED'"
                      type="button"
                      class="w-full flex items-center gap-2 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="loadingEditDetail"
                      @click="openMenuId = null; openEditModal(order)"
                    >
                      <span>✏️</span> {{ loadingEditDetail ? 'Cargando...' : 'Editar' }}
                    </button>
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 transition-colors"
                      @click="openMenuId = null; openStatusModal(order)"
                    >
                      <span>🔄</span> Estado
                    </button>
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      :disabled="printingOrderId === order.id"
                      @click="openMenuId = null; printOrder(order)"
                    >
                      <span>🖨️</span> {{ printingOrderId === order.id ? 'Generando...' : 'Imprimir' }}
                    </button>
                    <button
                      v-if="order.status !== 'CANCELLED' && order.status !== 'DELIVERED'"
                      type="button"
                      class="w-full flex items-center gap-2 px-4 py-2 text-sm text-error-600 hover:bg-error-50 transition-colors"
                      @click="openMenuId = null; openCancelDialog(order)"
                    >
                      <span>🗑️</span> Cancelar
                    </button>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div v-if="sortedOrders.length > 0" class="sm:hidden space-y-3">
        <div v-for="order in sortedOrders" :key="order.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
          <div class="flex items-start justify-between">
            <div>
              <p class="font-semibold text-warm-800">#{{ order.order_no }}</p>
              <p class="text-sm text-warm-600 mt-0.5">{{ order.customer_name }}</p>
              <p class="text-xs text-warm-400">{{ order.customer_email }}</p>
            </div>
            <div class="flex flex-col items-end gap-1">
              <span :class="getStatusBadgeClass(order.status)" class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium">
                {{ formatStatus(order.status) }}
              </span>
              <span :class="getPaymentStatusBadgeClass(order.payment_status)" class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium">
                {{ formatPaymentStatus(order.payment_status) }}
              </span>
            </div>
          </div>
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-warm-100">
            <p class="font-semibold text-primary-600">${{ formatPrice(order.total_clp) }}</p>
            <p class="text-xs text-warm-400">{{ formatDate(order.created_at) }}</p>
          </div>
          <div class="flex items-center justify-end mt-3 relative" @click.stop>
            <button
              type="button"
              class="p-2 text-warm-500 hover:text-warm-800 hover:bg-warm-100 rounded-lg transition-colors"
              aria-label="Acciones"
              @click="toggleActionsMenu(order.id)"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>

            <div
              v-if="openMenuId === order.id"
              class="absolute right-0 top-full z-20 mt-1 w-48 bg-white border border-warm-200 rounded-xl shadow-lg py-1"
            >
              <button
                type="button"
                class="w-full flex items-center gap-2 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition-colors"
                @click="openMenuId = null; openDetailModal(order)"
              >
                <span>👁️</span> Ver
              </button>
              <button
                v-if="canEdit && order.status !== 'CANCELLED'"
                type="button"
                class="w-full flex items-center gap-2 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="loadingEditDetail"
                @click="openMenuId = null; openEditModal(order)"
              >
                <span>✏️</span> {{ loadingEditDetail ? 'Cargando...' : 'Editar' }}
              </button>
              <button
                type="button"
                class="w-full flex items-center gap-2 px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 transition-colors"
                @click="openMenuId = null; openStatusModal(order)"
              >
                <span>🔄</span> Estado
              </button>
              <button
                type="button"
                class="w-full flex items-center gap-2 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="printingOrderId === order.id"
                @click="openMenuId = null; printOrder(order)"
              >
                <span>🖨️</span> {{ printingOrderId === order.id ? 'Generando...' : 'Imprimir' }}
              </button>
              <button
                v-if="order.status !== 'CANCELLED' && order.status !== 'DELIVERED'"
                type="button"
                class="w-full flex items-center gap-2 px-4 py-2 text-sm text-error-600 hover:bg-error-50 transition-colors"
                @click="openMenuId = null; openCancelDialog(order)"
              >
                <span>🗑️</span> Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Order Panel -->
    <SidePanel
      v-model="showCreateModal"
      title="Nueva Orden"
      :loading="saving"
      @submit="handleCreateOrder"
    >
      <OrderForm ref="orderFormRef" @submit="handleSubmitOrder" />
    </SidePanel>

    <!-- Edit Order Panel (SUPERADMIN/ADMIN only — ver canEdit) -->
    <SidePanel
      v-model="showEditModal"
      title="Editar Orden"
      :loading="saving"
      @submit="handleUpdateOrder"
    >
      <OrderForm ref="editFormRef" :order="editingOrder" :order-items="editingOrderItems" @submit="handleSubmitEditOrder" />
    </SidePanel>

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

    <NoticeDialog
      v-model="showNotice"
      :variant="noticeVariant"
      :message="noticeMessage"
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
const searchQuery = ref('')

// NoticeDialog — mismo patrón que plantilla-costo.vue/motor-tarifa.vue,
// feedback de éxito/error para las acciones que actualizan algo.
const showNotice = ref(false)
const noticeVariant = ref<'success' | 'error'>('success')
const noticeMessage = ref('')

// Rol — igual patrón que currentUserRole/canWrite en supplies.vue: se lee
// una vez de localStorage('user') en onMounted, ADMIN/SUPERADMIN pueden
// editar la orden completa, STAFF solo puede cambiar el estado.
const currentUserRole = ref('')
const canEdit = computed(() => currentUserRole.value === 'SUPERADMIN' || currentUserRole.value === 'ADMIN')

// Menú de acciones por fila (Ver / Editar / Estado / Imprimir / Cancelar) —
// un solo dropdown abierto a la vez, identificado por el id de la orden.
const openMenuId = ref<string | null>(null)
const toggleActionsMenu = (orderId: string) => {
  openMenuId.value = openMenuId.value === orderId ? null : orderId
}
const closeActionsMenu = () => {
  openMenuId.value = null
}

// Imprimir boleta (Frontend/dulcemaria-web/public/boleta-template.html) —
// trae el detalle completo de la orden, lo deja en sessionStorage y abre la
// plantilla en una pestaña nueva. La plantilla lee sessionStorage sola al
// cargar (ver loadOrderDataIfPresent ahí) — acá no se toca su DOM ni su
// lógica de impresión/medidas de papel.
const printingOrderId = ref<string | null>(null)

const printOrder = async (order: Order) => {
  printingOrderId.value = order.id
  try {
    const res = await api.get<{ ok: boolean; order: any; items: any[] }>(`/admin/orders/${order.id}`)
    if (!res.ok) return

    const o = res.order
    const items = (res.items || []).map((it: any) => {
      let toppingsText = ''
      try {
        const toppings = it.selected_toppings ? JSON.parse(it.selected_toppings) : []
        if (toppings.length > 0) {
          toppingsText = ' + ' + toppings.map((t: any) => t.name).join(', + ')
        }
      } catch {}
      const variantText = it.variant_name ? ` (${it.variant_name})` : ''
      return {
        description: `${it.product_name_snapshot}${variantText}${toppingsText}`,
        quantity: it.qty,
        unitPrice: it.unit_price_clp
      }
    })

    const createdAt = new Date(o.created_at)
    const printData = {
      boleta: {
        number: String(o.order_no).padStart(6, '0'),
        date: createdAt.toLocaleDateString('es-CL'),
        time: createdAt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
        barcode: String(o.order_no).padStart(6, '0')
      },
      items,
      totals: {
        subtotal: o.subtotal_clp,
        deliveryFee: o.delivery_fee_clp,
        discount: o.discount_amount_clp,
        total: o.total_clp
      }
    }

    sessionStorage.setItem('boleta_print_data', JSON.stringify(printData))
    window.open('/boleta-template.html', '_blank')
  } catch (e: any) {
    console.error('Error preparing print:', e)
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al preparar la impresión'
    showNotice.value = true
  } finally {
    printingOrderId.value = null
  }
}

// Edición de orden completa (PUT /admin/orders/:id) — el padre trae la
// cabecera + items con GET /admin/orders/:id antes de abrir el panel;
// OrderForm no hace su propio fetch de detalle.
const editingOrder = ref<any>(null)
const editingOrderItems = ref<any[]>([])
const showEditModal = ref(false)
const loadingEditDetail = ref(false)
const editFormRef = ref<any>(null)

const filteredOrders = computed(() => {
  if (!searchQuery.value) return orders.value
  const query = searchQuery.value.toLowerCase()
  return orders.value.filter(o =>
    o.order_no.toString().includes(query) ||
    o.customer_name.toLowerCase().includes(query) ||
    (o.customer_email?.toLowerCase().includes(query) ?? false) ||
    formatStatus(o.status).toLowerCase().includes(query) ||
    formatPaymentStatus(o.payment_status).toLowerCase().includes(query)
  )
})

// Filtro externo de rango de fechas — client-side, sobre la lista ya
// filtrada por búsqueda. Todo se trae de una vez con GET /admin/orders
// (sin límite), así que no hay ida y vuelta al backend por este filtro.
const dateFrom = ref('')
const dateTo = ref('')

const dateFilteredOrders = computed(() => {
  if (!dateFrom.value && !dateTo.value) return filteredOrders.value

  const fromTs = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : null
  const toTs = dateTo.value ? new Date(`${dateTo.value}T23:59:59`).getTime() : null

  return filteredOrders.value.filter(o => {
    const t = new Date(o.created_at).getTime()
    if (fromTs !== null && t < fromTs) return false
    if (toTs !== null && t > toTs) return false
    return true
  })
})

// Orden por click en encabezado — primer click en una columna ordena
// DESCENDENTE, un segundo click en la MISMA columna alterna a ASCENDENTE.
// Default: ordenado por fecha de creación descendente (el más reciente primero).
const sortColumn = ref<'customer_name' | 'status' | 'payment_status' | 'total_clp' | 'created_at'>('created_at')
const sortDirection = ref<'asc' | 'desc'>('desc')

const toggleSort = (column: typeof sortColumn.value) => {
  if (sortColumn.value === column) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = column
    sortDirection.value = 'desc'
  }
}

// Comparador "base" ya en orden DESCENDENTE (para que el default de la
// página — created_at desc — no necesite ninguna inversión); si
// sortDirection es 'asc' se invierte multiplicando por -1.
const compareOrdersDesc = (a: Order, b: Order, column: typeof sortColumn.value) => {
  if (column === 'total_clp') return b.total_clp - a.total_clp
  if (column === 'created_at') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  return String(b[column] ?? '').localeCompare(String(a[column] ?? ''))
}

const sortedOrders = computed(() => {
  const list = [...dateFilteredOrders.value]
  list.sort((a, b) => {
    const cmp = compareOrdersDesc(a, b, sortColumn.value)
    return sortDirection.value === 'asc' ? cmp * -1 : cmp
  })
  return list
})

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

const formatPaymentStatus = (status: string) => {
  const statusMap: Record<string, string> = {
    'PENDING': 'Pendiente',
    'PAID': 'Pagado',
    'FAILED': 'Fallido',
    'REFUNDED': 'Reembolsado'
  }
  return statusMap[status] || status
}

const getPaymentStatusBadgeClass = (status: string) => {
  const colorMap: Record<string, string> = {
    'PENDING': 'bg-warning-100 text-warning-700',
    'PAID': 'bg-success-100 text-success-700',
    'FAILED': 'bg-error-100 text-error-700',
    'REFUNDED': 'bg-warm-100 text-warm-700'
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

    const response = await api.post<{ ok: boolean; order: Order }>('/admin/orders', data)

    if (response.ok && response.order) {
      await loadOrders()
      showCreateModal.value = false
      noticeVariant.value = 'success'
      noticeMessage.value = 'Orden creada correctamente.'
      showNotice.value = true
    }
  } catch (e: any) {
    console.error('Error creating order:', e)
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al crear la orden'
    showNotice.value = true
  } finally {
    saving.value = false
  }
}

const openEditModal = async (order: Order) => {
  loadingEditDetail.value = true
  try {
    const res = await api.get<{ ok: boolean; order: any; items: any[] }>(`/admin/orders/${order.id}`)
    if (res.ok) {
      editingOrder.value = res.order
      editingOrderItems.value = res.items
      showEditModal.value = true
    }
  } catch (e: any) {
    console.error('Error loading order for edit:', e)
    error.value = e?.data?.error || 'Error al cargar la orden para editar'
  } finally {
    loadingEditDetail.value = false
  }
}

const handleUpdateOrder = () => {
  editFormRef.value?.submit()
}

const handleSubmitEditOrder = async (payload: any) => {
  if (!editingOrder.value) return

  try {
    saving.value = true

    await api.put(`/admin/orders/${editingOrder.value.id}`, payload)

    showEditModal.value = false
    editingOrder.value = null
    editingOrderItems.value = []
    await loadOrders()
    noticeVariant.value = 'success'
    noticeMessage.value = 'Orden actualizada correctamente.'
    showNotice.value = true
  } catch (e: any) {
    console.error('Error updating order:', e)
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al actualizar la orden'
    showNotice.value = true
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

    await api.patch(`/admin/orders/${selectedOrder.value.id}/status`, {
      status: data.status
    })

    await api.patch(`/admin/orders/${selectedOrder.value.id}/payment`, {
      paymentStatus: data.paymentStatus
    })

    await loadOrders()
    showStatusModal.value = false
    selectedOrder.value = null
    noticeVariant.value = 'success'
    noticeMessage.value = 'Estado actualizado correctamente.'
    showNotice.value = true
  } catch (e: any) {
    console.error('Error updating order status:', e)
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al actualizar el estado'
    showNotice.value = true
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

    await api.patch(`/admin/orders/${orderToCancel.value.id}/status`, {
      status: 'CANCELLED'
    })

    await loadOrders()
    showCancelDialog.value = false
    orderToCancel.value = null
    noticeVariant.value = 'success'
    noticeMessage.value = 'Orden cancelada correctamente.'
    showNotice.value = true
  } catch (e: any) {
    console.error('Error cancelling order:', e)
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al cancelar la orden'
    showNotice.value = true
  } finally {
    cancelling.value = false
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
  try {
    const userStr = localStorage.getItem('user')
    if (userStr) {
      currentUserRole.value = JSON.parse(userStr)?.role || ''
    }
  } catch (e) {}

  loadOrders()

  // Cierra el menú de acciones al hacer click afuera. Los wrappers del botón
  // ⋮ y su dropdown usan @click.stop, así que este listener solo dispara
  // para clicks realmente fuera de cualquier menú abierto.
  document.addEventListener('click', closeActionsMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', closeActionsMenu)
})
</script>
