<template>
  <div class="space-y-6">
    <div v-if="error" class="rounded-xl bg-error-50 p-4 border border-error-100 flex items-start gap-3">
      <span class="text-error-500 mt-0.5">⚠️</span>
      <p class="text-sm text-error-700">{{ error }}</p>
    </div>

    <!-- Customer Selection -->
    <div class="bg-white p-5 rounded-2xl border border-warm-100 shadow-sm">
      <label class="block text-sm font-semibold text-warm-700 mb-2">Cliente *</label>
      <div class="flex gap-2 relative">
        <div class="flex-1 relative" ref="customerDropdownRef">
          <input
            type="text"
            v-model="customerSearch"
            placeholder="Buscar cliente por nombre..."
            class="block w-full pl-4 pr-10 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white"
            @focus="showCustomerDropdown = true"
            @input="showCustomerDropdown = true"
          />
          <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-warm-400">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          </div>

          <!-- Dropdown List -->
          <div 
            v-if="showCustomerDropdown && filteredCustomers.length > 0"
            class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg max-h-60 overflow-y-auto"
          >
            <div
              v-for="customer in filteredCustomers"
              :key="customer.id"
              class="px-4 py-2 hover:bg-primary-50 cursor-pointer transition-colors border-b border-warm-50 last:border-0"
              @click="selectCustomer(customer)"
            >
              <div class="font-medium text-warm-800">{{ customer.full_name }}</div>
              <div class="text-xs text-warm-500">{{ customer.phone || 'Sin teléfono' }}</div>
            </div>
          </div>
          <div 
            v-else-if="showCustomerDropdown && customerSearch"
            class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg p-4 text-center text-warm-500"
          >
            No se encontraron clientes
          </div>
        </div>

        <button 
          type="button"
          class="px-4 py-2 bg-primary-100 hover:bg-primary-200 text-primary-700 rounded-xl font-medium transition-colors flex items-center gap-2"
          @click="showNewCustomerModal = true"
        >
          <span class="text-lg leading-none">+</span>
          <span class="hidden sm:inline">Nuevo</span>
        </button>
      </div>
      <div v-if="selectedCustomer" class="mt-2 flex items-center gap-2 text-sm text-primary-700 bg-primary-50 px-3 py-1.5 rounded-lg inline-block">
        <span class="font-bold">✓ Seleccionado:</span>
        {{ selectedCustomer.full_name }}
        <button @click="clearCustomerSelection" class="ml-2 text-primary-400 hover:text-primary-600 font-bold">×</button>
      </div>
      <p v-if="loadingCustomers" class="text-xs text-warm-400 mt-2 ml-1">Cargando clientes...</p>
    </div>

    <!-- Order Date -->
    <div class="bg-white p-5 rounded-2xl border border-warm-100 shadow-sm">
      <label class="block text-sm font-semibold text-warm-700 mb-2">Fecha de la Orden *</label>
      <input
        type="date"
        v-model="form.orderDate"
        :max="todayStr"
        required
        class="block w-full sm:w-56 px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white"
      >
      <p class="text-xs text-warm-400 mt-1.5">Por defecto es hoy. Cambiala si estás registrando una venta de un día anterior.</p>
    </div>

    <!-- Items -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-warm-800">Productos</h3>
        <button
          type="button"
          class="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
          @click="openAddItemModal"
        >
          + Agregar producto
        </button>
      </div>

      <div v-if="form.items.length === 0" class="text-center py-8 bg-warm-50 rounded-2xl border border-dashed border-warm-200 text-sm text-warm-500">
        Aún no has agregado productos
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="(item, index) in form.items"
          :key="index"
          class="flex items-center justify-between gap-3 bg-white px-4 py-3 rounded-xl border border-warm-100 shadow-sm"
        >
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-warm-800 truncate">{{ itemSummaryText(item) }}</p>
            <p class="text-xs text-warm-400">${{ formatPrice(calculateLineTotal(item)) }}</p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" class="p-2 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" aria-label="Editar" @click="openEditItemModal(index)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </button>
            <button type="button" class="p-2 text-warm-400 hover:text-error-500 hover:bg-error-50 rounded-lg transition-colors" aria-label="Eliminar" @click="removeItem(index)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Totals & Adjustments -->
    <div class="bg-white p-5 rounded-2xl border border-warm-100 shadow-sm space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <!-- Payment & Delivery -->
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-warm-700 mb-1.5 uppercase tracking-wide">Pago</label>
            <select v-model="form.paymentMethod" class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white">
              <option value="TRANSFER">Transferencia</option>
              <option value="CASH">Efectivo</option>
              <option value="ONLINE">Online</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-warm-700 mb-1.5 uppercase tracking-wide">Estado</label>
            <select v-model="form.paymentStatus" class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white">
              <option value="PENDING">Pendiente</option>
              <option value="PAID">Pagado</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-warm-700 mb-1.5 uppercase tracking-wide">Entrega</label>
            <select v-model="form.deliveryMethod" class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white" @change="updateDeliveryFee">
              <option value="PICKUP">Retiro</option>
              <option value="DELIVERY">Delivery</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-semibold text-warm-700 mb-1.5 uppercase tracking-wide">Costo Delivery</label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 text-sm">$</span>
              <input
                v-model.number="form.deliveryFeeClp"
                type="number"
                min="0"
                class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white pl-6"
                :disabled="form.deliveryMethod === 'PICKUP'"
              >
            </div>
          </div>
        </div>

        <!-- Price Breakdown -->
        <div class="bg-warm-50 rounded-xl p-4 space-y-2">
          <div class="flex justify-between text-sm text-warm-600">
            <span>Subtotal:</span>
            <span>${{ formatPrice(subtotal) }}</span>
          </div>
          <div class="flex justify-between text-sm text-warm-600">
            <span>Delivery:</span>
            <span>${{ formatPrice(form.deliveryFeeClp) }}</span>
          </div>
          
          <!-- Discount -->
          <div class="flex justify-between items-center text-sm text-warm-600">
            <span>Descuento:</span>
            <div class="flex items-center w-24">
               <span class="text-warm-400 mr-1">-$</span>
               <input 
                 v-model.number="form.discountAmountClp" 
                 type="number" 
                 min="0" 
                 class="w-full bg-white border border-warm-200 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
               >
            </div>
          </div>

          <div class="border-t border-warm-200 my-2"></div>

          <!-- Total Calculation -->
          <div class="flex justify-between items-center">
            <span class="font-bold text-warm-800">Total Calculado:</span>
            <span class="font-bold text-warm-800">${{ formatPrice(calculatedTotal) }}</span>
          </div>

          <!-- Override -->
          <div class="mt-3 pt-3 border-t border-dashed border-warm-200">
            <label class="flex items-center justify-between cursor-pointer">
               <span class="text-xs font-medium text-primary-700">¿Ajustar precio final manual?</span>
               <input type="checkbox" v-model="enableOverride" class="rounded text-primary-500 border-warm-300">
            </label>
            <div v-if="enableOverride" class="mt-2 flex items-center justify-between">
               <span class="text-sm font-bold text-primary-700">Precio Final:</span>
               <div class="relative w-32">
                 <span class="absolute left-3 top-1/2 -translate-y-1/2 text-primary-700 font-bold">$</span>
                 <input 
                   v-model.number="form.finalPriceOverrideClp" 
                   type="number" 
                   min="0" 
                   class="w-full bg-white border-2 border-primary-200 rounded-lg pl-6 pr-3 py-1.5 text-right font-bold text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-400"
                 >
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <SidePanel
      v-model="showNewCustomerModal"
      title="Nuevo Cliente"
      :hide-submit="true"
    >
      <CustomerForm
        ref="customerFormRef"
        :existing-customers="customers"
        @submit="handleCreateCustomer"
      />
      <div class="mt-4 flex justify-end">
        <button
          class="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-xl font-medium transition-colors"
          :disabled="creatingCustomer"
          @click="customerFormRef?.submit()"
        >
          {{ creatingCustomer ? 'Guardando...' : 'Guardar Cliente' }}
        </button>
      </div>
    </SidePanel>

    <Modal
      v-model="showItemModal"
      :title="editingItemIndex === null ? 'Agregar Producto' : 'Editar Producto'"
      submit-text="Aceptar"
      @submit="confirmItemModal"
    >
      <div class="space-y-4">
        <div v-if="itemModalError" class="rounded-xl bg-error-50 p-3 border border-error-100 text-sm text-error-700">
          {{ itemModalError }}
        </div>

        <div>
          <label class="block text-xs font-medium text-warm-500 mb-1">Producto</label>
          <div class="relative">
            <input
              type="text"
              v-model="draftItem._productSearch"
              placeholder="Buscar producto..."
              class="block w-full pl-3 pr-8 py-2.5 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              @focus="draftItem._showProductDropdown = true"
              @input="draftItem._showProductDropdown = true"
              @blur="draftItem._showProductDropdown = false"
            />
            <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-warm-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </div>
            <div v-if="draftItem._showProductDropdown && filteredProductsFor(draftItem).length > 0" class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
              <div v-for="p in filteredProductsFor(draftItem)" :key="p.id" class="px-4 py-2 hover:bg-primary-50 cursor-pointer transition-colors text-sm border-b border-warm-50 last:border-0" @mousedown.prevent="selectProduct(draftItem, p)">
                <div class="font-medium text-warm-800">{{ p.name }}</div>
                <div class="text-xs text-warm-500">${{ formatPrice(p.price_clp) }} · Stock: {{ p.stock_qty }}</div>
              </div>
            </div>
            <div v-else-if="draftItem._showProductDropdown && draftItem._productSearch" class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg p-3 text-center text-xs text-warm-500">
              No se encontraron productos
            </div>
          </div>
          <div v-if="draftItem.productId" class="mt-2 flex items-center gap-2 text-xs text-primary-700 bg-primary-50 px-2 py-1 rounded-lg inline-block">
            <span class="font-bold">✓</span> {{ selectedProductName(draftItem) }}
            <button type="button" class="ml-1 text-primary-400 hover:text-primary-600 font-bold" @click="clearProductSelection(draftItem)">×</button>
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-warm-500 mb-1">Variante</label>
          <select v-model="draftItem.variantId" class="block w-full px-3 py-2.5 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-warm-50 disabled:text-warm-400" :disabled="!draftItem._variants || draftItem._variants.length === 0">
            <option value="">{{ draftItem._variants?.length ? 'Seleccionar...' : 'N/A' }}</option>
            <option v-for="v in draftItem._variants" :key="v.id" :value="v.id" :disabled="!v.is_active || v.stock_qty <= 0">
              {{ v.name }} (${{ formatPrice(v.price_override_clp || draftItem._basePrice) }}) - Stock: {{ v.stock_qty }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium text-warm-500 mb-1">Cantidad</label>
          <input v-model.number="draftItem.qty" type="number" min="1" class="block w-full px-3 py-2.5 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
        </div>

        <div v-if="draftItem._toppings && draftItem._toppings.length > 0">
          <p class="text-xs font-medium text-warm-500 mb-2">Toppings / Adicionales</p>
          <div class="flex flex-wrap gap-2">
            <label v-for="t in draftItem._toppings" :key="t.id" class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors" :class="draftItem.toppings.includes(t.id) ? 'bg-primary-50 border-primary-200 text-primary-800' : 'bg-white border-warm-200 text-warm-600 hover:bg-warm-50'">
              <input type="checkbox" :value="t.id" v-model="draftItem.toppings" class="rounded text-primary-500 focus:ring-primary-400 border-warm-300">
              <span>{{ t.name }}</span>
              <span v-if="t.price_clp > 0" class="text-xs font-semibold ml-1">+${{ formatPrice(t.price_clp) }}</span>
            </label>
          </div>
        </div>

        <div v-if="draftItem.productId" class="flex justify-between items-center pt-3 border-t border-warm-100 text-sm">
          <span class="text-warm-500">Total línea:</span>
          <span class="font-bold text-warm-800">${{ formatPrice(calculateLineTotal(draftItem)) }}</span>
        </div>
      </div>
    </Modal>

    <!-- NoticeDialog local a este componente — feedback del flujo "+ Nuevo"
         cliente, no accede al NoticeDialog de orders.vue -->
    <NoticeDialog
      v-model="showNotice"
      :variant="noticeVariant"
      :message="noticeMessage"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useApi } from '@/composables/useApi'

