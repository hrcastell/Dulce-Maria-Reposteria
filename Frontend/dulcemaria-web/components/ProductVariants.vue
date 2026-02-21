<template>
  <div class="border border-warm-200 rounded-xl p-4 space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h4 class="text-sm font-semibold text-warm-800">Variantes</h4>
        <p class="text-xs text-warm-500">(sabores, presentaciones, tamaños)</p>
      </div>
    </div>

    <div v-if="error" class="text-sm text-error-600 bg-error-50 rounded-lg p-3">{{ error }}</div>

    <!-- Lista de variantes -->
    <div v-if="variants.length > 0" class="space-y-3">
      <div
        v-for="v in variants"
        :key="v.id || v._tempId"
        class="bg-warm-50 rounded-xl p-3 sm:flex sm:items-center sm:gap-3 border border-warm-100"
      >
        <!-- Nombre -->
        <div class="w-full sm:flex-1 mb-3 sm:mb-0">
           <label class="block text-xs font-medium text-warm-600 mb-1 sm:hidden">Nombre</label>
           <input
            v-model="v.name"
            type="text"
            placeholder="Ej: Chocolate"
            class="w-full bg-white border border-warm-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
            @blur="saveVariant(v)"
          >
        </div>

        <!-- Row for Price/Stock on mobile -->
        <div class="flex gap-3 mb-3 sm:mb-0">
            <!-- Precio override -->
            <div class="flex-1 sm:flex-none sm:w-36">
              <label class="block text-xs font-medium text-warm-600 mb-1 sm:hidden">Precio</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 text-xs">$</span>
                <input
                    v-model.number="v.price_override_clp"
                    type="number"
                    min="0"
                    placeholder="Base"
                    class="w-full bg-white border border-warm-200 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
                    @blur="saveVariant(v)"
                >
              </div>
            </div>

            <!-- Stock -->
            <div class="flex-1 sm:flex-none sm:w-24">
              <label class="block text-xs font-medium text-warm-600 mb-1 sm:hidden">Stock</label>
              <div class="relative">
                 <span class="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 text-xs sm:hidden">#</span>
                 <span class="hidden sm:block absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 text-xs">Stk</span>
                 <input
                    v-model.number="v.stock_qty"
                    type="number"
                    min="0"
                    class="w-full bg-white border border-warm-200 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
                    @blur="saveVariant(v)"
                >
              </div>
            </div>
        </div>

        <!-- Footer Row on mobile (Active + Delete) -->
        <div class="flex items-center justify-between sm:justify-end sm:gap-3">
            <!-- Activo -->
            <label class="flex items-center gap-2 cursor-pointer select-none bg-white sm:bg-transparent px-3 py-1.5 sm:p-0 rounded-lg border sm:border-0 border-warm-200" :title="v.is_active ? 'Activa' : 'Inactiva'">
              <input
                  v-model="v.is_active"
                  type="checkbox"
                  class="rounded border-warm-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
                  @change="saveVariant(v)"
              >
              <span class="text-sm text-warm-700 font-medium sm:hidden">Activa</span>
            </label>

            <!-- Spinner / Eliminar -->
            <div class="flex items-center gap-2">
                <span v-if="v._saving" class="text-xs text-warm-400">Guardando...</span>
                <button
                v-else
                class="text-error-500 bg-error-50 hover:bg-error-100 p-2 rounded-lg transition-colors sm:bg-transparent sm:p-1 sm:hover:bg-error-50"
                title="Eliminar variante"
                @click="removeVariant(v)"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                </button>
            </div>
        </div>
      </div>
    </div>

    <div v-else class="text-sm text-warm-400 text-center py-4 bg-warm-50 rounded-xl border border-dashed border-warm-200">
      No hay variantes. Agrega la primera abajo.
    </div>

    <!-- Añadir variante -->
    <button
      type="button"
      class="w-full border-2 border-dashed border-warm-200 text-warm-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl py-3 text-sm font-medium transition-all duration-200"
      @click="addRow"
    >
      + Agregar variante
    </button>

    <p v-if="!productId" class="text-xs text-warning-600 bg-warning-50 rounded-lg p-3">
      ⚠️ Guarda el producto primero y luego edítalo para agregar variantes.
    </p>
    <p v-else class="text-xs text-warm-400">
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
