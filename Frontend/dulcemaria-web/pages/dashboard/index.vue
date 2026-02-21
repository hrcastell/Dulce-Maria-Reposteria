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
            <p class="text-lg sm:text-xl font-bold text-warm-800">{{ stats.orders }}</p>
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
            <p class="text-lg sm:text-xl font-bold text-warm-800">{{ stats.products }}</p>
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
            <p class="text-lg sm:text-xl font-bold text-warm-800">{{ stats.customers }}</p>
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
            <p class="text-lg sm:text-xl font-bold text-warm-800">${{ formatPrice(stats.todaySales) }}</p>
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

    <!-- Recent Activity -->
    <div v-if="recentOrders.length > 0" class="mt-8">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-warm-800">Órdenes Recientes</h2>
        <NuxtLink to="/dashboard/orders" class="text-sm text-primary-600 hover:text-primary-700 font-medium">
          Ver todas
        </NuxtLink>
      </div>

      <!-- Desktop Table -->
      <div class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">#</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Cliente</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Estado</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Total</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-warm-500 uppercase">Fecha</th>
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
              <td class="px-4 py-3 text-sm text-warm-500">{{ formatDate(order.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div class="sm:hidden space-y-3">
        <div v-for="order in recentOrders" :key="order.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
          <div class="flex items-start justify-between">
            <div>
              <p class="font-semibold text-warm-800">#{{ order.order_no }}</p>
              <p class="text-sm text-warm-600 mt-0.5">{{ order.customer_name }}</p>
            </div>
            <span :class="getStatusBadgeClass(order.status)" class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium">
              {{ formatStatus(order.status) }}
            </span>
          </div>
          <div class="flex items-center justify-between mt-3 pt-3 border-t border-warm-100">
            <p class="font-semibold text-primary-600">${{ formatPrice(order.total_clp) }}</p>
            <p class="text-xs text-warm-400">{{ formatDate(order.created_at) }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Dashboard | Dulce María'
})

const api = useApi()

interface User {
  email: string
  role: string
}

interface Order {
  id: string
  order_no: number
  customer_name: string
  status: string
  total_clp: number
  created_at: string
}

const user = ref<User | null>(null)
const stats = ref({
  orders: 0,
  products: 0,
  customers: 0,
  todaySales: 0
})
const recentOrders = ref<Order[]>([])

const quickActions = [
  {
    title: 'Nueva Orden',
    description: 'Crear una orden manualmente',
    icon: '📦',
    path: '/dashboard/orders',
    bgColor: 'bg-primary-100'
  },
  {
    title: 'Agregar Producto',
    description: 'Añadir producto al catálogo',
    icon: '🍰',
    path: '/dashboard/products',
    bgColor: 'bg-secondary-100'
  },
  {
    title: 'Nuevo Cliente',
    description: 'Registrar cliente en el sistema',
    icon: '👤',
    path: '/dashboard/customers',
    bgColor: 'bg-success-100'
  },
  {
    title: 'Configurar Tortas',
    description: 'Opciones de tortas personalizadas',
    icon: '🎂',
    path: '/dashboard/cake-builder',
    bgColor: 'bg-warning-100'
  },
  {
    title: 'Registrar Gasto',
    description: 'Agregar insumo o gasto',
    icon: '🧂',
    path: '/dashboard/supplies',
    bgColor: 'bg-info-100'
  },
  {
    title: 'Ver Reportes',
    description: 'Análisis de ventas y métricas',
    icon: '📊',
    path: '/dashboard/reports',
    bgColor: 'bg-primary-100'
  }
]

onMounted(() => {
  const userStr = localStorage.getItem('user')
  if (userStr) {
    user.value = JSON.parse(userStr)
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
      stats.value.orders = ordersRes.items?.length || 0
      recentOrders.value = (ordersRes.items || []).slice(0, 5)

      // Calculate today's sales
      const today = new Date().toISOString().split('T')[0]
      const todayOrders = ordersRes.items?.filter((o: Order) =>
        o.created_at?.startsWith(today) && o.status !== 'CANCELLED'
      ) || []
      stats.value.todaySales = todayOrders.reduce((sum: number, o: Order) => sum + (o.total_clp || 0), 0)
    }

    if (productsRes.ok) {
      stats.value.products = productsRes.items?.length || 0
    }

    if (customersRes.ok) {
      stats.value.customers = customersRes.items?.length || 0
    }
  } catch (e) {
    console.error('Error loading dashboard:', e)
  }
}

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
