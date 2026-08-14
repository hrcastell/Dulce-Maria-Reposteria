<template>
  <div>
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Recetario</h1>
        <p class="mt-1 text-warm-500">Costeo de recetas a partir del precio de los insumos</p>
      </div>
      <button
        v-if="canWrite"
        class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft"
        @click="openCreatePanel"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span>Nueva Receta</span>
      </button>
    </div>

    <!-- Search -->
    <div class="mb-6">
      <div class="relative max-w-md">
        <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <svg class="h-5 w-5 text-warm-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
        </div>
        <input
          v-model="search"
          type="text"
          placeholder="Buscar recetas..."
          class="block w-full pl-11 pr-4 py-3 border border-warm-200 rounded-xl text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
          @input="debouncedSearch"
        >
      </div>
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center py-16">
      <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      <p class="mt-4 text-warm-500">Cargando recetas...</p>
    </div>

    <div v-else-if="error" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-error-500 text-xl">⚠️</span>
        <p class="text-error-700">{{ error }}</p>
      </div>
    </div>

    <div v-else-if="recipes.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
      <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <span class="text-4xl">📖</span>
      </div>
      <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay recetas</h3>
      <p class="text-warm-500 mb-6">{{ search ? 'No se encontraron resultados' : 'Creá tu primera receta para empezar a costear' }}</p>
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <button
        v-for="r in recipes"
        :key="r.id"
        class="text-left bg-white rounded-2xl p-5 shadow-soft border border-warm-100 hover:border-primary-200 hover:shadow-md transition-all duration-200"
        @click="openEditPanel(r)"
      >
        <div class="flex items-start justify-between gap-2 mb-3">
          <h3 class="font-semibold text-warm-800">{{ r.name }}</h3>
          <span v-if="!r.is_active" class="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-warm-100 text-warm-500">Inactiva</span>
        </div>
        <div class="space-y-1.5 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-warm-500">Insumos</span>
            <span class="font-medium text-warm-700">{{ r.itemCount }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-warm-500">Costo total</span>
            <span class="font-semibold text-warm-800">${{ formatPrice(r.totalCost) }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-warm-500">Costo / porción</span>
            <span class="font-medium text-warm-700">${{ formatPrice(r.costPerPortion) }}</span>
          </div>
        </div>
        <div class="mt-4 pt-3 border-t border-warm-100 flex items-center justify-between">
          <span class="text-xs text-warm-500">Alcanza para</span>
          <span
            :class="r.maxBatches > 0 ? 'text-success-700 bg-success-100' : 'text-error-700 bg-error-100'"
            class="text-xs font-medium px-2.5 py-1 rounded-full"
          >
            {{ r.maxBatches }} {{ r.maxBatches === 1 ? 'vez' : 'veces' }}
          </span>
        </div>
        <p v-if="r.hasUnpricedItem" class="mt-2 text-xs text-warning-600">⚠️ Algún insumo no tiene precio cargado</p>
      </button>
    </div>

    <!-- Panel: Nueva/Editar Receta -->
    <SidePanel
      v-model="showPanel"
      :title="editingId ? 'Editar Receta' : 'Nueva Receta'"
      submit-text="Guardar"
      :loading="saving"
      :hide-submit="!canWrite"
      @submit="saveRecipe"
    >
      <div class="space-y-4">
        <div v-if="panelError" class="rounded-xl bg-error-50 p-4 border border-error-100">
          <p class="text-sm text-error-700">{{ panelError }}</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">Nombre *</label>
          <input
            v-model="form.name"
            type="text"
            :disabled="!canWrite"
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all disabled:bg-gray-100"
            placeholder="Ej: Bizcocho de vainilla"
          >
        </div>

        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">Porciones *</label>
          <input
            v-model.number="form.portions"
            type="number"
            min="1"
            :disabled="!canWrite"
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all disabled:bg-gray-100"
            placeholder="10"
          >
        </div>

        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">Notas</label>
          <textarea
            v-model="form.notes"
            rows="2"
            :disabled="!canWrite"
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all disabled:bg-gray-100"
          ></textarea>
        </div>

        <!-- Insumos -->
        <div class="pt-4 border-t border-warm-100">
          <h4 class="text-sm font-semibold text-warm-700 mb-3">Insumos</h4>

          <div v-if="form.items.length > 0" class="space-y-2 mb-3">
            <div v-for="(item, idx) in form.items" :key="item._key" class="flex items-center justify-between p-3 bg-warm-50 rounded-xl border border-warm-100">
              <div class="text-sm">
                <span class="font-medium text-warm-800">{{ item.supply_name }}</span>
                <span class="text-warm-500"> — {{ item.quantity }} {{ item.unit }}</span>
              </div>
              <button v-if="canWrite" type="button" class="text-warm-400 hover:text-error-600" @click="form.items.splice(idx, 1)">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>

          <div v-if="canWrite" class="p-3 bg-white rounded-xl border border-dashed border-warm-200 space-y-2">
            <div class="relative">
              <input
                v-model="draftItem.search"
                type="text"
                class="block w-full px-3 py-2 border border-warm-200 rounded-lg text-sm text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                placeholder="Buscar insumo..."
                @input="onDraftSearchInput"
                @focus="draftItem.showDropdown = true"
              >
              <div v-if="draftItem.showDropdown && draftItem.results.length > 0" class="absolute z-10 mt-1 w-full bg-white border border-warm-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                <button v-for="s in draftItem.results" :key="s.id" type="button" class="block w-full text-left px-3 py-2 hover:bg-warm-50 text-sm" @click="selectDraftSupply(s)">
                  {{ s.name }} <span class="text-warm-400">({{ s.unit || 'sin unidad' }})</span>
                </button>
              </div>
            </div>
            <div v-if="draftItem.supply_id" class="flex items-center gap-2">
              <span class="text-sm font-medium text-warm-700 flex-1 truncate">{{ draftItem.supply_name }}</span>
              <input v-model.number="draftItem.quantity" type="number" min="0" step="any" class="w-20 px-2 py-1.5 border border-warm-200 rounded-lg text-sm" placeholder="Cant.">
              <input v-model="draftItem.unit" type="text" class="w-20 px-2 py-1.5 border border-warm-200 rounded-lg text-sm" placeholder="Unidad">
              <button type="button" class="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium rounded-lg flex-shrink-0" @click="addDraftItem">Agregar</button>
            </div>
          </div>
          <p v-if="itemError" class="text-xs text-error-600 mt-1">{{ itemError }}</p>
        </div>

        <!-- Energía (opcional) -->
        <div class="pt-4 border-t border-warm-100">
          <label class="flex items-center gap-3 cursor-pointer mb-3 select-none">
            <div class="relative inline-flex items-center cursor-pointer">
              <input v-model="useEquipment" type="checkbox" :disabled="!canWrite" class="sr-only peer" @change="onToggleEquipment">
              <div class="w-11 h-6 bg-warm-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-500"></div>
            </div>
            <span class="text-sm font-medium text-warm-700">Sumar costo de energía (horno)</span>
          </label>

          <div v-if="useEquipment" class="animate-fadeIn space-y-3">
            <div>
              <label class="block text-sm font-medium text-warm-700 mb-1">Equipo</label>
              <select
                v-model="form.equipment_id"
                :disabled="!canWrite"
                class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option :value="null">Seleccionar...</option>
                <option v-for="eq in equipmentList" :key="eq.id" :value="eq.id">
                  {{ eq.name }} ({{ eq.energy_type === 'ELECTRIC' ? 'eléctrico' : 'gas' }})
                </option>
              </select>
              <button v-if="canWrite" type="button" class="text-xs text-primary-600 hover:text-primary-700 mt-1" @click="showNewEquipment = !showNewEquipment">
                + Nuevo equipo
              </button>
            </div>

            <div v-if="showNewEquipment" class="p-3 bg-warm-50 rounded-xl border border-warm-100 space-y-2">
              <input v-model="newEquipment.name" type="text" placeholder="Nombre (ej: Horno eléctrico)" class="block w-full px-3 py-2 border border-warm-200 rounded-lg text-sm">
              <div class="flex gap-2">
                <select v-model="newEquipment.energy_type" class="flex-1 px-2 py-2 border border-warm-200 rounded-lg text-sm">
                  <option value="ELECTRIC">Eléctrico</option>
                  <option value="GAS">Gas</option>
                </select>
                <input v-model.number="newEquipment.consumption_rate" type="number" min="0" step="any" placeholder="Consumo/h" class="w-24 px-2 py-2 border border-warm-200 rounded-lg text-sm">
                <input v-model="newEquipment.consumption_unit" type="text" placeholder="ej: kWh" class="w-20 px-2 py-2 border border-warm-200 rounded-lg text-sm">
              </div>
              <button
                type="button"
                class="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                :disabled="creatingEquipment"
                @click="createEquipment"
              >
                {{ creatingEquipment ? 'Creando...' : 'Crear equipo' }}
              </button>
            </div>

            <div>
              <label class="block text-sm font-medium text-warm-700 mb-1">Tiempo de horneado (minutos)</label>
              <input
                v-model.number="form.baking_time_minutes"
                type="number"
                min="0"
                :disabled="!canWrite"
                class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-gray-100"
                placeholder="45"
              >
            </div>
          </div>
        </div>

        <!-- Costo en vivo (ya guardado) -->
        <div v-if="editingId && liveCost" class="pt-4 border-t border-warm-100 space-y-2">
          <div class="flex items-center justify-between p-3 bg-warm-50 rounded-xl border border-warm-100">
            <span class="text-sm font-medium text-warm-700">Costo total</span>
            <span class="text-lg font-semibold text-warm-800">${{ formatPrice(liveCost.totalCost) }}</span>
          </div>
          <div class="flex items-center justify-between text-sm px-1">
            <span class="text-warm-500">Costo / porción</span>
            <span class="font-medium text-warm-700">${{ formatPrice(liveCost.costPerPortion) }}</span>
          </div>
          <div class="flex items-center justify-between text-sm px-1">
            <span class="text-warm-500">Alcanza para</span>
            <span class="font-medium text-warm-700">{{ liveCost.maxBatches }} {{ liveCost.maxBatches === 1 ? 'vez' : 'veces' }}</span>
          </div>

          <button
            v-if="canWrite"
            type="button"
            class="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-success-500 hover:bg-success-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200"
            :disabled="liveCost.maxBatches <= 0"
            @click="openProduceModal"
          >
            🍳 Hacer Receta
          </button>
        </div>

        <div v-if="editingId" class="flex items-center p-4 bg-warm-50 rounded-xl border border-warm-100">
          <label class="flex items-center cursor-pointer select-none w-full">
            <input v-model="form.is_active" type="checkbox" :disabled="!canWrite" class="w-5 h-5 rounded border-warm-300 text-primary-600 focus:ring-primary-500">
            <span class="ml-3 text-sm font-medium text-warm-700">Receta activa</span>
          </label>
        </div>
      </div>
    </SidePanel>

    <!-- Modal: Hacer Receta -->
    <Modal
      v-model="showProduceModal"
      title="Hacer Receta"
      submit-text="Confirmar"
      :loading="producing"
      @submit="confirmProduce"
    >
      <div class="space-y-4">
        <div v-if="produceError" class="rounded-xl bg-error-50 p-4 border border-error-100">
          <p class="text-sm text-error-700">{{ produceError }}</p>
        </div>
        <p class="text-sm text-warm-600">Vas a descontar los insumos de <strong>{{ editingName }}</strong> y sumar stock al producto vinculado, si tiene.</p>
        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">¿Cuántas tandas?</label>
          <input
            v-model.number="produceBatches"
            type="number"
            min="1"
            :max="liveCost?.maxBatches || undefined"
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
          <p v-if="liveCost" class="text-xs text-warm-500 mt-1">Stock alcanza para {{ liveCost.maxBatches }} {{ liveCost.maxBatches === 1 ? 'tanda' : 'tandas' }}</p>
        </div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({ title: 'Recetario | Dulce María' })

interface RecipeCard {
  id: string
  name: string
  portions: number
  is_active: boolean
  itemCount: number
  totalCost: number
  costPerPortion: number
  maxBatches: number
  hasUnpricedItem: boolean
}

// El backend ya bloquea estas acciones para STAFF con 403; esto solo oculta
// los controles que fallarían, igual que en supplies.vue.
const canWrite = ref(false)

const recipes = ref<RecipeCard[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')

const formatPrice = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))

let searchTimer: any = null
const debouncedSearch = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadRecipes, 300)
}

