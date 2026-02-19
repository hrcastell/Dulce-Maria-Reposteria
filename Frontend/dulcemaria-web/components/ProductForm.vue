<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-md bg-red-50 p-4">
      <p class="text-sm text-red-800">{{ error }}</p>
    </div>

    <div>
      <label class="label">Nombre *</label>
      <input
        v-model="form.name"
        type="text"
        required
        class="input"
        placeholder="Ej: Torta de Chocolate"
      >
    </div>

    <div>
      <label class="label">Descripción</label>
      <textarea
        v-model="form.description"
        rows="3"
        class="input"
        placeholder="Descripción del producto"
      ></textarea>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="label">Precio (CLP) *</label>
        <input
          v-model.number="form.price_clp"
          type="number"
          required
          min="0"
          class="input"
          placeholder="15000"
        >
      </div>

      <div>
        <label class="label">Stock *</label>
        <input
          v-model.number="form.stock_qty"
          type="number"
          required
          min="0"
          class="input"
          placeholder="20"
        >
      </div>
    </div>

    <div>
      <label class="flex items-center">
        <input
          v-model="form.is_active"
          type="checkbox"
          class="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        >
        <span class="ml-2 text-sm text-gray-700">Producto activo</span>
      </label>
    </div>

    <ImageUpload
      ref="imageUploadRef"
      :product-id="product?.id"
      :existing-images="product?.images"
      @update="handleImagesUpdate"
    />
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

const error = ref('')
const imageUploadRef = ref<any>(null)
const productImages = ref<any[]>([])

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
