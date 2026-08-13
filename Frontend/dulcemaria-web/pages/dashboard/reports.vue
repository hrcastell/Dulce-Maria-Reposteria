<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Reportes</h1>
      <p class="mt-1 text-warm-500">Análisis de ventas y métricas del negocio</p>
    </div>

    <!-- Mode Tabs -->
    <div class="flex flex-wrap gap-2 mb-6">
      <button
        :class="mode === 'day' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'"
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="mode = 'day'; loadReport()"
      >
        <span class="mr-2">📅</span> Por Día
      </button>
      <button
        :class="mode === 'month' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'"
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="mode = 'month'; loadReport()"
      >
        <span class="mr-2">📆</span> Por Mes
      </button>
      <button
        :class="mode === 'year' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'"
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="mode = 'year'; loadReport()"
      >
        <span class="mr-2">📈</span> Por Año
      </button>
    </div>

    <!-- Filters -->
    <div class="mb-6 bg-white rounded-2xl shadow-soft border border-warm-100 p-4 sm:p-5">
      <div class="flex flex-wrap gap-4 items-end">
        <div v-if="mode === 'day'" class="flex-1 max-w-xs w-full">
          <label class="block text-sm font-medium text-warm-700 mb-1.5">Fecha</label>
          <input v-model="selectedDate" type="date" class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" @change="loadReport">
        </div>
        <div v-else-if="mode === 'month'" class="flex flex-wrap gap-4 w-full sm:w-auto">
          <div class="w-full sm:w-auto">
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Año</label>
            <input v-model.number="selectedYear" type="number" min="2020" max="2099" class="block w-full sm:w-28 px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" @change="loadReport">
          </div>
          <div class="w-full sm:w-auto">
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Mes</label>
            <select v-model.number="selectedMonth" class="block w-full sm:w-40 px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" @change="loadReport">
              <option v-for="m in months" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
        </div>
        <div v-else class="flex-1 max-w-xs w-full">
          <label class="block text-sm font-medium text-warm-700 mb-1.5">Año</label>
          <input v-model.number="selectedYear" type="number" min="2020" max="2099" class="block w-full sm:w-28 px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" @change="loadReport">
        </div>
        <button 
          class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-warm-100 hover:bg-warm-200 text-warm-700 font-medium rounded-xl transition-all duration-200"
          @click="loadReport"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Actualizar
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center py-12">
      <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-warm-500">Cargando reporte...</p>
    </div>

    <div v-else-if="error" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-error-500 text-xl">⚠️</span>
        <p class="text-error-700">{{ error }}</p>
      </div>
    </div>

    <div v-else-if="mode !== 'year' && report">
      <!-- Summary Cards -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-2xl flex-shrink-0">
              📦
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Total Órdenes</p>
              <p class="text-2xl font-bold text-warm-800">{{ report.ordersCount }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center text-2xl flex-shrink-0">
              💰
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Total Ventas</p>
              <p class="text-2xl font-bold text-primary-600">${{ formatPrice(report.totalClp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 sm:col-span-2 lg:col-span-1">
          <div class="flex items-center">
             <div class="w-12 h-12 rounded-full bg-warm-100 flex items-center justify-center text-2xl flex-shrink-0">
              📊
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Promedio por Orden</p>
              <p class="text-2xl font-bold text-warm-800">
                ${{ formatPrice(report.ordersCount > 0 ? report.totalClp / report.ordersCount : 0) }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Extra KPIs (Por Mes) -->
      <div v-if="mode === 'month'" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center text-2xl flex-shrink-0">🏆</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Día con Más Ventas</p>
              <p class="text-lg font-bold text-warm-800">{{ report.bestSalesDay ? formatDayShort(report.bestSalesDay.day) : 'Sin datos' }}</p>
              <p v-if="report.bestSalesDay" class="text-sm font-semibold text-primary-600">${{ formatPrice(report.bestSalesDay.sales_clp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-error-100 flex items-center justify-center text-2xl flex-shrink-0">📉</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Día con Menos Ventas</p>
              <p class="text-lg font-bold text-warm-800">{{ report.worstSalesDay ? formatDayShort(report.worstSalesDay.day) : 'Sin datos' }}</p>
              <p v-if="report.worstSalesDay" class="text-sm font-semibold text-primary-600">${{ formatPrice(report.worstSalesDay.sales_clp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-warning-100 flex items-center justify-center text-2xl flex-shrink-0">🔥</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Día con Más Órdenes</p>
              <p class="text-lg font-bold text-warm-800">{{ report.mostOrdersDay ? formatDayShort(report.mostOrdersDay.day) : 'Sin datos' }}</p>
              <p v-if="report.mostOrdersDay" class="text-sm font-semibold text-warm-700">{{ report.mostOrdersDay.orders_count }} órdenes</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-info-100 flex items-center justify-center text-2xl flex-shrink-0">👑</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Cliente con Más Órdenes</p>
              <p class="text-lg font-bold text-warm-800">{{ report.topCustomerByOrders ? report.topCustomerByOrders.full_name : 'Sin datos' }}</p>
              <p v-if="report.topCustomerByOrders" class="text-sm font-semibold text-warm-700">{{ report.topCustomerByOrders.orders_count }} órdenes</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-secondary-100 flex items-center justify-center text-2xl flex-shrink-0">💎</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Cliente con Más Compras</p>
              <p class="text-lg font-bold text-warm-800">{{ report.topCustomerBySpend ? report.topCustomerBySpend.full_name : 'Sin datos' }}</p>
              <p v-if="report.topCustomerBySpend" class="text-sm font-semibold text-primary-600">${{ formatPrice(report.topCustomerBySpend.total_clp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-error-100 flex items-center justify-center text-2xl flex-shrink-0">🧾</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Total Gastos</p>
              <p class="text-lg font-bold text-error-600">${{ formatPrice(report.expensesClp ?? 0) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 sm:col-span-2 lg:col-span-1">
          <div class="flex items-center">
            <div :class="monthlyNetProfit >= 0 ? 'bg-success-100' : 'bg-error-100'" class="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0">
              {{ monthlyNetProfit >= 0 ? '📈' : '📉' }}
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Ganancia Neta del Mes</p>
              <p :class="monthlyNetProfit >= 0 ? 'text-success-700' : 'text-error-600'" class="text-lg font-bold">${{ formatPrice(monthlyNetProfit) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Lists (Clientes / Productos / Medios de Pago) -->
      <TopListsCard
        :top-customers="report.topCustomers ?? []"
        :top-products="report.topProducts ?? []"
        :payment-methods="report.paymentMethods ?? []"
      />

      <!-- Orders Grid -->
      <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 mb-6">
        <h3 class="text-lg font-semibold text-warm-800 mb-4">Detalle de Órdenes</h3>
        
        <!-- Desktop Table -->
        <div class="hidden sm:block overflow-x-auto">
           <table class="min-w-full divide-y divide-warm-100">
            <thead class="bg-warm-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">N° Orden</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Fecha</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Cliente</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Total</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Estado</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-warm-100">
              <tr v-if="report.orders && report.orders.length === 0">
                 <td colspan="5" class="px-4 py-8 text-center text-warm-400">No hay órdenes en este período</td>
              </tr>
              <tr v-for="order in report.orders" :key="order.id" class="hover:bg-warm-50/50 transition-colors">
                <td class="px-4 py-3 text-sm font-mono text-warm-700">{{ order.order_number ? `#${order.order_number}` : order.id?.slice(0,8) }}</td>
                <td class="px-4 py-3 text-sm text-warm-600">{{ formatDate(order.created_at) }}</td>
                <td class="px-4 py-3 text-sm text-warm-800">{{ order.customer_name || '—' }}</td>
                <td class="px-4 py-3 text-sm font-semibold text-warm-800">${{ formatPrice(order.total_clp) }}</td>
                <td class="px-4 py-3">
                  <span :class="statusClass(order.status)" class="px-2 py-1 rounded-full text-xs font-medium">
                    {{ statusLabel(order.status) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile List -->
        <div class="sm:hidden space-y-3">
          <div v-if="!report.orders || report.orders.length === 0" class="text-center py-8 text-warm-400">
            No hay órdenes en este período
          </div>
          <div v-for="order in report.orders" :key="order.id" class="bg-white rounded-xl p-4 border border-warm-100 shadow-sm">
            <div class="flex items-start justify-between mb-2">
              <div>
                <span class="text-xs font-mono text-warm-500">#{{ order.order_number || order.id?.slice(0,8) }}</span>
                <h4 class="font-medium text-warm-800">{{ order.customer_name || 'Cliente Ocasional' }}</h4>
              </div>
              <span :class="statusClass(order.status)" class="px-2 py-1 rounded-full text-xs font-medium">
                {{ statusLabel(order.status) }}
              </span>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-warm-50">
              <span class="text-sm text-warm-500">{{ formatDate(order.created_at) }}</span>
              <span class="text-lg font-bold text-warm-800">${{ formatPrice(order.total_clp) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="mode === 'year' && yearlyReport">
      <!-- Summary Cards -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-2xl flex-shrink-0">
              📦
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Total Órdenes</p>
              <p class="text-2xl font-bold text-warm-800">{{ yearlyReport.ordersCount }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center text-2xl flex-shrink-0">
              💰
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Total Ventas</p>
              <p class="text-2xl font-bold text-primary-600">${{ formatPrice(yearlyReport.totalClp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
             <div class="w-12 h-12 rounded-full bg-warm-100 flex items-center justify-center text-2xl flex-shrink-0">
              📊
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Promedio por Orden</p>
              <p class="text-2xl font-bold text-warm-800">
                ${{ formatPrice(yearlyReport.ordersCount > 0 ? yearlyReport.totalClp / yearlyReport.ordersCount : 0) }}
              </p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-error-100 flex items-center justify-center text-2xl flex-shrink-0">
              🧾
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Total Gastos</p>
              <p class="text-2xl font-bold text-error-600">${{ formatPrice(yearlyTotalExpenses) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 sm:col-span-2 lg:col-span-1">
          <div class="flex items-center">
            <div :class="yearlyNetProfit >= 0 ? 'bg-success-100' : 'bg-error-100'" class="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0">
              {{ yearlyNetProfit >= 0 ? '📈' : '📉' }}
            </div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Ganancia Neta</p>
              <p :class="yearlyNetProfit >= 0 ? 'text-success-700' : 'text-error-600'" class="text-2xl font-bold">${{ formatPrice(yearlyNetProfit) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Sales vs Expenses Chart -->
      <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-6 mb-6">
        <h3 class="text-lg font-semibold text-warm-800 mb-4">Ventas vs Gastos por Mes</h3>
        <div class="h-72 sm:h-96 relative">
          <ClientOnly>
            <SalesExpensesChart
              :labels="yearlyChartLabels"
              :sales-data="yearlySalesData"
              :expenses-data="yearlyExpensesData"
            />
            <template #fallback>
              <div class="flex items-center justify-center h-full text-warm-400">
                Cargando gráfico...
              </div>
            </template>
          </ClientOnly>
        </div>
      </div>

      <!-- Top Lists (Clientes / Productos / Medios de Pago) -->
      <TopListsCard
        :top-customers="yearlyReport.topCustomers ?? []"
        :top-products="yearlyReport.topProducts ?? []"
        :payment-methods="yearlyReport.paymentMethods ?? []"
      />

      <!-- Extra KPIs (Por Año) -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-success-100 flex items-center justify-center text-2xl flex-shrink-0">🏆</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Mes con Más Ventas</p>
              <p class="text-lg font-bold text-warm-800">{{ yearlyReport.bestSalesMonth ? monthLabel(yearlyReport.bestSalesMonth.month) : 'Sin datos' }}</p>
              <p v-if="yearlyReport.bestSalesMonth" class="text-sm font-semibold text-primary-600">${{ formatPrice(yearlyReport.bestSalesMonth.sales_clp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-error-100 flex items-center justify-center text-2xl flex-shrink-0">📉</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Mes con Menos Ventas</p>
              <p class="text-lg font-bold text-warm-800">{{ yearlyReport.worstSalesMonth ? monthLabel(yearlyReport.worstSalesMonth.month) : 'Sin datos' }}</p>
              <p v-if="yearlyReport.worstSalesMonth" class="text-sm font-semibold text-primary-600">${{ formatPrice(yearlyReport.worstSalesMonth.sales_clp) }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-warning-100 flex items-center justify-center text-2xl flex-shrink-0">🔥</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Mes con Más Órdenes</p>
              <p class="text-lg font-bold text-warm-800">{{ yearlyReport.mostOrdersMonth ? monthLabel(yearlyReport.mostOrdersMonth.month) : 'Sin datos' }}</p>
              <p v-if="yearlyReport.mostOrdersMonth" class="text-sm font-semibold text-warm-700">{{ yearlyReport.mostOrdersMonth.orders_count }} órdenes</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-info-100 flex items-center justify-center text-2xl flex-shrink-0">👑</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Cliente con Más Órdenes</p>
              <p class="text-lg font-bold text-warm-800">{{ yearlyReport.topCustomerByOrders ? yearlyReport.topCustomerByOrders.full_name : 'Sin datos' }}</p>
              <p v-if="yearlyReport.topCustomerByOrders" class="text-sm font-semibold text-warm-700">{{ yearlyReport.topCustomerByOrders.orders_count }} órdenes</p>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 sm:col-span-2 lg:col-span-1">
          <div class="flex items-center">
            <div class="w-12 h-12 rounded-full bg-secondary-100 flex items-center justify-center text-2xl flex-shrink-0">💎</div>
            <div class="ml-4">
              <p class="text-sm text-warm-500">Cliente con Más Compras</p>
              <p class="text-lg font-bold text-warm-800">{{ yearlyReport.topCustomerBySpend ? yearlyReport.topCustomerBySpend.full_name : 'Sin datos' }}</p>
              <p v-if="yearlyReport.topCustomerBySpend" class="text-sm font-semibold text-primary-600">${{ formatPrice(yearlyReport.topCustomerBySpend.total_clp) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="!loading && !error && !hasAnyReport" class="text-center py-12">
      <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <span class="text-4xl">📊</span>
      </div>
      <h3 class="text-lg font-semibold text-warm-800 mb-2">Selecciona un período</h3>
      <p class="text-warm-500">Elige una fecha, mes o año para ver el reporte detallado</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Reportes | Dulce María'
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

interface TopCustomer {
  customer_id: string
  full_name: string
  orders_count: number
  total_clp: number
}

interface DaySalesExtreme {
  day: string
  sales_clp: number
}

interface DayOrdersExtreme {
  day: string
  orders_count: number
}

interface MonthSalesExtreme {
  month: number
  sales_clp: number
}

interface MonthOrdersExtreme {
  month: number
  orders_count: number
}

interface MonthlyBreakdownItem {
  month: number
  orders_count: number
  sales_clp: number
  expenses_clp: number
}

interface PaymentMethodBreakdown {
  payment_method: string
  count: number
}

interface Report {
  ordersCount: number
  totalClp: number
  expensesClp?: number
  orders?: OrderRow[]
  topProducts?: TopProduct[]
  bestSalesDay?: DaySalesExtreme | null
  worstSalesDay?: DaySalesExtreme | null
  mostOrdersDay?: DayOrdersExtreme | null
  topCustomerByOrders?: TopCustomer | null
  topCustomerBySpend?: TopCustomer | null
  topCustomers?: TopCustomer[]
  paymentMethods?: PaymentMethodBreakdown[]
}

interface YearlyReport {
  ordersCount: number
  totalClp: number
  monthlyBreakdown: MonthlyBreakdownItem[]
  bestSalesMonth?: MonthSalesExtreme | null
  worstSalesMonth?: MonthSalesExtreme | null
  mostOrdersMonth?: MonthOrdersExtreme | null
  topCustomerByOrders?: TopCustomer | null
  topCustomerBySpend?: TopCustomer | null
  topCustomers?: TopCustomer[]
  topProducts?: TopProduct[]
  paymentMethods?: PaymentMethodBreakdown[]
}

const now = new Date()
const selectedDate = ref(now.toISOString().split('T')[0])
const selectedYear = ref(now.getFullYear())
const selectedMonth = ref(now.getMonth() + 1)
const mode = ref<'day' | 'month' | 'year'>('day')
const report = ref<Report | null>(null)
const yearlyReport = ref<YearlyReport | null>(null)
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

// Las fechas de bestSalesDay/worstSalesDay/mostOrdersDay vienen como "YYYY-MM-DD"
// (sin hora). Se formatean con split en lugar de `new Date()` para evitar
// corrimientos de un día por conversión de zona horaria.
const formatDayShort = (day: string) => {
  const [y, m, d] = day.split('-')
  return `${d}-${m}-${y}`
}

const monthLabel = (m: number) =>
  months.find((x) => x.value === m)?.label ?? String(m)

const hasAnyReport = computed(() =>
  mode.value === 'year' ? !!yearlyReport.value : !!report.value
)

const yearlyChartLabels = computed(() => months.map((m) => m.label))
const yearlySalesData = computed(() => yearlyReport.value?.monthlyBreakdown.map((m) => m.sales_clp) ?? [])
const yearlyExpensesData = computed(() => yearlyReport.value?.monthlyBreakdown.map((m) => m.expenses_clp) ?? [])
const yearlyTotalExpenses = computed(() =>
  yearlyReport.value?.monthlyBreakdown.reduce((sum, m) => sum + m.expenses_clp, 0) ?? 0
)
const yearlyNetProfit = computed(() => (yearlyReport.value?.totalClp ?? 0) - yearlyTotalExpenses.value)
const monthlyNetProfit = computed(() => (report.value?.totalClp ?? 0) - (report.value?.expensesClp ?? 0))

const statusLabel = (s: string) => ({
  PENDING: 'Pendiente', PENDING_PAYMENT: 'Pend. Pago',
  CONFIRMED: 'Confirmado', IN_PROGRESS: 'En proceso',
  READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado'
})[s] ?? s

const statusClass = (s: string) => ({
  PENDING: 'bg-warning-100 text-warning-700',
  PENDING_PAYMENT: 'bg-warning-100 text-warning-700',
  CONFIRMED: 'bg-info-100 text-info-700',
  IN_PROGRESS: 'bg-primary-100 text-primary-700',
  READY: 'bg-success-100 text-success-700',
  DELIVERED: 'bg-warm-100 text-warm-700',
  CANCELLED: 'bg-error-100 text-error-700'
})[s] ?? 'bg-warm-100 text-warm-700'

const loadReport = async () => {
  try {
    loading.value = true
    error.value = ''
    report.value = null
    yearlyReport.value = null

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
    } else if (mode.value === 'month') {
      const mm = String(selectedMonth.value).padStart(2, '0')
      const res = await api.get<any>(`/admin/reports/monthly?year=${selectedYear.value}&month=${mm}`)
      if (res.ok) {
        report.value = {
          ordersCount: res.totals?.orders_count ?? 0,
          totalClp: res.totals?.total_clp ?? 0,
          expensesClp: res.totals?.expenses_clp ?? 0,
          orders: res.orders ?? [],
          topProducts: res.topProducts ?? [],
          bestSalesDay: res.bestSalesDay ?? null,
          worstSalesDay: res.worstSalesDay ?? null,
          mostOrdersDay: res.mostOrdersDay ?? null,
          topCustomerByOrders: res.topCustomerByOrders ?? null,
          topCustomerBySpend: res.topCustomerBySpend ?? null,
          topCustomers: res.topCustomers ?? [],
          paymentMethods: res.salesByPaymentMethod ?? []
        }
      }
    } else {
      const res = await api.get<any>(`/admin/reports/yearly?year=${selectedYear.value}`)
      if (res.ok) {
        yearlyReport.value = {
          ordersCount: res.totals?.orders_count ?? 0,
          totalClp: res.totals?.total_clp ?? 0,
          monthlyBreakdown: res.monthlyBreakdown ?? [],
          bestSalesMonth: res.bestSalesMonth ?? null,
          worstSalesMonth: res.worstSalesMonth ?? null,
          mostOrdersMonth: res.mostOrdersMonth ?? null,
          topCustomerByOrders: res.topCustomerByOrders ?? null,
          topCustomerBySpend: res.topCustomerBySpend ?? null,
          topCustomers: res.topCustomers ?? [],
          topProducts: res.topProducts ?? [],
          paymentMethods: res.salesByPaymentMethod ?? []
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