const loadRecipes = async () => {
  loading.value = true
  error.value = ''
  try {
    const q = search.value ? `?q=${encodeURIComponent(search.value)}` : ''
    const res = await api.get<{ ok: boolean; items: RecipeCard[] }>(`/admin/recipes${q}`)
    if (res.ok) recipes.value = res.items
  } catch (e: any) {
    error.value = e?.data?.error || 'Error al cargar recetas'
  } finally {
    loading.value = false
  }
}

// ── Equipos (hornos) ──
const equipmentList = ref<any[]>([])
const loadEquipment = async () => {
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>('/admin/equipment')
    if (res.ok) equipmentList.value = res.items
  } catch {}
}

const useEquipment = ref(false)
const showNewEquipment = ref(false)
const creatingEquipment = ref(false)
const newEquipment = ref({ name: '', energy_type: 'ELECTRIC', consumption_rate: null as number | null, consumption_unit: 'kWh' })

const onToggleEquipment = () => {
  if (!useEquipment.value) {
    form.value.equipment_id = null
    form.value.baking_time_minutes = null
  }
}

const createEquipment = async () => {
  if (!newEquipment.value.name.trim() || !newEquipment.value.consumption_rate || !newEquipment.value.consumption_unit.trim()) {
    panelError.value = 'Completá nombre, consumo y unidad del equipo'
    return
  }
  creatingEquipment.value = true
  panelError.value = ''
  try {
    const res = await api.post<{ ok: boolean; equipment: any }>('/admin/equipment', newEquipment.value)
    if (res.ok) {
      equipmentList.value.push(res.equipment)
      form.value.equipment_id = res.equipment.id
      showNewEquipment.value = false
      newEquipment.value = { name: '', energy_type: 'ELECTRIC', consumption_rate: null, consumption_unit: 'kWh' }
    }
  } catch (e: any) {
    panelError.value = e?.data?.error || 'Error al crear equipo'
  } finally {
    creatingEquipment.value = false
  }
}

