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

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          >
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-warm-700 mb-1">Stock *</label>
        <input
          v-model.number="form.stock_qty"
          type="number"
          required
          min="0"
          class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
          placeholder="20"
        >
      </div>
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
const productImages = ref<any[]>([])
const hasVariants = ref(false)

onMounted(async () => {
  if (props.product?.id) {
    try {
      const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/products/${props.product.id}/variants`)
      if (res.ok && res.items && res.items.length > 0) {
        hasVariants.value = true
      }
    } catch {}
  }
})

const handleImagesUpdate = (images: any[]) => {
  productImages.value = images
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
