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
        <!-- Date Selector -->
        <div class="mb-6 card">
          <label class="label">Seleccionar Fecha</label>
          <input
            v-model="selectedDate"
            type="date"
            class="input max-w-xs"
            @change="loadReport"
          >
        </div>

        <div v-if="loading" class="text-center py-12">
          <p class="text-gray-500">Cargando reporte...</p>
        </div>

        <div v-else-if="error" class="rounded-md bg-red-50 p-4 mb-4">
          <p class="text-sm text-red-800">{{ error }}</p>
        </div>

        <div v-else-if="report">
          <!-- Summary Cards -->
          <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            <!-- Total Orders -->
            <div class="card">
              <div class="flex items-center">
                <div class="flex-shrink-0">
                  <span class="text-3xl">📦</span>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-600">Total Órdenes</p>
                  <p class="text-2xl font-bold text-gray-900">{{ report.totalOrders }}</p>
                </div>
              </div>
            </div>

            <!-- Total Sales -->
            <div class="card">
              <div class="flex items-center">
                <div class="flex-shrink-0">
                  <span class="text-3xl">💰</span>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-600">Total Ventas</p>
                  <p class="text-2xl font-bold text-primary-600">
                    ${{ formatPrice(report.totalSales) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Average Order -->
            <div class="card">
              <div class="flex items-center">
                <div class="flex-shrink-0">
                  <span class="text-3xl">📊</span>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-600">Promedio por Orden</p>
                  <p class="text-2xl font-bold text-gray-900">
                    ${{ formatPrice(report.totalOrders > 0 ? report.totalSales / report.totalOrders : 0) }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Top Products -->
          <div class="card">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              Productos Más Vendidos
            </h3>

            <div v-if="report.topProducts && report.topProducts.length > 0">
              <div class="space-y-3">
                <div
                  v-for="(product, index) in report.topProducts"
                  :key="product.product_id"
                  class="flex items-center justify-between py-3 border-b border-gray-200 last:border-0"
                >
                  <div class="flex items-center">
                    <span class="text-lg font-semibold text-gray-400 w-8">
                      {{ index + 1 }}.
                    </span>
                    <div class="ml-3">
                      <p class="text-sm font-medium text-gray-900">
                        {{ product.product_name }}
                      </p>
                      <p class="text-xs text-gray-500">
                        {{ product.total_qty }} unidades vendidas
                      </p>
                    </div>
                  </div>
                  <div class="text-right">
                    <p class="text-sm font-semibold text-gray-900">
                      ${{ formatPrice(product.total_revenue) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-8 text-gray-500">
              No hay datos de productos para esta fecha
            </div>
          </div>
        </div>

        <div v-else class="text-center py-12">
          <p class="text-gray-500">Selecciona una fecha para ver el reporte</p>
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

interface TopProduct {
  product_id: string
  product_name: string
  total_qty: number
  total_revenue: number
}

interface Report {
  date: string
  totalOrders: number
  totalSales: number
  topProducts?: TopProduct[]
}

const selectedDate = ref(new Date().toISOString().split('T')[0])
const report = ref<Report | null>(null)
const loading = ref(false)
const error = ref('')

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const loadReport = async () => {
  if (!selectedDate.value) return

  try {
    loading.value = true
    error.value = ''
    
    const response = await api.get<{ ok: boolean; report: Report }>(
      `/admin/reports/daily?date=${selectedDate.value}`
    )
    
    if (response.ok && response.report) {
      report.value = response.report
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
