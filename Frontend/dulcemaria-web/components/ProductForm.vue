<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-xl bg-error-50 p-4 border border-error-100">
      <p class="text-sm text-error-700">{{ error }}</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Nombre *</label>
      <input
        v-model="form.name"
        type="text"
        required
        class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
        placeholder="Ej: Torta de Chocolate"
      >
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Descripción</label>
      <textarea
        v-model="form.description"
        rows="3"
        class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
        placeholder="Descripción del producto"
      ></textarea>
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Precio Costo (CLP)</label>
      <div class="relative">
        <span class="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400">$</span>
        <input
          v-model.number="costPrice"
          type="number"
          min="0"
          class="block w-full pl-8 pr-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
          placeholder="8000"
          @input="onCostPriceInput"
        >
      </div>
      <p class="text-xs text-warm-500 mt-1">Opcional — permite calcular el precio de venta desde el margen de ganancia</p>
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Margen de Ganancia (%)</label>
      <div class="relative">
        <input
          v-model.number="marginPct"
          type="number"
          class="block w-full pl-4 pr-9 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
          placeholder="40"
          @input="onMarginInput"
        >
        <span class="absolute right-4 top-1/2 -translate-y-1/2 text-warm-400">%</span>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Precio (CLP) *</label>
      <div class="relative">
        <span class="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400">$</span>
        <input
          v-model.number="form.price_clp"
          type="number"
          required
          min="0"
          class="block w-full pl-8 pr-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
          placeholder="15000"
          @input="onPriceInput"
        >
      </div>
      <p v-if="costPrice" class="text-xs text-warm-500 mt-1">Resultado — escribí acá o en el margen, se recalculan entre sí</p>
    </div>

    <!-- IVA -->
    <div class="pt-4 border-t border-warm-100">
      <label class="flex items-center gap-3 cursor-pointer mb-4 select-none">
        <div class="relative inline-flex items-center cursor-pointer">
          <input
            v-model="includeIva"
            type="checkbox"
            class="sr-only peer"
          >
          <div class="w-11 h-6 bg-warm-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
        </div>
        <span class="text-sm font-medium text-warm-700">Incluir IVA en el cálculo</span>
      </label>

      <div v-if="includeIva" class="animate-fadeIn space-y-4">
        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">IVA (%)</label>
          <div class="relative">
            <input
              v-model.number="ivaPct"
              type="number"
              min="0"
              class="block w-full pl-4 pr-9 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
              placeholder="19"
            >
            <span class="absolute right-4 top-1/2 -translate-y-1/2 text-warm-400">%</span>
          </div>
        </div>

        <div class="flex items-center justify-between p-4 bg-warm-50 rounded-xl border border-warm-100">
          <span class="text-sm font-medium text-warm-700">Precio final con IVA</span>
          <span class="text-lg font-semibold text-warm-800">${{ formatPrice(priceWithIva) }}</span>
        </div>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Stock *</label>
      <input
        v-model.number="form.stock_qty"
        type="number"
        required
        min="0"
        :disabled="hasVariants"
        :class="[
          'block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all',
          hasVariants ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
        ]"
        placeholder="20"
      >
      <p v-if="hasVariants" class="text-xs text-warm-500 mt-1">Gestionado por variantes</p>
    </div>

    <div class="flex items-center p-4 bg-warm-50 rounded-xl border border-warm-100">
      <label class="flex items-center cursor-pointer select-none w-full">
        <input
          v-model="form.is_active"
          type="checkbox"
          class="w-5 h-5 rounded border-warm-300 text-primary-600 focus:ring-primary-500 transition-colors"
        >
        <span class="ml-3 text-sm font-medium text-warm-700">Producto activo (visible en catálogo)</span>
      </label>
    </div>

    <ImageUpload
      ref="imageUploadRef"
      :product-id="product?.id"
      :existing-images="product?.images"
      @update="handleImagesUpdate"
    />

    <!-- Variantes -->
    <div class="pt-4 border-t border-warm-100">
      <label class="flex items-center gap-3 cursor-pointer mb-4 select-none">
        <div class="relative inline-flex items-center cursor-pointer">
          <input 
            v-model="hasVariants" 
            type="checkbox" 
            class="sr-only peer"
          >
          <div class="w-11 h-6 bg-warm-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
        </div>
        <span class="text-sm font-medium text-warm-700">Habilitar variantes</span>
      </label>
      
      <div v-if="hasVariants" class="animate-fadeIn">
        <ProductVariants
          ref="variantsRef"
          :product-id="product?.id"
          @change="updateStockFromVariants"
        />
      </div>
    </div>

    <!-- Toppings -->
    <div class="pt-4 border-t border-warm-100">
      <label class="flex items-center gap-3 cursor-pointer mb-4 select-none">
        <div class="relative inline-flex items-center cursor-pointer">
          <input 
            v-model="hasToppings" 
            type="checkbox" 
            class="sr-only peer"
          >
          <div class="w-11 h-6 bg-warm-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
        </div>
        <span class="text-sm font-medium text-warm-700">Habilitar toppings / adicionales</span>
      </label>
      
      <div v-if="hasToppings" class="animate-fadeIn">
        <ProductToppings
          ref="toppingsRef"
          :product-id="product?.id"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  product?: any
}>()

