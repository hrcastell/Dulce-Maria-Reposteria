<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">Reportes</h1>
          <NuxtLink to="/dashboard" class="text-sm text-primary-600 hover:text-primary-500">
            ← Dashboard
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">

        <!-- Mode Tabs -->
        <div class="mb-6 flex gap-2">
          <button
            :class="mode === 'day' ? 'btn-primary' : 'btn-secondary'"
            class="text-sm"
            @click="mode = 'day'; loadReport()"
          >📅 Por Día</button>
          <button
            :class="mode === 'month' ? 'btn-primary' : 'btn-secondary'"
            class="text-sm"
            @click="mode = 'month'; loadReport()"
          >📆 Por Mes</button>
        </div>

        <!-- Filters -->
        <div class="mb-6 card flex flex-wrap gap-4 items-end">
          <div v-if="mode === 'day'">
            <label class="label">Fecha</label>
            <input v-model="selectedDate" type="date" class="input max-w-xs" @change="loadReport">
          </div>
          <div v-else class="flex gap-4">
            <div>
              <label class="label">Año</label>
              <input v-model.number="selectedYear" type="number" min="2020" max="2099" class="input w-28" @change="loadReport">
            </div>
            <div>
              <label class="label">Mes</label>
              <select v-model.number="selectedMonth" class="input" @change="loadReport">
                <option v-for="m in months" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </div>
          </div>
          <button class="btn-secondary text-sm" @click="loadReport">🔄 Actualizar</button>
        </div>

        <div v-if="loading" class="text-center py-12">
          <p class="text-gray-500">Cargando reporte...</p>
        </div>

        <div v-else-if="error" class="rounded-md bg-red-50 p-4 mb-4">
          <p class="text-sm text-red-800">{{ error }}</p>
        </div>

        <div v-else-if="report">
          <!-- Summary Cards -->
          <div class="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-6">
            <div class="card">
              <div class="flex items-center">
                <span class="text-3xl">📦</span>
                <div class="ml-4">
                  <p class="text-sm text-gray-600">Total Órdenes</p>
                  <p class="text-2xl font-bold text-gray-900">{{ report.ordersCount }}</p>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="flex items-center">
                <span class="text-3xl">💰</span>
                <div class="ml-4">
                  <p class="text-sm text-gray-600">Total Ventas</p>
                  <p class="text-2xl font-bold text-primary-600">${{ formatPrice(report.totalClp) }}</p>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="flex items-center">
                <span class="text-3xl">📊</span>
                <div class="ml-4">
                  <p class="text-sm text-gray-600">Promedio por Orden</p>
                  <p class="text-2xl font-bold text-gray-900">
                    ${{ formatPrice(report.ordersCount > 0 ? report.totalClp / report.ordersCount : 0) }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Orders Grid -->
          <div class="card mb-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Detalle de Órdenes</h3>
            <div v-if="report.orders && report.orders.length > 0" class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">N° Orden</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  <tr v-for="order in report.orders" :key="order.id">
                    <td class="px-4 py-3 text-sm font-mono text-gray-700">{{ order.order_code || (order.order_no ? `#${order.order_no}` : order.id?.slice(0,8)) }}</td>
                    <td class="px-4 py-3 text-sm text-gray-600">{{ formatDate(order.created_at) }}</td>
                    <td class="px-4 py-3 text-sm text-gray-900">{{ order.customer_name || '—' }}</td>
                    <td class="px-4 py-3 text-sm font-semibold text-gray-900">${{ formatPrice(order.total_clp) }}</td>
                    <td class="px-4 py-3">
                      <span :class="statusClass(order.status)" class="px-2 py-1 rounded-full text-xs font-semibold">
                        {{ statusLabel(order.status) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="text-center py-8 text-gray-500">
              No hay órdenes en este período
            </div>
          </div>

          <!-- Top Products -->
          <div class="card">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">Productos Más Vendidos</h3>
            <div v-if="report.topProducts && report.topProducts.length > 0">
              <div class="space-y-2">
                <div
                  v-for="(product, index) in report.topProducts"
                  :key="product.product_id"
                  class="flex items-center justify-between py-3 border-b border-gray-200 last:border-0"
                >
                  <div class="flex items-center">
                    <span class="text-sm font-semibold text-gray-400 w-7">{{ index + 1 }}.</span>
                    <div class="ml-2">
                      <p class="text-sm font-medium text-gray-900">{{ product.name }}</p>
                      <p class="text-xs text-gray-500">{{ product.qty }} unidades</p>
                    </div>
                  </div>
                  <p class="text-sm font-semibold text-gray-900">${{ formatPrice(product.total_clp) }}</p>
                </div>
              </div>
            </div>
            <div v-else class="text-center py-8 text-gray-500">
              No hay datos de productos para este período
            </div>
          </div>
        </div>

        <div v-else class="text-center py-12">
          <p class="text-gray-500">Selecciona un período para ver el reporte</p>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({
  middleware: 'auth'
})

useHead({
  title: 'Reportes'
})

interface OrderRow {
  id: string
  order_number?: string
  customer_name?: string
  total_clp: number
  status: string
  created_at: string
}

interface TopProduct {
  product_id: string
  name: string
  qty: number
  total_clp: number
}

interface Report {
  ordersCount: number
  totalClp: number
  orders?: OrderRow[]
  topProducts?: TopProduct[]
}

const now = new Date()
const selectedDate = ref(now.toISOString().split('T')[0])
const selectedYear = ref(now.getFullYear())
const selectedMonth = ref(now.getMonth() + 1)
const mode = ref<'day' | 'month'>('day')
const report = ref<Report | null>(null)
const loading = ref(false)
const error = ref('')

const months = [
  { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' }, { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' }, { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' }
]

const formatPrice = (price: number) =>
  new Intl.NumberFormat('es-CL').format(Math.round(price))

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })

const statusLabel = (s: string) => ({
  PENDING: 'Pendiente', PENDING_PAYMENT: 'Pend. Pago',
  CONFIRMED: 'Confirmado', IN_PROGRESS: 'En proceso',
  READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado'
})[s] ?? s

const statusClass = (s: string) => ({
  PENDING: 'bg-yellow-100 text-yellow-800',
  PENDING_PAYMENT: 'bg-orange-100 text-orange-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-purple-100 text-purple-800',
  READY: 'bg-green-100 text-green-800',
  DELIVERED: 'bg-gray-100 text-gray-700',
  CANCELLED: 'bg-red-100 text-red-800'
})[s] ?? 'bg-gray-100 text-gray-700'

const loadReport = async () => {
  try {
    loading.value = true
    error.value = ''
    report.value = null

    if (mode.value === 'day') {
      if (!selectedDate.value) return
      const res = await api.get<any>(`/admin/reports/daily?date=${selectedDate.value}`)
      if (res.ok) {
        report.value = {
          ordersCount: res.totals?.orders_count ?? 0,
          totalClp: res.totals?.total_clp ?? 0,
          orders: res.orders ?? [],
          topProducts: res.topProducts ?? []
        }
      }
    } else {
      const mm = String(selectedMonth.value).padStart(2, '0')
      const res = await api.get<any>(`/admin/reports/monthly?year=${selectedYear.value}&month=${mm}`)
      if (res.ok) {
        report.value = {
          ordersCount: res.totals?.orders_count ?? 0,
          totalClp: res.totals?.total_clp ?? 0,
          orders: res.orders ?? [],
          topProducts: res.topProducts ?? []
        }
      }
    }
  } catch (e: any) {
    console.error('Error loading report:', e)
    error.value = e?.data?.error || 'Error al cargar el reporte'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadReport()
})
</script>
