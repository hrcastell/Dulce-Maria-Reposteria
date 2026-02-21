<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Tortas Personalizadas</h1>
      <p class="mt-1 text-warm-500">Configura opciones y gestiona pedidos de tortas personalizadas</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6">
      <button 
        :class="tab === 'config' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'" 
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="tab = 'config'"
      >
        <span class="mr-2">⚙️</span> Configuración
      </button>
      <button 
        :class="tab === 'orders' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'" 
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="tab = 'orders'"
      >
        <span class="mr-2">📋</span> Pedidos
      </button>
    </div>

    <!-- ====== CONFIG TAB ====== -->
    <div v-if="tab === 'config'">
      <!-- Loading State -->
      <div v-if="configLoading" class="flex flex-col items-center justify-center py-16">
        <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
        <p class="mt-4 text-warm-500">Cargando configuración...</p>
      </div>
      <div v-else-if="configError" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
        <div class="flex items-center gap-3">
          <span class="text-error-500 text-xl">⚠️</span>
          <p class="text-error-700">{{ configError }}</p>
        </div>
      </div>
      <div v-else class="space-y-6">
        <div v-for="cat in categories" :key="cat.id" class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
          <!-- Category header -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div class="flex items-center gap-3">
              <h3 class="text-lg font-semibold text-warm-800">{{ cat.label }}</h3>
              <span class="text-xs text-warm-500 bg-warm-100 px-2 py-0.5 rounded-lg">{{ cat.type }}</span>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  v-model="cat.is_active"
                  type="checkbox"
                  class="w-4 h-4 rounded border-warm-300 text-primary-500 focus:ring-primary-400"
                  @change="updateCategory(cat)"
                >
                <span class="text-sm text-warm-600">Activa</span>
              </label>
            </div>
            <button 
              @click="openOptionModal(cat)"
              class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-warm-100 hover:bg-warm-200 text-warm-700 font-medium rounded-xl transition-all duration-200 text-sm"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Agregar opción
            </button>
          </div>

          <!-- Desktop Options Table -->
          <div class="hidden sm:block overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="text-left text-xs font-semibold text-warm-500 border-b border-warm-100">
                  <th class="pb-2 pr-4">Opción</th>
                  <th class="pb-2 pr-4">Precio extra</th>
                  <th class="pb-2 pr-4">Por defecto</th>
                  <th class="pb-2 pr-4">Activa</th>
                  <th class="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="cat.options.length === 0">
                  <td colspan="5" class="py-4 text-warm-400 text-sm">Sin opciones configuradas</td>
                </tr>
                <tr v-for="opt in cat.options" :key="opt.id" class="border-b border-warm-50 hover:bg-warm-50/50 transition-colors">
                  <td class="py-3 pr-4">
                    <div class="font-medium text-warm-800">{{ opt.label }}</div>
                    <div v-if="opt.description" class="text-xs text-warm-400">{{ opt.description }}</div>
                  </td>
                  <td class="py-3 pr-4">
                    <span :class="opt.extra_price_clp > 0 ? 'text-primary-600 font-semibold' : 'text-warm-400'">
                      {{ opt.extra_price_clp > 0 ? `+$${formatPrice(opt.extra_price_clp)}` : 'Incluido' }}
                    </span>
                  </td>
                  <td class="py-3 pr-4">
                    <span v-if="opt.is_default" class="text-xs bg-success-100 text-success-700 px-2 py-0.5 rounded-full">Base</span>
                  </td>
                  <td class="py-3 pr-4">
                    <input
                      v-model="opt.is_active"
                      type="checkbox"
                      class="w-4 h-4 rounded border-warm-300 text-primary-500 focus:ring-primary-400"
                      @change="updateOption(opt)"
                    >
                  </td>
                  <td class="py-3 text-right">
                    <button 
                      @click="openOptionModal(cat, opt)"
                      class="text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile Options Cards -->
          <div class="sm:hidden space-y-3">
            <div v-if="cat.options.length === 0" class="text-center py-4 text-warm-400 text-sm">
              Sin opciones configuradas
            </div>
            <div 
              v-for="opt in cat.options" 
              :key="opt.id" 
              class="bg-warm-50 rounded-xl p-3 flex items-start justify-between"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-warm-800">{{ opt.label }}</span>
                  <span v-if="opt.is_default" class="text-xs bg-success-100 text-success-700 px-2 py-0.5 rounded-full">Base</span>
                </div>
                <div v-if="opt.description" class="text-xs text-warm-400 mt-0.5">{{ opt.description }}</div>
                <div class="mt-1 text-sm" :class="opt.extra_price_clp > 0 ? 'text-primary-600 font-semibold' : 'text-warm-400'">
                  {{ opt.extra_price_clp > 0 ? `+$${formatPrice(opt.extra_price_clp)}` : 'Incluido' }}
                </div>
                <label class="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    v-model="opt.is_active"
                    type="checkbox"
                    class="w-4 h-4 rounded border-warm-300 text-primary-500 focus:ring-primary-400"
                    @change="updateOption(opt)"
                  >
                  <span class="text-sm text-warm-600">Activa</span>
                </label>
              </div>
              <button 
                @click="openOptionModal(cat, opt)"
                class="text-sm text-primary-600 hover:text-primary-700 font-medium flex-shrink-0 ml-2"
              >
                Editar
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Base Price Card -->
      <div class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5">
        <label class="block text-sm font-medium text-warm-700 mb-1.5">Precio base de torta (CLP)</label>
        <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <input 
            v-model.number="basePriceInput" 
            type="number" 
            min="0" 
            class="block w-full sm:w-48 px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" 
            placeholder="Ej: 30000"
          >
          <p class="text-xs text-warm-400">Precio mínimo antes de agregar extras. Se guarda automáticamente.</p>
        </div>
        <button 
          @click="saveBasePrice"
          class="inline-flex items-center gap-2 px-4 py-2 mt-3 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 text-sm"
        >
          Guardar precio base
        </button>
      </div>
    </div>

    <!-- ====== ORDERS TAB ====== -->
    <div v-if="tab === 'orders'">
      <!-- Filter Tabs -->
      <div class="flex flex-wrap gap-2 mb-4">
        <button
          v-for="s in orderStatusFilters"
          :key="s.value"
          :class="orderFilter === s.value ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'"
          class="px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 border border-warm-200"
          @click="orderFilter = s.value; loadOrders()"
        >
          {{ s.label }}
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="ordersLoading" class="flex flex-col items-center justify-center py-16">
        <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
        <p class="mt-4 text-warm-500">Cargando pedidos...</p>
      </div>

      <div v-else class="bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
        <div class="hidden sm:block overflow-x-auto">
          <table class="min-w-full divide-y divide-warm-100">
            <thead class="bg-warm-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">N° Pedido</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Fecha</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Cliente</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Total</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Abono 50%</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Estado</th>
                <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">Acción</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-warm-100">
              <tr v-if="cakeOrders.length === 0">
                <td colspan="7" class="px-4 py-8 text-center text-warm-400">No hay pedidos</td>
              </tr>
              <tr v-for="o in cakeOrders" :key="o.id" class="hover:bg-warm-50/50 transition-colors">
                <td class="px-4 py-3 text-sm font-mono text-warm-700">{{ o.order_number }}</td>
                <td class="px-4 py-3 text-sm text-warm-600">{{ formatDate(o.created_at) }}</td>
                <td class="px-4 py-3">
                  <div class="text-sm font-medium text-warm-800">{{ o.customer_name }}</div>
                  <div class="text-xs text-warm-400">{{ o.customer_phone }}</div>
                </td>
                <td class="px-4 py-3 text-sm font-semibold text-warm-800">${{ formatPrice(o.total_price_clp) }}</td>
                <td class="px-4 py-3 text-sm font-semibold text-primary-600">${{ formatPrice(o.deposit_clp) }}</td>
                <td class="px-4 py-3">
                  <span :class="orderStatusClass(o.status)" class="px-2 py-1 rounded-full text-xs font-medium">
                    {{ orderStatusLabel(o.status) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-right">
                  <select
                    :value="o.status"
                    class="text-xs border border-warm-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                    @change="changeOrderStatus(o, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-for="s in orderStatusFilters.slice(1)" :key="s.value" :value="s.value">{{ s.label }}</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Mobile Cards -->
        <div class="sm:hidden space-y-3 p-4">
          <div v-if="cakeOrders.length === 0" class="text-center py-8 text-warm-400">
            No hay pedidos
          </div>
          <div v-for="o in cakeOrders" :key="o.id" class="bg-warm-50 rounded-xl p-4">
            <div class="flex items-start justify-between">
              <div>
                <span class="text-sm font-mono text-warm-700">{{ o.order_number }}</span>
                <span class="text-xs text-warm-400 ml-2">{{ formatDate(o.created_at) }}</span>
              </div>
              <span :class="orderStatusClass(o.status)" class="px-2 py-1 rounded-full text-xs font-medium">
                {{ orderStatusLabel(o.status) }}
              </span>
            </div>
            <div class="mt-2">
              <div class="text-sm font-medium text-warm-800">{{ o.customer_name }}</div>
              <div class="text-xs text-warm-400">{{ o.customer_phone }}</div>
            </div>
            <div class="flex items-center justify-between mt-3">
              <div>
                <div class="text-sm font-semibold text-warm-800">Total: ${{ formatPrice(o.total_price_clp) }}</div>
                <div class="text-xs text-primary-600">Abono: ${{ formatPrice(o.deposit_clp) }}</div>
              </div>
              <select
                :value="o.status"
                class="text-xs border border-warm-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                @change="changeOrderStatus(o, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="s in orderStatusFilters.slice(1)" :key="s.value" :value="s.value">{{ s.label }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Option Modal -->
    <Modal
      v-model="showOptionModal"
      :title="editingOption ? 'Editar opción' : `Nueva opción — ${selectedCategory?.label}`"
      :loading="optionSaving"
      @submit="saveOption"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1.5">Nombre *</label>
          <input 
            v-model="optionForm.label" 
            type="text" 
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" 
            placeholder="Ej: Chocolate"
          >
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Precio extra (CLP)</label>
            <input 
              v-model.number="optionForm.extra_price_clp" 
              type="number" 
              min="0" 
              class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" 
              placeholder="0 = incluido"
            >
          </div>
          <div v-if="selectedCategory?.type === 'SIZE'">
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Diámetro (cm)</label>
            <input 
              v-model.number="optionForm.diameter_cm" 
              type="number" 
              min="1" 
              class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" 
              placeholder="Ej: 25"
            >
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1.5">Descripción</label>
          <input 
            v-model="optionForm.description" 
            type="text" 
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all" 
            placeholder="Descripción opcional"
          >
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input 
              v-model="optionForm.is_default" 
              type="checkbox" 
              class="w-4 h-4 rounded border-warm-300 text-primary-500 focus:ring-primary-400"
            >
            <span class="text-sm text-warm-700">Incluido en precio base</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input 
              v-model="optionForm.is_active" 
              type="checkbox" 
              class="w-4 h-4 rounded border-warm-300 text-primary-500 focus:ring-primary-400"
            >
            <span class="text-sm text-warm-700">Activa</span>
          </label>
        </div>
        <div v-if="optionFormError" class="text-sm text-error-600 bg-error-50 rounded-lg p-3">{{ optionFormError }}</div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Tortas Personalizadas | Dulce María'
})

const api = useApi()

const tab = ref<'config' | 'orders'>('config')

// ── Config ────────────────────────────────────────────────────────────────────
const categories = ref<any[]>([])
const configLoading = ref(false)
const configError = ref('')
const basePriceInput = ref(30000)

const formatPrice = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('es-CL')

const loadConfig = async () => {
  configLoading.value = true
  configError.value = ''
  try {
    const res = await api.get<{ ok: boolean; categories: any[] }>('/admin/cake/config')
    if (res.ok) categories.value = res.categories
  } catch (e: any) {
    configError.value = e?.data?.error || 'Error al cargar configuración'
  } finally {
    configLoading.value = false
  }
}

const updateCategory = async (cat: any) => {
  try {
    await api.patch(`/admin/cake/config/categories/${cat.id}`, { is_active: cat.is_active })
  } catch (e: any) {
    console.error('Error updating category:', e)
  }
}

const updateOption = async (opt: any) => {
  try {
    await api.patch(`/admin/cake/config/options/${opt.id}`, { is_active: opt.is_active })
  } catch (e: any) {
    console.error('Error updating option:', e)
  }
}

const deleteOption = async (opt: any, cat: any) => {
  if (!confirm(`¿Eliminar la opción "${opt.label}"?`)) return
  try {
    await api.delete(`/admin/cake/config/options/${opt.id}`)
    cat.options = cat.options.filter((o: any) => o.id !== opt.id)
  } catch (e: any) {
    alert(e?.data?.error || 'Error al eliminar')
  }
}

const saveBasePrice = () => {
  localStorage.setItem('cake_base_price', String(basePriceInput.value))
  alert('Precio base guardado correctamente.')
}

// ── Option Modal ──────────────────────────────────────────────────────────────
const showOptionModal = ref(false)
const editingOption = ref<any>(null)
const selectedCategory = ref<any>(null)
const optionSaving = ref(false)
const optionFormError = ref('')
const optionForm = ref({ label: '', description: '', extra_price_clp: 0, is_default: false, diameter_cm: null as number | null, is_active: true })

const openOptionModal = (cat: any, opt?: any) => {
  selectedCategory.value = cat
  editingOption.value = opt || null
  optionFormError.value = ''
  optionForm.value = {
    label: opt?.label || '',
    description: opt?.description || '',
    extra_price_clp: opt?.extra_price_clp ?? 0,
    is_default: opt?.is_default ?? false,
    diameter_cm: opt?.diameter_cm ?? null,
    is_active: opt?.is_active ?? true,
  }
  showOptionModal.value = true
}

const saveOption = async () => {
  if (!optionForm.value.label.trim()) {
    optionFormError.value = 'El nombre es requerido'
    return
  }
  optionSaving.value = true
  optionFormError.value = ''
  try {
    const body: any = { ...optionForm.value, label: optionForm.value.label.trim() }
    if (editingOption.value) {
      const res = await api.patch<{ ok: boolean; option: any }>(`/admin/cake/config/options/${editingOption.value.id}`, body)
      if (res.ok) {
        const cat = categories.value.find(c => c.id === selectedCategory.value.id)
        if (cat) {
          const idx = cat.options.findIndex((o: any) => o.id === editingOption.value.id)
          if (idx >= 0) cat.options[idx] = { ...cat.options[idx], ...res.option }
        }
      }
    } else {
      const res = await api.post<{ ok: boolean; option: any }>('/admin/cake/config/options', { ...body, category_id: selectedCategory.value.id })
      if (res.ok) {
        const cat = categories.value.find(c => c.id === selectedCategory.value.id)
        if (cat) cat.options.push(res.option)
      }
    }
    showOptionModal.value = false
  } catch (e: any) {
    optionFormError.value = e?.data?.error || 'Error al guardar'
  } finally {
    optionSaving.value = false
  }
}

// ── Orders ────────────────────────────────────────────────────────────────────
const cakeOrders = ref<any[]>([])
const ordersLoading = ref(false)
const orderFilter = ref('')

const orderStatusFilters = [
  { value: '', label: 'Todos' },
  { value: 'PENDING_PAYMENT', label: 'Pend. Pago' },
  { value: 'CONFIRMED', label: 'Confirmado' },
  { value: 'IN_PROGRESS', label: 'En proceso' },
  { value: 'READY', label: 'Listo' },
  { value: 'DELIVERED', label: 'Entregado' },
  { value: 'CANCELLED', label: 'Cancelado' },
]

const orderStatusLabel = (s: string) => orderStatusFilters.find(f => f.value === s)?.label ?? s
const orderStatusClass = (s: string) => ({
  PENDING_PAYMENT: 'bg-warning-100 text-warning-700',
  CONFIRMED: 'bg-info-100 text-info-700',
  IN_PROGRESS: 'bg-primary-100 text-primary-700',
  READY: 'bg-success-100 text-success-700',
  DELIVERED: 'bg-warm-100 text-warm-700',
  CANCELLED: 'bg-error-100 text-error-700',
}[s] ?? 'bg-warm-100 text-warm-700')

const loadOrders = async () => {
  ordersLoading.value = true
  try {
    const q = orderFilter.value ? `?status=${orderFilter.value}` : ''
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/cake/orders${q}`)
    if (res.ok) cakeOrders.value = res.items
  } catch (e: any) {
    console.error('Error loading cake orders:', e)
  } finally {
    ordersLoading.value = false
  }
}

const changeOrderStatus = async (order: any, newStatus: string) => {
  try {
    await api.patch(`/admin/cake/orders/${order.id}/status`, { status: newStatus })
    order.status = newStatus
  } catch (e: any) {
    alert(e?.data?.error || 'Error al cambiar estado')
  }
}

onMounted(() => {
  basePriceInput.value = Number(localStorage.getItem('cake_base_price') || 30000)
  loadConfig()
  loadOrders()
})
</script>
