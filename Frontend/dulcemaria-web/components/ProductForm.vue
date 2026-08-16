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

    <!-- Receta vinculada -->
    <div class="pt-4 border-t border-warm-100">
      <label class="flex items-center gap-3 cursor-pointer mb-3 select-none">
        <div class="relative inline-flex items-center cursor-pointer">
          <input v-model="linkRecipe" type="checkbox" class="sr-only peer" @change="onToggleLinkRecipe">
          <div class="w-11 h-6 bg-warm-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
        </div>
        <span class="text-sm font-medium text-warm-700">Vincular a una receta</span>
      </label>

      <div v-if="linkRecipe" class="animate-fadeIn space-y-2">
        <div v-if="recipeId" class="flex items-center justify-between p-3 bg-primary-50 rounded-xl border border-primary-100">
          <span class="text-sm font-medium text-warm-800">{{ recipeName }}</span>
          <button type="button" class="text-xs text-warm-500 hover:text-error-600" @click="clearRecipeSelection">Quitar</button>
        </div>
        <div v-else class="relative">
          <input
            v-model="recipeSearch"
            type="text"
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
            placeholder="Buscar receta por nombre..."
            @input="onRecipeSearchInput"
            @focus="showRecipeDropdown = true"
          >
          <div v-if="showRecipeDropdown && recipeResults.length > 0" class="absolute z-10 mt-1 w-full bg-white border border-warm-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
            <button
              v-for="r in recipeResults"
              :key="r.id"
              type="button"
              class="block w-full text-left px-4 py-2 hover:bg-warm-50 text-sm"
              @click="selectRecipe(r)"
            >
              {{ r.name }} <span class="text-warm-400">— costo/porción ${{ formatPrice(r.costPerPortion) }}{{ r.is_scalable ? ' (referencia)' : '' }}</span>
            </button>
          </div>
        </div>
        <p class="text-xs text-warm-500">El costo del producto se calcula solo desde el costo de la receta (por porción), en vez de cargarse a mano.</p>

        <div v-if="recipeId && recipeIsScalable" class="p-3 bg-warm-50 rounded-xl border border-warm-100">
          <p class="text-xs font-medium text-warm-600 mb-2">Esta receta es escalable — tamaño de este producto (vacío = usa el tamaño de referencia de la receta)</p>
          <div class="grid grid-cols-3 gap-2">
            <input v-model.number="targetDiameterCm" type="number" min="0" step="any" placeholder="Diám. cm" class="px-2 py-1.5 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" @input="onTargetDimsInput">
            <input v-model.number="targetHeightCm" type="number" min="0" step="any" placeholder="Alto cm" class="px-2 py-1.5 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" @input="onTargetDimsInput">
            <input v-model.number="targetLayers" type="number" min="1" placeholder="Capas" class="px-2 py-1.5 border border-warm-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" @input="onTargetDimsInput">
          </div>
        </div>
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium text-warm-700 mb-1">Precio Costo (CLP)</label>
      <div class="relative">
        <span class="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400">$</span>
        <input
          v-model.number="costPrice"
          type="number"
          min="0"
          :disabled="linkRecipe && !!recipeId"
          :class="[
            'block w-full pl-8 pr-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all',
            linkRecipe && recipeId ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
          ]"
          placeholder="8000"
          @input="onCostPriceInput"
        >
      </div>
      <p class="text-xs text-warm-500 mt-1">
        {{ linkRecipe && recipeId ? 'Calculado desde la receta vinculada' : 'Opcional — permite calcular el precio de venta desde el margen de ganancia' }}
      </p>
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

// Receta vinculada — si hay una, el costo se calcula solo desde ella (ver
// admin.products.js GET, que sobreescribe cost_price_clp con el valor en vivo).
const linkRecipe = ref(!!props.product?.recipe_id)
const recipeId = ref<string | null>(props.product?.recipe_id ?? null)
const recipeName = ref<string>(props.product?.recipe_name ?? '')
const recipeIsScalable = ref<boolean>(!!props.product?.recipe_is_scalable)
const targetDiameterCm = ref<number | null>(props.product?.target_diameter_cm ?? null)
const targetHeightCm = ref<number | null>(props.product?.target_height_cm ?? null)
const targetLayers = ref<number | null>(props.product?.target_layers ?? null)
const recipeSearch = ref('')
const recipeResults = ref<any[]>([])
const showRecipeDropdown = ref(false)
let recipeSearchTimer: any = null
let recipeSearchSeq = 0

const searchRecipes = async () => {
  const seq = ++recipeSearchSeq
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/recipes?q=${encodeURIComponent(recipeSearch.value.trim())}`)
    if (seq !== recipeSearchSeq) return // llegó una respuesta vieja después de una búsqueda más nueva, se descarta
    if (res.ok) recipeResults.value = res.items
  } catch {
    if (seq !== recipeSearchSeq) return
    recipeResults.value = []
  }
}

const onRecipeSearchInput = () => {
  showRecipeDropdown.value = true
  clearTimeout(recipeSearchTimer)
  recipeSearchTimer = setTimeout(searchRecipes, 250)
}

const selectRecipe = (r: any) => {
  recipeId.value = r.id
  recipeName.value = r.name
  recipeIsScalable.value = !!r.is_scalable
  recipeSearch.value = ''
  recipeResults.value = []
  showRecipeDropdown.value = false
  targetDiameterCm.value = null
  targetHeightCm.value = null
  targetLayers.value = null
  costPrice.value = r.costPerPortion // referencia — se recalcula si carga un tamaño objetivo
  onCostPriceInput()
}

const clearRecipeSelection = () => {
  recipeId.value = null
  recipeName.value = ''
  recipeIsScalable.value = false
  targetDiameterCm.value = null
  targetHeightCm.value = null
  targetLayers.value = null
}

const onToggleLinkRecipe = () => {
  if (!linkRecipe.value) clearRecipeSelection()
}

// Con receta escalable + tamaño objetivo completo, recalcula el costo a ese tamaño.
let targetDimsTimer: any = null
const onTargetDimsInput = () => {
  clearTimeout(targetDimsTimer)
  targetDimsTimer = setTimeout(recalculateCostAtTarget, 350)
}

const recalculateCostAtTarget = async () => {
  if (!recipeId.value || !targetDiameterCm.value || !targetHeightCm.value || !targetLayers.value) return
  try {
    const qs = `?target_diameter_cm=${targetDiameterCm.value}&target_height_cm=${targetHeightCm.value}&target_layers=${targetLayers.value}`
    const res = await api.get<{ ok: boolean; cost: any }>(`/admin/recipes/${recipeId.value}${qs}`)
    if (res.ok) {
      costPrice.value = res.cost.costPerPortion
      onCostPriceInput()
    }
  } catch {}
}

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
      isActive: form.value.is_active,
      recipeId: linkRecipe.value ? recipeId.value : null,
      targetDiameterCm: linkRecipe.value && recipeIsScalable.value ? targetDiameterCm.value : null,
      targetHeightCm: linkRecipe.value && recipeIsScalable.value ? targetHeightCm.value : null,
      targetLayers: linkRecipe.value && recipeIsScalable.value ? targetLayers.value : null,
    }
    emit('submit', data)
  }
}

const getImages = () => {
  return imageUploadRef.value?.images || []
}

defineExpose({ submit, getImages })
</script>