const api = useApi()

const emit = defineEmits<{
  submit: [data: any]
}>()

// Modo edición: el padre (orders.vue) ya hizo el fetch de GET /admin/orders/:id
// (cabecera + items) antes de abrir el panel — este componente no hace su
// propio fetch de detalle, solo hidrata `form` a partir de estas props.
const props = withDefaults(defineProps<{
  order?: any | null
  orderItems?: any[]
}>(), {
  order: null,
  orderItems: () => []
})

interface Product {
  id: string
  name: string
  price_clp: number
  stock_qty: number
  is_active: boolean
}

interface Variant {
  id: string
  name: string
  price_override_clp: number | null
  stock_qty: number
  is_active: boolean
}

interface Topping {
  id: string
  name: string
  price_clp: number
  type: string
}

interface OrderItem {
  productId: string
  variantId: string
  toppings: string[]
  qty: number
  _variants?: Variant[]
  _toppings?: Topping[]
  _basePrice: number
  _productSearch?: string
  _showProductDropdown?: boolean
}

interface Customer {
  id: string
  full_name: string
  phone?: string
  email?: string
}

const createEmptyItem = (): OrderItem => ({
  productId: '', variantId: '', toppings: [], qty: 1, _basePrice: 0, _productSearch: '', _showProductDropdown: false
})

