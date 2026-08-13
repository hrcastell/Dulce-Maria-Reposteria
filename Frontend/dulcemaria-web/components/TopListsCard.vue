<template>
  <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 mb-6">
    <div class="flex flex-wrap gap-2 mb-5">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="activeTab === t.key ? 'bg-primary-500 text-white shadow-soft' : 'bg-warm-50 text-warm-600 hover:bg-warm-100'"
        class="px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200"
        @click="activeTab = t.key"
      >
        <span class="mr-1.5">{{ t.icon }}</span>{{ t.label }}
      </button>
    </div>

    <!-- Top Clientes -->
    <div v-if="activeTab === 'customers'">
      <h3 class="text-lg font-semibold text-warm-800 mb-4">Top 10 Clientes por Compra</h3>
      <div v-if="topCustomers.length > 0" class="space-y-2">
        <div
          v-for="(c, index) in topCustomers"
          :key="c.customer_id"
          class="flex items-center justify-between py-3 border-b border-warm-100 last:border-0"
        >
          <div class="flex items-center">
            <span class="text-sm font-semibold text-warm-400 w-7">{{ index + 1 }}.</span>
            <div class="ml-2">
              <p class="text-sm font-medium text-warm-800">{{ c.full_name }}</p>
              <p class="text-xs text-warm-500">{{ c.orders_count }} órdenes</p>
            </div>
          </div>
          <p class="text-sm font-semibold text-warm-800">${{ formatPrice(c.total_clp) }}</p>
        </div>
      </div>
      <div v-else class="text-center py-8 text-warm-400">No hay datos de clientes para este período</div>
    </div>

    <!-- Top Productos -->
    <div v-else-if="activeTab === 'products'">
      <h3 class="text-lg font-semibold text-warm-800 mb-4">Top 10 Productos Más Vendidos</h3>
      <div v-if="topProducts.length > 0" class="space-y-2">
        <div
          v-for="(p, index) in topProducts"
          :key="p.product_id"
          class="flex items-center justify-between py-3 border-b border-warm-100 last:border-0"
        >
          <div class="flex items-center">
            <span class="text-sm font-semibold text-warm-400 w-7">{{ index + 1 }}.</span>
            <div class="ml-2">
              <p class="text-sm font-medium text-warm-800">{{ p.name }}</p>
              <p class="text-xs text-warm-500">{{ p.qty }} unidades</p>
            </div>
          </div>
          <p class="text-sm font-semibold text-warm-800">${{ formatPrice(p.total_clp) }}</p>
        </div>
      </div>
      <div v-else class="text-center py-8 text-warm-400">No hay datos de productos para este período</div>
    </div>

    <!-- Medios de Pago -->
    <div v-else>
      <h3 class="text-lg font-semibold text-warm-800 mb-4">Ventas por Medio de Pago</h3>
      <div v-if="paymentMethods.length > 0" class="h-64 sm:h-80 relative">
        <ClientOnly>
          <PaymentMethodChart :labels="paymentLabels" :counts="paymentCounts" />
          <template #fallback>
            <div class="flex items-center justify-center h-full text-warm-400">Cargando gráfico...</div>
          </template>
        </ClientOnly>
      </div>
      <div v-else class="text-center py-8 text-warm-400">No hay datos de pagos para este período</div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TopCustomer {
  customer_id: string
  full_name: string
  orders_count: number
  total_clp: number
}

interface TopProduct {
  product_id: string
  name: string
  qty: number
  total_clp: number
}

interface PaymentMethodBreakdown {
  payment_method: string
  count: number
}

const props = defineProps<{
  topCustomers: TopCustomer[]
  topProducts: TopProduct[]
  paymentMethods: PaymentMethodBreakdown[]
}>()

const tabs = [
  { key: 'customers' as const, label: 'Top Clientes', icon: '👑' },
  { key: 'products' as const, label: 'Top Productos', icon: '🧁' },
  { key: 'payment' as const, label: 'Medios de Pago', icon: '💳' },
]

const activeTab = ref<'customers' | 'products' | 'payment'>('customers')

const formatPrice = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))

const paymentMethodLabel = (method: string) =>
  ({ CASH: 'Efectivo', TRANSFER: 'Transferencia', ONLINE: 'Online' } as Record<string, string>)[method] ?? method

const paymentLabels = computed(() => props.paymentMethods.map((p) => paymentMethodLabel(p.payment_method)))
const paymentCounts = computed(() => props.paymentMethods.map((p) => p.count))
</script>
