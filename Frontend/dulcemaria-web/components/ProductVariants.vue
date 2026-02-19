<template>
  <div class="border border-gray-200 rounded-lg p-4 space-y-3">
    <div class="flex items-center justify-between">
      <h4 class="text-sm font-semibold text-gray-700">Variantes del producto</h4>
      <span class="text-xs text-gray-400">(sabores, presentaciones, tamaños)</span>
    </div>

    <div v-if="error" class="text-sm text-red-600 bg-red-50 rounded p-2">{{ error }}</div>

    <!-- Lista de variantes -->
    <div v-if="variants.length > 0" class="space-y-2">
      <div
        v-for="v in variants"
        :key="v.id || v._tempId"
        class="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2"
      >
        <!-- Nombre -->
        <input
          v-model="v.name"
          type="text"
          placeholder="Ej: Chocolate"
          class="flex-1 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
          @blur="saveVariant(v)"
        >
        <!-- Precio override -->
        <div class="flex items-center gap-1">
          <span class="text-xs text-gray-400">$</span>
          <input
            v-model.number="v.price_override_clp"
            type="number"
            min="0"
            placeholder="Precio base"
            class="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
            @blur="saveVariant(v)"
          >
        </div>
        <!-- Stock -->
        <div class="flex items-center gap-1">
          <span class="text-xs text-gray-400">Stk</span>
          <input
            v-model.number="v.stock_qty"
            type="number"
            min="0"
            class="w-16 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-400"
            @blur="saveVariant(v)"
          >
        </div>
        <!-- Activo -->
        <label class="flex items-center gap-1 cursor-pointer" :title="v.is_active ? 'Activa' : 'Inactiva'">
          <input
            v-model="v.is_active"
            type="checkbox"
            class="rounded border-gray-300 text-primary-600"
            @change="saveVariant(v)"
          >
          <span class="text-xs text-gray-500">Activa</span>
        </label>
        <!-- Spinner / Eliminar -->
        <span v-if="v._saving" class="text-xs text-gray-400">...</span>
        <button
          v-else
          class="text-red-400 hover:text-red-600 text-lg leading-none flex-shrink-0"
          title="Eliminar variante"
          @click="removeVariant(v)"
        >×</button>
      </div>
    </div>

    <div v-else class="text-sm text-gray-400 text-center py-2">
      No hay variantes. Agrega la primera abajo.
    </div>

    <!-- Añadir variante -->
    <button
      type="button"
      class="w-full border-2 border-dashed border-gray-200 text-gray-400 hover:border-primary-400 hover:text-primary-600 rounded-lg py-2 text-sm transition-colors"
      @click="addRow"
    >
      + Agregar variante
    </button>

    <p v-if="!productId" class="text-xs text-orange-500 bg-orange-50 rounded p-2">
      ⚠️ Guarda el producto primero y luego edítalo para agregar variantes.
    </p>
    <p v-else class="text-xs text-gray-400">
      💡 Deja el precio en blanco para usar el precio base del producto. Los cambios se guardan al salir de cada campo.
    </p>
  </div>
</template>

<script setup lang="ts">
interface Variant {
  id?: string
  _tempId?: string
  name: string
  price_override_clp: number | null
  stock_qty: number
  is_active: boolean
  _saving?: boolean
  _isNew?: boolean
}

const props = defineProps<{
  productId?: string
}>()

const emit = defineEmits<{
  change: [variants: Variant[]]
}>()

const api = useApi()
const error = ref('')
const variants = ref<Variant[]>([])
let tempCounter = 0

const loadVariants = async () => {
  if (!props.productId) return
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/products/${props.productId}/variants`)
    if (res.ok) {
      variants.value = res.items.map(v => ({
        id: v.id,
        name: v.name,
        price_override_clp: v.price_override_clp,
        stock_qty: v.stock_qty,
        is_active: v.is_active,
      }))
    }
  } catch (e) {
    console.error('Error loading variants:', e)
  }
}

const addRow = () => {
  tempCounter++
  variants.value.push({
    _tempId: `new-${tempCounter}`,
    name: '',
    price_override_clp: null,
    stock_qty: 0,
    is_active: true,
    _isNew: true,
  })
  emit('change', variants.value)
}

const saveVariant = async (v: Variant) => {
  if (!props.productId) return
  if (!v.name.trim()) return
  if (v._saving) return

  v._saving = true
  error.value = ''
  try {
    const body = {
      name: v.name.trim(),
      price_override_clp: v.price_override_clp || null,
      stock_qty: v.stock_qty || 0,
      is_active: v.is_active,
    }

    if (v.id) {
      await api.patch(`/admin/products/variants/${v.id}`, body)
    } else {
      const res = await api.post<{ ok: boolean; variant: any }>(`/admin/products/${props.productId}/variants`, body)
      if (res.ok && res.variant) {
        v.id = res.variant.id
        delete v._tempId
        delete v._isNew
      }
    }
    emit('change', variants.value)
  } catch (e: any) {
    error.value = e?.data?.error || 'Error al guardar variante'
  } finally {
    v._saving = false
  }
}

const removeVariant = async (v: Variant) => {
  if (v._isNew || !v.id) {
    variants.value = variants.value.filter(x => x !== v)
    emit('change', variants.value)
    return
  }
  try {
    await api.delete(`/admin/products/variants/${v.id}`)
    variants.value = variants.value.filter(x => x !== v)
    emit('change', variants.value)
  } catch (e: any) {
    error.value = e?.data?.error || 'Error al eliminar variante'
  }
}

const getVariants = () => variants.value

onMounted(loadVariants)
watch(() => props.productId, loadVariants)

defineExpose({ getVariants, loadVariants })
</script>