// OJO: NO usar toISOString() acá — siempre convierte a UTC, así que después
// de cierta hora local (ej. ~21:00 en Chile, UTC-3) ya cae en el día
// siguiente en UTC y el default salta de fecha antes de tiempo. Se arma la
// fecha con los componentes locales del Date (hora del dispositivo). Mismo
// helper se reutiliza para precargar `orderDate` en modo edición desde
// `order.created_at` — nunca toISOString() ahí tampoco.
const toLocalDateStr = (d: Date) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayStr = toLocalDateStr(new Date())

const form = ref({
  customerId: '',
  orderDate: todayStr,
  items: [] as OrderItem[],
  paymentMethod: 'TRANSFER',
  paymentStatus: 'PAID',
  deliveryMethod: 'PICKUP',
  deliveryFeeClp: 0,
  discountAmountClp: 0,
  finalPriceOverrideClp: null as number | null
})

const customers = ref<Customer[]>([])
const products = ref<Product[]>([])
const loadingCustomers = ref(false)
const loadingProducts = ref(false)
const error = ref('')
const enableOverride = ref(false)

const showNewCustomerModal = ref(false)
const creatingCustomer = ref(false)
const customerFormRef = ref<any>(null)

// NoticeDialog local — feedback de éxito/error del flujo "+ Nuevo" cliente.
const showNotice = ref(false)
const noticeVariant = ref<'success' | 'error'>('success')
const noticeMessage = ref('')

