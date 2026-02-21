<template>
  <div class="space-y-4 sm:space-y-6 w-full">
    <!-- Header Info - Centrado en móvil -->
    <div class="flex flex-col items-center text-center gap-3 pb-4 sm:pb-6 border-b border-warm-100">
      <div>
        <h3 class="text-base sm:text-lg font-bold text-warm-800">Orden #{{ order.order_no }}</h3>
        <p class="text-xs sm:text-sm text-warm-500 mt-1">{{ formatDate(order.created_at) }}</p>
      </div>
      <div class="flex flex-wrap justify-center gap-2">
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium text-warm-500 uppercase tracking-wide">Estado:</span>
          <span :class="getStatusBadgeClass(order.status)" class="px-2 py-0.5 rounded-full text-xs font-medium">
            {{ formatStatus(order.status) }}
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium text-warm-500 uppercase tracking-wide">Pago:</span>
          <span :class="getPaymentStatusClass(order.payment_status)" class="px-2 py-0.5 rounded-full text-xs font-medium">
            {{ formatPaymentStatus(order.payment_status) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Customer & Delivery Info - Tarjetas apiladas y centradas -->
    <div class="grid grid-cols-1 gap-3 sm:gap-4">
      <div class="bg-warm-50 rounded-xl p-3 sm:p-4 border border-warm-100">
        <h4 class="text-xs sm:text-sm font-semibold text-warm-800 mb-2 flex items-center gap-1.5">
          <svg class="w-4 h-4 text-warm-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
          </svg>
          Cliente
        </h4>
        <div class="space-y-0.5 text-xs sm:text-sm">
          <p class="font-medium text-warm-900">{{ order.customer_name }}</p>
          <p class="text-warm-600">{{ order.customer_email }}</p>
          <p v-if="order.customer_phone" class="text-warm-600">{{ order.customer_phone }}</p>
        </div>
      </div>

      <div class="bg-warm-50 rounded-xl p-3 sm:p-4 border border-warm-100">
        <h4 class="text-xs sm:text-sm font-semibold text-warm-800 mb-2 flex items-center gap-1.5">
          <svg class="w-4 h-4 text-warm-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/>
          </svg>
          Entrega
        </h4>
        <div class="space-y-0.5 text-xs sm:text-sm">
          <p class="font-medium text-warm-900">
            {{ order.delivery_method === 'PICKUP' ? 'Retiro en Tienda' : 'Despacho a Domicilio' }}
          </p>
          <p v-if="order.delivery_address" class="text-warm-600 break-words">{{ order.delivery_address }}</p>
          <p v-if="order.delivery_date" class="text-warm-600">
            Fecha: {{ formatDateShort(order.delivery_date) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Order Items - Vista de tarjetas en móvil, tabla en desktop -->
    <div>
      <h4 class="text-xs sm:text-sm font-semibold text-warm-800 mb-2 sm:mb-3 text-center sm:text-left">Productos</h4>
      
      <!-- Vista Desktop: Tabla -->
      <div class="hidden sm:block overflow-hidden rounded-xl border border-warm-100">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th scope="col" class="px-3 py-2 text-left text-xs font-medium text-warm-500 uppercase">Producto</th>
              <th scope="col" class="px-3 py-2 text-right text-xs font-medium text-warm-500 uppercase">Precio</th>
              <th scope="col" class="px-3 py-2 text-right text-xs font-medium text-warm-500 uppercase">Cant.</th>
              <th scope="col" class="px-3 py-2 text-right text-xs font-medium text-warm-500 uppercase">Total</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-warm-100">
            <tr v-for="item in order.items" :key="item.id">
              <td class="px-3 py-2">
                <div class="text-xs sm:text-sm font-medium text-warm-900">{{ item.product_name }}</div>
              </td>
              <td class="px-3 py-2 text-right text-xs sm:text-sm text-warm-600 whitespace-nowrap">
                ${{ formatPrice(item.unit_price) }}
              </td>
              <td class="px-3 py-2 text-right text-xs sm:text-sm text-warm-600">
                {{ item.quantity }}
              </td>
              <td class="px-3 py-2 text-right text-xs sm:text-sm font-medium text-warm-900 whitespace-nowrap">
                ${{ formatPrice(item.total_price) }}
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-warm-50">
            <tr>
              <td colspan="3" class="px-3 py-2 text-right text-xs font-medium text-warm-600">Subtotal</td>
              <td class="px-3 py-2 text-right text-xs font-medium text-warm-900">${{ formatPrice(subtotal) }}</td>
            </tr>
            <tr v-if="order.delivery_fee > 0">
              <td colspan="3" class="px-3 py-2 text-right text-xs font-medium text-warm-600">Delivery</td>
              <td class="px-3 py-2 text-right text-xs font-medium text-warm-900">${{ formatPrice(order.delivery_fee) }}</td>
            </tr>
            <tr>
              <td colspan="3" class="px-3 py-2 text-right text-sm font-bold text-warm-800">Total</td>
              <td class="px-3 py-2 text-right text-sm font-bold text-primary-600">${{ formatPrice(order.total_clp) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Vista Mobile: Tarjetas -->
      <div class="sm:hidden space-y-2">
        <div 
          v-for="item in order.items" 
          :key="item.id" 
          class="bg-white rounded-lg p-3 border border-warm-100 shadow-sm"
        >
          <div class="flex justify-between items-start gap-2">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-warm-900 truncate">{{ item.product_name }}</p>
            </div>
            <p class="text-xs font-semibold text-warm-900 whitespace-nowrap">${{ formatPrice(item.total_price) }}</p>
          </div>
          <div class="flex justify-between items-center mt-1 text-xs text-warm-500">
            <span>${{ formatPrice(item.unit_price) }} c/u</span>
            <span>Cant: {{ item.quantity }}</span>
          </div>
        </div>
        
        <!-- Totales Mobile -->
        <div class="bg-warm-50 rounded-lg p-3 border border-warm-100 mt-3 space-y-1">
          <div class="flex justify-between text-xs">
            <span class="text-warm-600">Subtotal</span>
            <span class="font-medium text-warm-900">${{ formatPrice(subtotal) }}</span>
          </div>
          <div v-if="order.delivery_fee > 0" class="flex justify-between text-xs">
            <span class="text-warm-600">Delivery</span>
            <span class="font-medium text-warm-900">${{ formatPrice(order.delivery_fee) }}</span>
          </div>
          <div class="flex justify-between pt-1 border-t border-warm-200">
            <span class="text-sm font-bold text-warm-800">Total</span>
            <span class="text-sm font-bold text-primary-600">${{ formatPrice(order.total_clp) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface OrderItem {
  id: string
  product_name: string
  variant_name?: string
  quantity: number
  unit_price: number
  total_price: number
}

interface OrderDetail {
  id: string
  order_no: number
  created_at: string
  status: string
  payment_status: string
  customer_name: string
  customer_email: string
  customer_phone?: string
  delivery_method: string
  delivery_address?: string
  delivery_date?: string
  delivery_fee: number
  total_clp: number
  items: OrderItem[]
}

const props = defineProps<{
  order: OrderDetail
}>()

const subtotal = computed(() => {
  if (!props.order?.items) return 0
  return props.order.items.reduce((sum, item) => sum + item.total_price, 0)
})

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const formatDate = (date: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('es-CL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatDateShort = (date: string) => {
  if (!date) return ''
  return new Date(date).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
}

const formatStatus = (s: string) => {
  const statusMap: Record<string, string> = {
    'PENDING_PAYMENT': 'Pendiente Pago',
    'PAID': 'Pagado',
    'CONFIRMED': 'Confirmado',
    'PREPARING': 'Preparando',
    'READY': 'Listo',
    'DELIVERED': 'Entregado',
    'CANCELLED': 'Cancelado'
  }
  return statusMap[s] || s
}

const getStatusBadgeClass = (s: string) => {
  const colorMap: Record<string, string> = {
    'PENDING_PAYMENT': 'bg-warning-100 text-warning-700',
    'CONFIRMED': 'bg-info-100 text-info-700',
    'PREPARING': 'bg-primary-100 text-primary-700',
    'READY': 'bg-success-100 text-success-700',
    'DELIVERED': 'bg-warm-100 text-warm-700',
    'CANCELLED': 'bg-error-100 text-error-700'
  }
  return colorMap[s] || 'bg-warm-100 text-warm-700'
}

const formatPaymentStatus = (s: string) => {
  const map: Record<string, string> = {
    'PENDING': 'Pendiente',
    'PAID': 'Pagado',
    'REFUNDED': 'Reembolsado'
  }
  return map[s] || s
}

const getPaymentStatusClass = (s: string) => {
  const map: Record<string, string> = {
    'PENDING': 'bg-warning-100 text-warning-700',
    'PAID': 'bg-success-100 text-success-700',
    'REFUNDED': 'bg-gray-100 text-gray-700'
  }
  return map[s] || 'bg-gray-100 text-gray-700'
}
</script>
