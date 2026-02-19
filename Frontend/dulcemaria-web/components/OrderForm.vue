<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-md bg-red-50 p-4">
      <p class="text-sm text-red-800">{{ error }}</p>
    </div>

    <!-- Customer Selection -->
    <div>
      <label class="label">Cliente *</label>
      <select v-model="form.customerId" required class="input">
        <option value="">Seleccionar cliente...</option>
        <option v-for="customer in customers" :key="customer.id" :value="customer.id">
          {{ customer.full_name }} {{ customer.email ? `(${customer.email})` : '' }}
        </option>
      </select>
      <p v-if="loadingCustomers" class="text-xs text-gray-500 mt-1">Cargando clientes...</p>
    </div>

    <!-- Items -->
    <div>
      <label class="label">Productos *</label>
      <div class="space-y-3">
        <div v-for="(item, index) in form.items" :key="index" class="flex gap-2 items-start">
          <select v-model="item.productId" required class="input flex-1">
            <option value="">Seleccionar producto...</option>
            <option
              v-for="product in availableProducts"
              :key="product.id"
              :value="product.id"
              :disabled="!product.is_active || product.stock_qty === 0"
            >
              {{ product.name }} - ${{ formatPrice(product.price_clp) }}
              (Stock: {{ product.stock_qty }})
            </option>
          </select>
          <input
            v-model.number="item.qty"
            type="number"
            min="1"
            required
            placeholder="Cant."
            class="input w-24"
          >
          <button
            type="button"
            class="btn-secondary text-sm px-3 py-2"
            @click="removeItem(index)"
          >
            ✕
          </button>
        </div>
      </div>
      <button
        type="button"
        class="btn-secondary text-sm mt-2"
        @click="addItem"
      >
        + Agregar Producto
      </button>
      <p v-if="loadingProducts" class="text-xs text-gray-500 mt-1">Cargando productos...</p>
    </div>

    <!-- Payment & Delivery -->
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Método de Pago</label>
        <select v-model="form.paymentMethod" class="input">
          <option value="TRANSFER">Transferencia</option>
          <option value="CASH">Efectivo</option>
          <option value="ONLINE">Online</option>
        </select>
      </div>

      <div>
        <label class="label">Estado de Pago</label>
        <select v-model="form.paymentStatus" class="input">
          <option value="PENDING">Pendiente</option>
          <option value="PAID">Pagado</option>
        </select>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Método de Entrega</label>
        <select v-model="form.deliveryMethod" class="input" @change="updateDeliveryFee">
          <option value="PICKUP">Retiro</option>
          <option value="DELIVERY">Delivery</option>
        </select>
      </div>

      <div>
        <label class="label">Costo de Delivery (CLP)</label>
        <input
          v-model.number="form.deliveryFeeClp"
          type="number"
          min="0"
          class="input"
          :disabled="form.deliveryMethod === 'PICKUP'"
        >
      </div>
    </div>

    <!-- Total Preview -->
    <div v-if="calculatedTotal > 0" class="card bg-gray-50">
      <div class="text-right">
        <p class="text-sm text-gray-600">Total estimado:</p>
        <p class="text-2xl font-bold text-primary-600">
          ${{ formatPrice(calculatedTotal) }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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

interface Customer {
  id: string
  full_name: string
  email?: string
}

const form = ref({
  customerId: '',
  items: [{ productId: '', qty: 1 }],
  paymentMethod: 'TRANSFER',
  paymentStatus: 'PAID',
  deliveryMethod: 'PICKUP',
  deliveryFeeClp: 0
})

const customers = ref<Customer[]>([])
const products = ref<Product[]>([])
const loadingCustomers = ref(false)
const loadingProducts = ref(false)
const error = ref('')

const availableProducts = computed(() => products.value)

const calculatedTotal = computed(() => {
  let subtotal = 0
  form.value.items.forEach(item => {
    if (item.productId) {
      const product = products.value.find(p => p.id === item.productId)
      if (product) {
        subtotal += product.price_clp * item.qty
      }
    }
  })
  return subtotal + (form.value.deliveryFeeClp || 0)
})

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const addItem = () => {
  form.value.items.push({ productId: '', qty: 1 })
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

const loadCustomers = async () => {
  try {
    loadingCustomers.value = true
    const response = await api.get<{ ok: boolean; items: Customer[] }>('/admin/customers')
    if (response.ok && response.items) {
      customers.value = response.items
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
      products.value = response.items
    }
  } catch (e) {
    console.error('Error loading products:', e)
  } finally {
    loadingProducts.value = false
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
    if (item.qty <= 0) {
      error.value = 'Las cantidades deben ser mayores a 0'
      return false
    }
    
    // Validar stock
    const product = products.value.find(p => p.id === item.productId)
    if (product && item.qty > product.stock_qty) {
      error.value = `Stock insuficiente para ${product.name}. Disponible: ${product.stock_qty}`
      return false
    }
  }
  
  error.value = ''
  return true
}

const submit = () => {
  if (validate()) {
    emit('submit', form.value)
  }
}

onMounted(() => {
  loadCustomers()
  loadProducts()
})

defineExpose({ submit })
</script>