const showItemModal = ref(false)
const editingItemIndex = ref<number | null>(null)
const draftItem = ref<OrderItem>(createEmptyItem())
const itemModalError = ref('')

// Helpers
const formatPrice = (price: number) => new Intl.NumberFormat('es-CL').format(Math.round(price || 0))

const calculateLineTotal = (item: OrderItem) => {
  if (!item.productId) return 0
  
  let unitPrice = item._basePrice
  
  // Variant price override
  if (item.variantId && item._variants) {
    const v = item._variants.find(v => v.id === item.variantId)
    if (v && v.price_override_clp !== null) {
      unitPrice = v.price_override_clp
    }
  }
  
  // Add toppings
  if (item.toppings && item.toppings.length > 0 && item._toppings) {
    item.toppings.forEach(tid => {
      const t = item._toppings?.find(x => x.id === tid)
      if (t) unitPrice += t.price_clp
    })
  }
  
  return unitPrice * item.qty
}

const subtotal = computed(() => {
  return form.value.items.reduce((sum, item) => sum + calculateLineTotal(item), 0)
})

const calculatedTotal = computed(() => {
  const base = subtotal.value + (form.value.deliveryFeeClp || 0) - (form.value.discountAmountClp || 0)
  return Math.max(0, base)
})

// Actions
const removeItem = (index: number) => {
  form.value.items.splice(index, 1)
}

