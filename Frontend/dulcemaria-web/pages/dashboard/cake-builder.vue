<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">Tortas Personalizadas</h1>
          <NuxtLink to="/dashboard" class="text-sm text-primary-600 hover:text-primary-500">← Dashboard</NuxtLink>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 sm:px-0 space-y-8">

        <!-- Tabs -->
        <div class="flex gap-2">
          <button :class="tab === 'config' ? 'btn-primary' : 'btn-secondary'" class="text-sm" @click="tab = 'config'">⚙️ Configuración</button>
          <button :class="tab === 'orders' ? 'btn-primary' : 'btn-secondary'" class="text-sm" @click="tab = 'orders'">📋 Pedidos</button>
        </div>

        <!-- ====== CONFIG TAB ====== -->
        <div v-if="tab === 'config'">
          <div v-if="configLoading" class="text-center py-12 text-gray-400">Cargando configuración...</div>
          <div v-else-if="configError" class="rounded-md bg-red-50 p-4 text-sm text-red-800">{{ configError }}</div>
          <div v-else class="space-y-6">
            <div v-for="cat in categories" :key="cat.id" class="bg-white rounded-lg shadow p-5">
              <!-- Category header -->
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-3">
                  <h3 class="text-lg font-semibold text-gray-800">{{ cat.label }}</h3>
                  <span class="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{{ cat.type }}</span>
                  <label class="flex items-center gap-1 cursor-pointer">
                    <input
                      v-model="cat.is_active"
                      type="checkbox"
                      class="rounded border-gray-300 text-primary-600"
                      @change="updateCategory(cat)"
                    >
                    <span class="text-xs text-gray-500">Activa</span>
                  </label>
                </div>
                <button class="btn-secondary text-xs" @click="openOptionModal(cat)">+ Agregar opción</button>
              </div>

              <!-- Options table -->
              <table class="min-w-full text-sm">
                <thead>
                  <tr class="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th class="pb-2 pr-4">Opción</th>
                    <th class="pb-2 pr-4">Precio extra</th>
                    <th class="pb-2 pr-4">Por defecto</th>
                    <th class="pb-2 pr-4">Activa</th>
                    <th class="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="cat.options.length === 0">
                    <td colspan="5" class="py-3 text-gray-400 text-xs">Sin opciones</td>
                  </tr>
                  <tr v-for="opt in cat.options" :key="opt.id" class="border-b border-gray-50">
                    <td class="py-2 pr-4">
                      <div class="font-medium text-gray-800">{{ opt.label }}</div>
                      <div v-if="opt.description" class="text-xs text-gray-400">{{ opt.description }}</div>
                    </td>
                    <td class="py-2 pr-4">
                      <span :class="opt.extra_price_clp > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'">
                        {{ opt.extra_price_clp > 0 ? `+$${formatPrice(opt.extra_price_clp)}` : 'Incluido' }}
                      </span>
                    </td>
                    <td class="py-2 pr-4">
                      <span v-if="opt.is_default" class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Base</span>
                    </td>
                    <td class="py-2 pr-4">
                      <input
                        v-model="opt.is_active"
                        type="checkbox"
                        class="rounded border-gray-300 text-primary-600"
                        @change="updateOption(opt)"
                      >
                    </td>
                    <td class="py-2 text-right">
                      <button class="text-primary-600 hover:text-primary-900 text-xs mr-2" @click="openOptionModal(cat, opt)">Editar</button>
                      <button class="text-red-400 hover:text-red-600 text-base leading-none" @click="deleteOption(opt, cat)">×</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="card">
              <label class="label">Precio base de torta (CLP)</label>
              <div class="flex gap-3 items-center">
                <input v-model.number="basePriceInput" type="number" min="0" class="input max-w-xs" placeholder="Ej: 30000">
                <p class="text-xs text-gray-400">Este es el precio mínimo antes de agregar extras. Guárdalo en localStorage.</p>
              </div>
              <button class="btn-primary text-sm mt-2" @click="saveBasePrice">Guardar precio base</button>
            </div>
          </div>
        </div>

        <!-- ====== ORDERS TAB ====== -->
        <div v-if="tab === 'orders'">
          <div class="mb-4 flex gap-2">
            <button
              v-for="s in orderStatusFilters"
              :key="s.value"
              :class="orderFilter === s.value ? 'btn-primary' : 'btn-secondary'"
              class="text-xs"
              @click="orderFilter = s.value; loadOrders()"
            >{{ s.label }}</button>
          </div>

          <div v-if="ordersLoading" class="text-center py-12 text-gray-400">Cargando pedidos...</div>
          <div v-else class="bg-white shadow sm:rounded-lg overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">N° Pedido</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cliente</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Abono 50%</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acción</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr v-if="cakeOrders.length === 0">
                  <td colspan="7" class="px-4 py-8 text-center text-gray-400">No hay pedidos</td>
                </tr>
                <tr v-for="o in cakeOrders" :key="o.id">
                  <td class="px-4 py-3 text-sm font-mono text-gray-700">{{ o.order_number }}</td>
                  <td class="px-4 py-3 text-sm text-gray-600">{{ formatDate(o.created_at) }}</td>
                  <td class="px-4 py-3">
                    <div class="text-sm font-medium text-gray-900">{{ o.customer_name }}</div>
                    <div class="text-xs text-gray-400">{{ o.customer_phone }}</div>
                  </td>
                  <td class="px-4 py-3 text-sm font-semibold text-gray-900">${{ formatPrice(o.total_price_clp) }}</td>
                  <td class="px-4 py-3 text-sm font-semibold text-orange-600">${{ formatPrice(o.deposit_clp) }}</td>
                  <td class="px-4 py-3">
                    <span :class="orderStatusClass(o.status)" class="px-2 py-1 rounded-full text-xs font-semibold">
                      {{ orderStatusLabel(o.status) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <select
                      :value="o.status"
                      class="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400"
                      @change="changeOrderStatus(o, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="s in orderStatusFilters.slice(1)" :key="s.value" :value="s.value">{{ s.label }}</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>

    <!-- Option Modal -->
    <Modal
      v-model="showOptionModal"
      :title="editingOption ? 'Editar opción' : `Nueva opción — ${selectedCategory?.label}`"
      :loading="optionSaving"
      @submit="saveOption"
    >
      <div class="space-y-4">
        <div>
          <label class="label">Nombre *</label>
          <input v-model="optionForm.label" type="text" class="input" placeholder="Ej: Chocolate">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">Precio extra (CLP)</label>
            <input v-model.number="optionForm.extra_price_clp" type="number" min="0" class="input" placeholder="0 = incluido">
          </div>
          <div v-if="selectedCategory?.type === 'SIZE'">
            <label class="label">Diámetro (cm)</label>
            <input v-model.number="optionForm.diameter_cm" type="number" min="1" class="input" placeholder="Ej: 25">
          </div>
        </div>
        <div>
          <label class="label">Descripción</label>
          <input v-model="optionForm.description" type="text" class="input" placeholder="Descripción opcional">
        </div>
        <div class="flex items-center gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="optionForm.is_default" type="checkbox" class="rounded border-gray-300 text-primary-600">
            <span class="text-sm text-gray-700">Incluido en precio base</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="optionForm.is_active" type="checkbox" class="rounded border-gray-300 text-primary-600">
            <span class="text-sm text-gray-700">Activa</span>
          </label>
        </div>
        <div v-if="optionFormError" class="text-sm text-red-600 bg-red-50 rounded p-2">{{ optionFormError }}</div>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Tortas Personalizadas' })

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
  PENDING_PAYMENT: 'bg-orange-100 text-orange-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-purple-100 text-purple-800',
  READY: 'bg-green-100 text-green-800',
  DELIVERED: 'bg-gray-100 text-gray-700',
  CANCELLED: 'bg-red-100 text-red-800',
}[s] ?? 'bg-gray-100 text-gray-700')

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