// ── Panel: crear/editar receta ──
const showPanel = ref(false)
const editingId = ref<string | null>(null)
const editingName = ref('')
const saving = ref(false)
const panelError = ref('')
const liveCost = ref<any>(null)

interface DraftItem {
  _key: string
  supply_id: string
  supply_name: string
  quantity: number
  unit: string
}

const createEmptyForm = () => ({
  name: '',
  portions: 1,
  notes: '',
  equipment_id: null as string | null,
  baking_time_minutes: null as number | null,
  is_active: true,
  items: [] as DraftItem[],
})
const form = ref(createEmptyForm())

const openCreatePanel = () => {
  editingId.value = null
  editingName.value = ''
  form.value = createEmptyForm()
  useEquipment.value = false
  showNewEquipment.value = false
  liveCost.value = null
  panelError.value = ''
  showPanel.value = true
}

const openEditPanel = async (r: RecipeCard) => {
  editingId.value = r.id
  editingName.value = r.name
  panelError.value = ''
  showNewEquipment.value = false
  showPanel.value = true
  try {
    const res = await api.get<{ ok: boolean; recipe: any; items: any[]; cost: any }>(`/admin/recipes/${r.id}`)
    if (res.ok) {
      form.value = {
        name: res.recipe.name,
        portions: res.recipe.portions,
        notes: res.recipe.notes || '',
        equipment_id: res.recipe.equipment_id,
        baking_time_minutes: res.recipe.baking_time_minutes,
        is_active: res.recipe.is_active,
        items: res.items.map((it: any) => ({
          _key: it.id,
          supply_id: it.supply_id,
          supply_name: it.supply_name,
          quantity: it.quantity,
          unit: it.unit,
        })),
      }
      useEquipment.value = !!res.recipe.equipment_id
      liveCost.value = res.cost
    }
  } catch (e: any) {
    panelError.value = e?.data?.error || 'Error al cargar la receta'
  }
}