const updateDeliveryFee = () => {
  if (form.value.deliveryMethod === 'PICKUP') {
    form.value.deliveryFeeClp = 0
  }
}

// Fetch de variantes/toppings/basePrice para un item que ya tiene productId
// seteado. Compartido por onProductChange (selección nueva desde el modal,
// que resetea variantId/toppings antes de llamar) y por la hidratación de
// items al abrir el form en modo edición (mantiene el variantId/toppings que
// ya traía la orden, solo completa los catálogos _variants/_toppings).
const fetchItemProductDetails = async (item: OrderItem) => {
  if (!item.productId) return

  const prod = products.value.find(p => p.id === item.productId)
  if (prod) item._basePrice = prod.price_clp

  try {
    const [resVar, resTop] = await Promise.all([
      api.get<{ ok: boolean; items: Variant[] }>(`/admin/products/${item.productId}/variants`),
      api.get<{ ok: boolean; items: Topping[] }>(`/admin/products/${item.productId}/toppings`)
    ])

    if (resVar.ok) item._variants = resVar.items || []
    if (resTop.ok) item._toppings = resTop.items || []

  } catch (e) {
    console.error('Error fetching details for product', item.productId, e)
  }
}

const onProductChange = async (item: OrderItem) => {
  item.variantId = ''
  item.toppings = []
  item._variants = []
  item._toppings = []
  item._basePrice = 0

  if (!item.productId) return

  await fetchItemProductDetails(item)
}

const filteredProductsFor = (item: OrderItem) => {
  const pool = products.value.filter(p => p.is_active && p.stock_qty > 0)
  if (!item._productSearch) return pool.slice(0, 10)
  const lower = item._productSearch.toLowerCase()
  return pool.filter(p => p.name.toLowerCase().includes(lower)).slice(0, 10)
}

const selectedProductName = (item: OrderItem) =>
  products.value.find(p => p.id === item.productId)?.name || ''

const selectProduct = (item: OrderItem, product: Product) => {
  item.productId = product.id
  item._productSearch = ''
  item._showProductDropdown = false
  onProductChange(item)
}

const clearProductSelection = (item: OrderItem) => {
  item.productId = ''
  item._productSearch = ''
  item.variantId = ''
  item._variants = []
  item._toppings = []
  item._basePrice = 0
}

const openAddItemModal = () => {
  editingItemIndex.value = null
  draftItem.value = createEmptyItem()
  itemModalError.value = ''
  showItemModal.value = true
}

const openEditItemModal = (index: number) => {
  editingItemIndex.value = index
  const original = form.value.items[index]
  // OJO: clonar `toppings` con spread es OBLIGATORIO. v-model de checkboxes
  // muta el array in-place; sin este clon, tocar un checkbox en el modal
  // mutaría el item original ANTES de confirmar, y "Cancelar" no revertiría nada.
  draftItem.value = { ...original, toppings: [...original.toppings] }
  itemModalError.value = ''
  showItemModal.value = true
}

