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

    <!-- Items -->
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-warm-800">Productos</h3>
        <button
          type="button"
          class="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1"
          @click="addItem"
        >
          + Agregar producto
        </button>
      </div>

      <div class="space-y-4">
        <div 
          v-for="(item, index) in form.items" 
          :key="index" 
          class="bg-white p-4 rounded-2xl border border-warm-100 shadow-sm relative group"
        >
          <!-- Delete button -->
          <button
            type="button"
            class="absolute top-4 right-4 text-warm-300 hover:text-error-500 transition-colors"
            @click="removeItem(index)"
            v-if="form.items.length > 1"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start pr-8">
            <!-- Product Select -->
            <div class="sm:col-span-5">
              <label class="block text-xs font-medium text-warm-500 mb-1">Producto</label>
              <select 
                v-model="item.productId" 
                required 
                class="block w-full px-3 py-2 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                @change="onProductChange(item)"
              >
                <option value="">Seleccionar...</option>
                <option
                  v-for="product in availableProducts"
                  :key="product.id"
                  :value="product.id"
                  :disabled="!product.is_active"
                >
                  {{ product.name }}
                </option>
              </select>
            </div>

            <!-- Variant Select -->
            <div class="sm:col-span-4">
              <label class="block text-xs font-medium text-warm-500 mb-1">Variante</label>
              <select 
                v-model="item.variantId" 
                class="block w-full px-3 py-2 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-warm-50 disabled:text-warm-400"
                :disabled="!item._variants || item._variants.length === 0"
              >
                <option value="">{{ item._variants?.length ? 'Seleccionar...' : 'N/A' }}</option>
                <option 
                  v-for="v in item._variants" 
                  :key="v.id" 
                  :value="v.id"
                  :disabled="!v.is_active || v.stock_qty <= 0"
                >
                  {{ v.name }} (${{ formatPrice(v.price_override_clp || item._basePrice) }}) - Stock: {{ v.stock_qty }}
                </option>
              </select>
            </div>

            <!-- Qty -->
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-warm-500 mb-1">Cant.</label>
              <input
                v-model.number="item.qty"
                type="number"
                min="1"
                required
                class="block w-full px-3 py-2 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
            </div>
            
            <!-- Line Total (Visual) -->
             <div class="sm:col-span-1 pt-6 text-right sm:text-center text-sm font-semibold text-warm-700">
                ${{ formatPrice(calculateLineTotal(item)) }}
             </div>
          </div>

          <!-- Toppings -->
          <div v-if="item._toppings && item._toppings.length > 0" class="mt-4 pt-3 border-t border-warm-50">
            <p class="text-xs font-medium text-warm-500 mb-2">Toppings / Adicionales:</p>
            <div class="flex flex-wrap gap-3">
              <label 
                v-for="t in item._toppings" 
                :key="t.id"
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors"
                :class="item.toppings.includes(t.id) ? 'bg-primary-50 border-primary-200 text-primary-800' : 'bg-white border-warm-200 text-warm-600 hover:bg-warm-50'"
              >
                <input 
                  type="checkbox" 
                  :value="t.id" 
                  v-model="item.toppings"
                  class="rounded text-primary-500 focus:ring-primary-400 border-warm-300"
                >
                <span>{{ t.name }}</span>
                <span v-if="t.price_clp > 0" class="text-xs font-semibold ml-1">+${{ formatPrice(t.price_clp) }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Totals & Adjustments -->
    <div class="bg-white p-5 rounded-2xl border border-warm-100 shadow-sm space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <!-- Payment & Delivery -->
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
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
          </div>
          
          <div class="grid grid-cols-2 gap-4">
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
    <Modal
      v-model="showNewCustomerModal"
      title="Nuevo Cliente"
      :hide-submit="true"
    >
      <CustomerForm
        ref="customerFormRef"
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
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useApi } from '@/composables/useApi'

const api = useApi()

const emit = defineEmits<{
  submit: [data: any]
}>()

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
}

interface Customer {
  id: string
  full_name: string
  phone?: string
  email?: string
}

const form = ref({
  customerId: '',
  items: [{ productId: '', variantId: '', toppings: [], qty: 1, _basePrice: 0 }] as OrderItem[],
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

const availableProducts = computed(() => products.value)

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
const addItem = () => {
  form.value.items.push({ productId: '', variantId: '', toppings: [], qty: 1, _basePrice: 0 })
}

const removeItem = (index: number) => {
  if (form.value.items.length > 1) {
    form.value.items.splice(index, 1)
  }
}

const updateDeliveryFee = () => {
  if (form.value.deliveryMethod === 'PICKUP') {
    form.value.deliveryFeeClp = 0
  }
}

const onProductChange = async (item: OrderItem) => {
  item.variantId = ''
  item.toppings = []
  item._variants = []
  item._toppings = []
  item._basePrice = 0
  
  if (!item.productId) return

  const prod = products.value.find(p => p.id === item.productId)
  if (prod) item._basePrice = prod.price_clp

  // Fetch details
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
    }
  } catch (e: any) {
    alert(e?.data?.error || 'Error al crear cliente')
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
    .filter(c => c.full_name.toLowerCase().includes(lower) || c.phone?.includes(lower))
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

// Close dropdown when clicking outside
onMounted(() => {
  loadCustomers()
  loadProducts()
  
  document.addEventListener('click', (e) => {
    if (customerDropdownRef.value && !customerDropdownRef.value.contains(e.target as Node)) {
      showCustomerDropdown.value = false
    }
  })
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