const emit = defineEmits<{
  submit: [data: any]
  error: [error: string]
}>()

const form = ref({
  name: props.product?.name || '',
  description: props.product?.description || '',
  price_clp: props.product?.price_clp || 0,
  stock_qty: props.product?.stock_qty || 0,
  is_active: props.product?.is_active ?? true
})

const api = useApi()
const error = ref('')
const imageUploadRef = ref<any>(null)
const variantsRef = ref<any>(null)
const toppingsRef = ref<any>(null)
const productImages = ref<any[]>([])
const hasVariants = ref(false)
const hasToppings = ref(false)

// Calculadora de precio (costo + margen ↔ precio de venta). El costo se
// persiste en products.cost_price_clp; el margen se recalcula siempre desde
// costo+precio, nunca se guarda (evita que quede desactualizado si el
// precio cambia después).
const costPrice = ref<number | null>(props.product?.cost_price_clp ?? null)
const marginPct = ref<number | null>(
  costPrice.value && form.value.price_clp
    ? Math.round((1 - costPrice.value / form.value.price_clp) * 1000) / 10
    : null
)
const includeIva = ref(false)
const ivaPct = ref(19)

const formatPrice = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))

const priceWithIva = computed(() => {
  return (form.value.price_clp || 0) * (1 + (ivaPct.value || 0) / 100)
})

// Costo → Precio (si ya hay margen cargado) o Costo → Margen (si ya hay precio cargado)
const onCostPriceInput = () => {
  if (marginPct.value !== null) {
    recalcPriceFromMargin()
  } else {
    recalcMarginFromPrice()
  }
}

// Margen → Precio
const onMarginInput = () => {
  recalcPriceFromMargin()
}

// Precio → Margen
const onPriceInput = () => {
  recalcMarginFromPrice()
}

// Margen = % del precio de venta que es ganancia (no % sobre el costo):
// precio = costo / (1 - margen/100)  →  ej. costo 700, margen 70% => 700/0.3 = 2333,33
const recalcPriceFromMargin = () => {
  if (!costPrice.value || costPrice.value <= 0 || marginPct.value === null || marginPct.value >= 100) return
  form.value.price_clp = Math.round(costPrice.value / (1 - marginPct.value / 100))
}

const recalcMarginFromPrice = () => {
  if (!costPrice.value || costPrice.value <= 0 || !form.value.price_clp) return
  marginPct.value = Math.round((1 - costPrice.value / form.value.price_clp) * 1000) / 10
}

onMounted(async () => {
  if (props.product?.id) {
    try {
      // Check variants
      const resVar = await api.get<{ ok: boolean; items: any[] }>(`/admin/products/${props.product.id}/variants`)
      if (resVar.ok && resVar.items && resVar.items.length > 0) {
        hasVariants.value = true
      }
      
      // Check toppings
      const resTop = await api.get<{ ok: boolean; items: any[] }>(`/admin/products/${props.product.id}/toppings`)
      if (resTop.ok && resTop.items && resTop.items.length > 0) {
        hasToppings.value = true
      }
    } catch {}
  }
})

const handleImagesUpdate = (images: any[]) => {
  productImages.value = images
}

const updateStockFromVariants = (variants: any[]) => {
  // Sum stock from variants to display in the disabled input
  const total = variants.reduce((sum, v) => sum + (Number(v.stock_qty) || 0), 0)
  form.value.stock_qty = total
}

const validate = () => {
  if (!form.value.name.trim()) {
    error.value = 'El nombre es requerido'
    return false
  }
  if (form.value.price_clp <= 0) {
    error.value = 'El precio debe ser mayor a 0'
    return false
  }
  if (form.value.stock_qty < 0) {
    error.value = 'El stock no puede ser negativo'
    return false
  }
  error.value = ''
  return true
}

const submit = () => {
  if (validate()) {
    // Convertir a camelCase para el backend
    const data = {
      name: form.value.name,
      description: form.value.description,
      priceClp: form.value.price_clp,
      costPriceClp: costPrice.value,
      stockQty: form.value.stock_qty,
      isActive: form.value.is_active
    }
    emit('submit', data)
  }
}

const getImages = () => {
  return imageUploadRef.value?.images || []
}

defineExpose({ submit, getImages })
</script>