const confirmItemModal = () => {
  if (!draftItem.value.productId) {
    itemModalError.value = 'Debes seleccionar un producto'
    return
  }
  if (draftItem.value._variants && draftItem.value._variants.length > 0 && !draftItem.value.variantId) {
    itemModalError.value = 'Debes seleccionar una variante'
    return
  }
  if (!draftItem.value.qty || draftItem.value.qty < 1) {
    itemModalError.value = 'La cantidad debe ser al menos 1'
    return
  }
  itemModalError.value = ''
  if (editingItemIndex.value === null) {
    form.value.items.push(draftItem.value)
  } else {
    form.value.items[editingItemIndex.value] = draftItem.value
  }
  showItemModal.value = false
}

const itemSummaryText = (item: OrderItem) => {
  const name = selectedProductName(item) || 'Producto'
  const variant = item._variants?.find(v => v.id === item.variantId)
  const toppingNames = (item._toppings || []).filter(t => item.toppings.includes(t.id)).map(t => t.name)
  let text = name
  if (variant) text += ` — ${variant.name}`
  text += ` x${item.qty}`
  if (toppingNames.length > 0) text += ` (+ ${toppingNames.join(', ')})`
  return text
}

const loadCustomers = async () => {
  try {
    loadingCustomers.value = true
    const response = await api.get<{ ok: boolean; items: Customer[] }>('/admin/customers')
    if (response.ok && response.items) {
      customers.value = response.items.sort((a, b) => a.full_name.localeCompare(b.full_name))
    }
  } catch (e) {
    console.error('Error loading customers:', e)
  } finally {
    loadingCustomers.value = false
  }
}

const loadProducts = async () => {
  try {
    loadingProducts.value = true
    const response = await api.get<{ ok: boolean; items: Product[] }>('/admin/products')
    if (response.ok && response.items) {
      products.value = response.items.sort((a, b) => a.name.localeCompare(b.name))
    }
  } catch (e) {
    console.error('Error loading products:', e)
  } finally {
    loadingProducts.value = false
  }
}

const handleCreateCustomer = async (data: any) => {
  creatingCustomer.value = true
  try {
    const res = await api.post<{ ok: boolean; customer: Customer }>('/admin/customers', data)
    if (res.ok && res.customer) {
      customers.value.push(res.customer)
      customers.value.sort((a, b) => a.full_name.localeCompare(b.full_name))
      form.value.customerId = res.customer.id
      showNewCustomerModal.value = false
      noticeVariant.value = 'success'
      noticeMessage.value = 'Cliente creado correctamente.'
      showNotice.value = true
    }
  } catch (e: any) {
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al crear cliente'
    showNotice.value = true
  } finally {
    creatingCustomer.value = false
  }
}

const validate = () => {
  if (!form.value.customerId) {
    error.value = 'Debe seleccionar un cliente'
    return false
  }
  
  if (form.value.items.length === 0) {
    error.value = 'Debe agregar al menos un producto'
    return false
  }
  
  for (const item of form.value.items) {
    if (!item.productId) {
      error.value = 'Todos los productos deben estar seleccionados'
      return false
    }
    
    // Check stock if variant selected
    if (item.variantId && item._variants) {
        const v = item._variants.find(x => x.id === item.variantId)
        if (v && item.qty > v.stock_qty) {
            error.value = `Stock insuficiente para la variante seleccionada (${v.name}). Disponible: ${v.stock_qty}`
            return false
        }
    } else {
        // Check base product stock if no variants exist (or mandatory?)
        // If product has variants, stock is usually 0 on parent unless sync trigger worked.
        // But logic says: if variants exist, user MUST select one?
        // Let's enforce variant selection if variants exist.
        if (item._variants && item._variants.length > 0 && !item.variantId) {
            error.value = `Debe seleccionar una variante para el producto`
            return false
        }
        
        // If simple product
        if ((!item._variants || item._variants.length === 0)) {
             const p = products.value.find(x => x.id === item.productId)
             if (p && item.qty > p.stock_qty) {
                 error.value = `Stock insuficiente para ${p.name}. Disponible: ${p.stock_qty}`
                 return false
             }
        }
    }
  }
  
  error.value = ''
  return true
}

