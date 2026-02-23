<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Dashboard</h1>
      <p class="mt-1 text-warm-500">Bienvenido de vuelta, {{ user?.email?.split('@')[0] || 'Administrador' }}</p>
    </div>

    <!-- Quick Stats -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="bg-white rounded-2xl p-4 sm:p-5 shadow-soft border border-warm-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary-100 flex items-center justify-center text-xl sm:text-2xl">
            📦
          </div>
          <div>
            <p class="text-xs sm:text-sm text-warm-500">Órdenes</p>
            <p class="text-lg sm:text-xl font-bold text-warm-800">{{ dashboardStats.orders }}</p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-2xl p-4 sm:p-5 shadow-soft border border-warm-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-secondary-100 flex items-center justify-center text-xl sm:text-2xl">
            🍰
          </div>
          <div>
            <p class="text-xs sm:text-sm text-warm-500">Productos</p>
            <p class="text-lg sm:text-xl font-bold text-warm-800">{{ dashboardStats.products }}</p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-2xl p-4 sm:p-5 shadow-soft border border-warm-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-success-100 flex items-center justify-center text-xl sm:text-2xl">
            👥
          </div>
          <div>
            <p class="text-xs sm:text-sm text-warm-500">Clientes</p>
            <p class="text-lg sm:text-xl font-bold text-warm-800">{{ dashboardStats.customers }}</p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-2xl p-4 sm:p-5 shadow-soft border border-warm-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-warning-100 flex items-center justify-center text-xl sm:text-2xl">
            💰
          </div>
          <div>
            <p class="text-xs sm:text-sm text-warm-500">Ventas Hoy</p>
            <p class="text-lg sm:text-xl font-bold text-warm-800">${{ formatPrice(dashboardStats.todaySales) }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions Grid -->
    <h2 class="text-lg font-semibold text-warm-800 mb-4">Acciones Rápidas</h2>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <NuxtLink
        v-for="action in quickActions"
        :key="action.path"
        :to="action.path"
        class="group bg-white rounded-2xl p-5 sm:p-6 shadow-soft border border-warm-100 hover:shadow-soft-lg hover:border-primary-200 transition-all duration-200"
      >
        <div class="flex items-start gap-4">
          <div :class="`w-12 h-12 rounded-xl ${action.bgColor} flex items-center justify-center text-2xl group-hover:scale-110 transition-transform duration-200`">
            {{ action.icon }}
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-warm-800 group-hover:text-primary-600 transition-colors">{{ action.title }}</h3>
            <p class="text-sm text-warm-500 mt-1">{{ action.description }}</p>
          </div>
          <svg class="w-5 h-5 text-warm-300 group-hover:text-primary-400 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
        </div>
      </NuxtLink>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
      <!-- Recent Orders -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-warm-800">Órdenes Recientes</h2>
          <NuxtLink to="/dashboard/orders" class="text-sm text-primary-600 hover:text-primary-700 font-medium">
            Ver todas
          </NuxtLink>
        </div>

        <div v-if="recentOrders.length > 0" class="bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
          <table class="min-w-full divide-y divide-warm-100">
            <thead class="bg-warm-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">#</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Cliente</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Estado</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-warm-100">
              <tr v-for="order in recentOrders" :key="order.id" class="hover:bg-warm-50/50 transition-colors">
                <td class="px-4 py-3 text-sm font-medium text-warm-800">#{{ order.order_no }}</td>
                <td class="px-4 py-3 text-sm text-warm-700">{{ order.customer_name }}</td>
                <td class="px-4 py-3">
                  <span :class="getStatusBadgeClass(order.status)" class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium">
                    {{ formatStatus(order.status) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-sm font-medium text-warm-800">${{ formatPrice(order.total_clp) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="bg-white rounded-2xl p-8 text-center border border-warm-100 shadow-soft">
          <p class="text-warm-600 font-medium">No hay órdenes recientes</p>
        </div>
      </div>

      <!-- Low Stock Alerts -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-warm-800 flex items-center gap-2">
            ⚠️ Stock Crítico
            <span v-if="lowStockItems.length" class="bg-error-100 text-error-700 text-xs px-2 py-0.5 rounded-full">{{ lowStockItems.length }}</span>
          </h2>
          <NuxtLink to="/dashboard/products" class="text-sm text-primary-600 hover:text-primary-700 font-medium">
            Gestionar
          </NuxtLink>
        </div>

        <div v-if="lowStockItems.length === 0" class="bg-white rounded-2xl p-8 text-center border border-warm-100 shadow-soft">
          <div class="text-4xl mb-3">✅</div>
          <p class="text-warm-600 font-medium">Todo en orden</p>
          <p class="text-sm text-warm-400">No hay productos con stock agotado.</p>
        </div>

        <div v-else class="bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden max-h-[400px] overflow-y-auto">
          <div v-for="item in lowStockItems" :key="item.id" class="p-4 border-b border-warm-100 last:border-0 hover:bg-warm-50/50 transition-colors">
            <div class="flex justify-between items-start">
              <div>
                <p class="font-medium text-warm-800">{{ item.name }}</p>
                <p v-if="item.variant_name" class="text-xs text-warm-500 mt-0.5">Variante: {{ item.variant_name }}</p>
              </div>
              <span class="bg-error-50 text-error-700 text-xs font-bold px-2 py-1 rounded-lg">
                Stock: {{ item.stock_qty }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

interface Order {
  id: string
  order_no: string | number
  customer_name: string
  status: string
  total_clp: number
  created_at: string
}

interface LowStockItem {
  id: string
  name: string
  variant_name?: string
  stock_qty: number
}

const api = useApi()
const user = ref<any>(null)
const dashboardStats = ref({
  orders: 0,
  products: 0,
  customers: 0,
  todaySales: 0
})
const recentOrders = ref<Order[]>([])
const lowStockItems = ref<LowStockItem[]>([])

const quickActions = [
  {
    title: 'Nueva Orden',
    description: 'Crear una venta manual',
    icon: '📝',
    bgColor: 'bg-primary-100',
    path: '/dashboard/orders'
  },
  {
    title: 'Nuevo Producto',
    description: 'Agregar al inventario',
    icon: '🧁',
    bgColor: 'bg-secondary-100',
    path: '/dashboard/products' 
  },
  {
    title: 'Nuevo Cliente',
    description: 'Registrar comprador',
    icon: '👤',
    bgColor: 'bg-warm-100',
    path: '/dashboard/customers'
  }
]

onMounted(() => {
  const userStr = localStorage.getItem('user')
  if (userStr) {
    try {
      user.value = JSON.parse(userStr)
    } catch (e) {}
  }
  loadDashboardData()
})

const loadDashboardData = async () => {
  try {
    // Load stats
    const [ordersRes, productsRes, customersRes] = await Promise.all([
      api.get('/admin/orders').catch(() => ({ ok: false, items: [] })),
      api.get('/admin/products').catch(() => ({ ok: false, items: [] })),
      api.get('/admin/customers').catch(() => ({ ok: false, items: [] }))
    ])

    if (ordersRes.ok) {
      // Get today's date components in local timezone
      const now = new Date()
      const todayYear = now.getFullYear()
      const todayMonth = now.getMonth()
      const todayDay = now.getDate()

      // Filter today's orders using Date object (handles any timestamp format)
      const todayOrders = ordersRes.items?.filter((o: Order) => {
        if (!o.created_at) return false
        const orderDate = new Date(o.created_at)
        return (
          orderDate.getFullYear() === todayYear &&
          orderDate.getMonth() === todayMonth &&
          orderDate.getDate() === todayDay
        )
      }) || []

      // Órdenes card: count only today's orders
      dashboardStats.value.orders = todayOrders.length

      // Recent orders: show last 5 from all orders
      recentOrders.value = (ordersRes.items || []).slice(0, 5)

      // Ventas Hoy: sum only today's non-cancelled orders
      dashboardStats.value.todaySales = todayOrders
        .filter((o: Order) => o.status !== 'CANCELLED')
        .reduce((sum: number, o: Order) => sum + (o.total_clp || 0), 0)
    }

    if (productsRes.ok) {
      const allProducts = productsRes.items || []
      dashboardStats.value.products = allProducts.length
      
      // Calculate Low Stock (Client side filter for now, ideally API endpoint)
      // Since listing all products might not list all variants, we need to be careful.
      // However, we don't have a bulk variants endpoint easily available here without fetching all.
      // Strategy: Check products with stock_qty <= 0.
      // Note: If product has variants, its stock_qty is sum of variants (due to our new trigger).
      // So if product stock is 0, it means ALL variants are 0.
      // This is a good approximation for "Stock Crítico" at product level.
      // If user wants specific variant low stock, we'd need to fetch all variants or add a specific API endpoint.
      // Given the prompt "incluir un cart que indique los productos que están en stock 0", showing the product is sufficient.
      
      lowStockItems.value = allProducts
        .filter((p: any) => p.is_active && p.stock_qty <= 0)
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          stock_qty: p.stock_qty
        }))
    }

    if (customersRes.ok) {
      dashboardStats.value.customers = customersRes.items?.length || 0
    }
  } catch (e) {
    console.error('Error loading dashboard:', e)
  }
}
// ...

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price || 0)
}

const formatDate = (date: string) => {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('es-CL', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatStatus = (status: string) => {
  const statusMap: Record<string, string> = {
    'PENDING_PAYMENT': 'Pendiente',
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
</script>
