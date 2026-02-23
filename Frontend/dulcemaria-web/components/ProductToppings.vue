<template>
  <div class="border border-warm-200 rounded-xl p-4 space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h4 class="text-sm font-semibold text-warm-800">Toppings / Adicionales</h4>
        <p class="text-xs text-warm-500">(cubiertas, decoraciones, extras)</p>
      </div>
    </div>

    <div v-if="error" class="text-sm text-error-600 bg-error-50 rounded-lg p-3">{{ error }}</div>

    <!-- Lista de toppings -->
    <div v-if="toppings.length > 0" class="space-y-3">
      <div
        v-for="t in toppings"
        :key="t.id || t._tempId"
        class="bg-warm-50 rounded-xl p-3 sm:flex sm:items-center sm:gap-3 border border-warm-100"
      >
        <!-- Nombre -->
        <div class="w-full sm:flex-1 mb-3 sm:mb-0">
           <label class="block text-xs font-medium text-warm-600 mb-1 sm:hidden">Nombre</label>
           <input
            v-model="t.name"
            type="text"
            placeholder="Ej: Nueces"
            class="w-full bg-white border border-warm-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
            @blur="saveTopping(t)"
          >
        </div>

        <!-- Tipo & Precio -->
        <div class="flex gap-3 mb-3 sm:mb-0">
            <!-- Tipo -->
            <div class="flex-1 sm:flex-none sm:w-32">
              <label class="block text-xs font-medium text-warm-600 mb-1 sm:hidden">Tipo</label>
              <select
                v-model="t.type"
                class="w-full bg-white border border-warm-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
                @change="saveTopping(t)"
              >
                <option value="ADDITIONAL">Adicional</option>
                <option value="BASE">Base</option>
              </select>
            </div>

            <!-- Precio -->
            <div class="flex-1 sm:flex-none sm:w-32">
              <label class="block text-xs font-medium text-warm-600 mb-1 sm:hidden">Precio</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400 text-xs">$</span>
                <input
                    v-model.number="t.price_clp"
                    type="number"
                    min="0"
                    placeholder="0"
                    class="w-full bg-white border border-warm-200 rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
                    @blur="saveTopping(t)"
                >
              </div>
            </div>
        </div>

        <!-- Footer Row on mobile (Active + Delete) -->
        <div class="flex items-center justify-between sm:justify-end sm:gap-3">
            <!-- Activo -->
            <label class="flex items-center gap-2 cursor-pointer select-none bg-white sm:bg-transparent px-3 py-1.5 sm:p-0 rounded-lg border sm:border-0 border-warm-200" :title="t.is_active ? 'Activo' : 'Inactivo'">
              <input
                  v-model="t.is_active"
                  type="checkbox"
                  class="rounded border-warm-300 text-primary-600 focus:ring-primary-500 w-4 h-4"
                  @change="saveTopping(t)"
              >
              <span class="text-sm text-warm-700 font-medium sm:hidden">Activo</span>
            </label>

            <!-- Spinner / Eliminar -->
            <div class="flex items-center gap-2">
                <span v-if="t._saving" class="text-xs text-warm-400">Guardando...</span>
                <button
                v-else
                class="text-error-500 bg-error-50 hover:bg-error-100 p-2 rounded-lg transition-colors sm:bg-transparent sm:p-1 sm:hover:bg-error-50"
                title="Eliminar topping"
                @click="removeTopping(t)"
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
      No hay toppings. Agrega el primero abajo.
    </div>

    <!-- Añadir topping -->
    <button
      type="button"
      class="w-full border-2 border-dashed border-warm-200 text-warm-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl py-3 text-sm font-medium transition-all duration-200"
      @click="addRow"
    >
      + Agregar topping
    </button>

    <p v-if="!productId" class="text-xs text-warning-600 bg-warning-50 rounded-lg p-3">
      ⚠️ Guarda el producto primero y luego edítalo para agregar toppings.
    </p>
  </div>
</template>

<script setup lang="ts">
interface Topping {
  id?: string
  _tempId?: string
  name: string
  type: 'BASE' | 'ADDITIONAL'
  price_clp: number
  is_active: boolean
  _saving?: boolean
  _isNew?: boolean
}

const props = defineProps<{
  productId?: string
}>()

const emit = defineEmits<{
  change: [toppings: Topping[]]
}>()

const api = useApi()
const error = ref('')
const toppings = ref<Topping[]>([])
let tempCounter = 0

const loadToppings = async () => {
  if (!props.productId) return
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/products/${props.productId}/toppings`)
    if (res.ok) {
      toppings.value = res.items.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        price_clp: t.price_clp,
        is_active: t.is_active,
      }))
    }
  } catch (e) {
    console.error('Error loading toppings:', e)
  }
}

const addRow = () => {
  tempCounter++
  toppings.value.push({
    _tempId: `new-${tempCounter}`,
    name: '',
    type: 'ADDITIONAL',
    price_clp: 0,
    is_active: true,
    _isNew: true,
  })
  emit('change', toppings.value)
}

const saveTopping = async (t: Topping) => {
  if (!props.productId) return
  if (!t.name.trim()) return
  if (t._saving) return

  t._saving = true
  error.value = ''
  try {
    if (t.id) {
       await api.patch(`/admin/products/toppings/${t.id}`, {
         name: t.name,
         type: t.type,
         price_clp: t.price_clp,
         is_active: t.is_active
       })
    } else {
      const res = await api.post<{ ok: boolean; topping: any }>(`/admin/products/${props.productId}/toppings`, {
        name: t.name,
        type: t.type,
        price_clp: t.price_clp,
        is_active: t.is_active
      })
      if (res.ok && res.topping) {
        t.id = res.topping.id
        delete t._tempId
        delete t._isNew
      }
    }
    emit('change', toppings.value)
  } catch (e: any) {
    error.value = e?.data?.error || 'Error al guardar topping'
  } finally {
    t._saving = false
  }
}

const removeTopping = async (t: Topping) => {
  if (t._isNew || !t.id) {
    toppings.value = toppings.value.filter(x => x !== t)
    emit('change', toppings.value)
    return
  }
  try {
    await api.delete(`/admin/products/toppings/${t.id}`)
    toppings.value = toppings.value.filter(x => x !== t)
    emit('change', toppings.value)
  } catch (e: any) {
    error.value = e?.data?.error || 'Error al eliminar topping'
  }
}

const getToppings = () => toppings.value

onMounted(loadToppings)
watch(() => props.productId, loadToppings)

defineExpose({ getToppings, loadToppings })
</script>