const submit = () => {
  if (validate()) {
    // Transform to payload matching API
    const payload = {
      customerId: form.value.customerId,
      orderDate: form.value.orderDate,
      items: form.value.items.map(i => ({
        productId: i.productId,
        qty: i.qty,
        variantId: i.variantId || null,
        toppings: i.toppings
      })),
      paymentMethod: form.value.paymentMethod,
      paymentStatus: form.value.paymentStatus,
      deliveryMethod: form.value.deliveryMethod,
      deliveryFeeClp: form.value.deliveryFeeClp,
      discountAmountClp: form.value.discountAmountClp,
      finalPriceOverrideClp: enableOverride.value ? form.value.finalPriceOverrideClp : null
    }
    
    emit('submit', payload)
  }
}

const customerSearch = ref('')
const showCustomerDropdown = ref(false)
const customerDropdownRef = ref<HTMLElement | null>(null)

const selectedCustomer = computed(() => {
  return customers.value.find(c => c.id === form.value.customerId)
})

const filteredCustomers = computed(() => {
  if (!customerSearch.value) return customers.value.slice(0, 10)
  const lower = customerSearch.value.toLowerCase()
  return customers.value
    .filter(c => c.full_name?.toLowerCase().includes(lower) || c.phone?.includes(lower))
    .slice(0, 10)
})

const selectCustomer = (customer: Customer) => {
  form.value.customerId = customer.id
  customerSearch.value = ''
  showCustomerDropdown.value = false
}

const clearCustomerSelection = () => {
  form.value.customerId = ''
  customerSearch.value = ''
}

// Modo edición: puebla `form` con la cabecera (`props.order`) y los items
// (`props.orderItems`) que el padre ya trajo con GET /admin/orders/:id.
// Requiere que `products` ya esté cargado (ver onMounted) para resolver
// `_basePrice` de cada línea vía fetchItemProductDetails.
const populateFormFromOrder = async () => {
  const order = props.order
  if (!order) return

  form.value.customerId = order.customer_id
  form.value.orderDate = toLocalDateStr(new Date(order.created_at))
  form.value.paymentMethod = order.payment_method
  form.value.paymentStatus = order.payment_status
  form.value.deliveryMethod = order.delivery_method
  form.value.deliveryFeeClp = order.delivery_fee_clp
  form.value.discountAmountClp = order.discount_amount_clp

  if (order.final_price_override_clp !== null && order.final_price_override_clp !== undefined) {
    enableOverride.value = true
    form.value.finalPriceOverrideClp = order.final_price_override_clp
  }

  const items: OrderItem[] = (props.orderItems || []).map((oi: any) => ({
    productId: oi.product_id,
    variantId: oi.variant_id || '',
    qty: oi.qty,
    toppings: JSON.parse(oi.selected_toppings || '[]').map((t: any) => t.id),
    _basePrice: 0,
    _productSearch: '',
    _showProductDropdown: false
  }))
  form.value.items = items

  await Promise.all(items.map(fetchItemProductDetails))
}

// Close dropdown when clicking outside
onMounted(async () => {
  document.addEventListener('click', (e) => {
    if (customerDropdownRef.value && !customerDropdownRef.value.contains(e.target as Node)) {
      showCustomerDropdown.value = false
    }
  })

  await Promise.all([loadCustomers(), loadProducts()])

  if (props.order) {
    await populateFormFromOrder()
  }
})

defineExpose({ submit })
</script>

<style scoped>
.label {
  @apply block text-xs font-semibold text-warm-700 mb-1.5 uppercase tracking-wide;
}
.input {
  @apply block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all bg-white;
}
</style>