// ── Agregar insumo a la receta ──
const itemError = ref('')
const draftItem = ref({
  search: '',
  results: [] as any[],
  showDropdown: false,
  supply_id: '',
  supply_name: '',
  quantity: null as number | null,
  unit: '',
  seq: 0,
})

let draftSearchTimer: any = null
const onDraftSearchInput = () => {
  draftItem.value.showDropdown = true
  clearTimeout(draftSearchTimer)
  draftSearchTimer = setTimeout(searchDraftSupplies, 250)
}

const searchDraftSupplies = async () => {
  const seq = ++draftItem.value.seq
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/supplies?q=${encodeURIComponent(draftItem.value.search.trim())}`)
    if (seq !== draftItem.value.seq) return // llegó una respuesta vieja después de una búsqueda más nueva, se descarta
    if (res.ok) draftItem.value.results = res.items
  } catch {
    if (seq !== draftItem.value.seq) return
    draftItem.value.results = []
  }
}

const selectDraftSupply = (s: any) => {
  draftItem.value.supply_id = s.id
  draftItem.value.supply_name = s.name
  draftItem.value.unit = s.unit || ''
  draftItem.value.search = ''
  draftItem.value.results = []
  draftItem.value.showDropdown = false
}

const addDraftItem = () => {
  itemError.value = ''
  if (!draftItem.value.supply_id) { itemError.value = 'Elegí un insumo'; return }
  if (!draftItem.value.quantity || draftItem.value.quantity <= 0) { itemError.value = 'La cantidad debe ser mayor a 0'; return }
  if (!draftItem.value.unit.trim()) { itemError.value = 'Ingresá la unidad (ej: g, ml, unidad)'; return }

  form.value.items.push({
    _key: crypto.randomUUID(),
    supply_id: draftItem.value.supply_id,
    supply_name: draftItem.value.supply_name,
    quantity: draftItem.value.quantity,
    unit: draftItem.value.unit.trim(),
  })
  draftItem.value = { search: '', results: [], showDropdown: false, supply_id: '', supply_name: '', quantity: null, unit: '', seq: draftItem.value.seq }
}

const saveRecipe = async () => {
  panelError.value = ''
  if (!form.value.name.trim()) { panelError.value = 'El nombre es requerido'; return }
  if (!form.value.portions || form.value.portions <= 0) { panelError.value = 'Las porciones deben ser mayor a 0'; return }
  if (form.value.items.length === 0) { panelError.value = 'Agregá al menos un insumo'; return }

  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      portions: form.value.portions,
      notes: form.value.notes || null,
      equipment_id: useEquipment.value ? form.value.equipment_id : null,
      baking_time_minutes: useEquipment.value ? form.value.baking_time_minutes : null,
      items: form.value.items.map((it) => ({ supply_id: it.supply_id, quantity: it.quantity, unit: it.unit })),
    }
    if (editingId.value) {
      await api.put(`/admin/recipes/${editingId.value}`, payload)
      await api.patch(`/admin/recipes/${editingId.value}`, { is_active: form.value.is_active })
    } else {
      await api.post('/admin/recipes', payload)
    }
    showPanel.value = false
    await loadRecipes()
  } catch (e: any) {
    panelError.value = e?.data?.error || 'Error al guardar la receta'
  } finally {
    saving.value = false
  }
}

// ── Hacer Receta ──
const showProduceModal = ref(false)
const produceBatches = ref(1)
const producing = ref(false)
const produceError = ref('')

const openProduceModal = () => {
  produceBatches.value = 1
  produceError.value = ''
  showProduceModal.value = true
}

const confirmProduce = async () => {
  if (!editingId.value) return
  producing.value = true
  produceError.value = ''
  try {
    const res = await api.post<{ ok: boolean; restockedProducts: any[]; skippedProducts: string[] }>(
      `/admin/recipes/${editingId.value}/produce`,
      { batches: produceBatches.value }
    )
    if (res.ok) {
      showProduceModal.value = false
      let msg = `Se hicieron ${produceBatches.value} tanda(s) de "${editingName.value}".`
      if (res.restockedProducts.length > 0) msg += ` Stock sumado a: ${res.restockedProducts.map((p) => p.name).join(', ')}.`
      if (res.skippedProducts.length > 0) msg += ` No se pudo recargar (tiene variantes): ${res.skippedProducts.join(', ')}.`
      alert(msg)
      showPanel.value = false
      await loadRecipes()
    }
  } catch (e: any) {
    produceError.value = e?.data?.error || 'Error al producir la receta'
  } finally {
    producing.value = false
  }
}

onMounted(() => {
  const userStr = localStorage.getItem('user')
  if (userStr) {
    try {
      canWrite.value = JSON.parse(userStr)?.role !== 'STAFF'
    } catch {}
  }
  loadRecipes()
  loadEquipment()
})
</script>
