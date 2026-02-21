<template>
  <div>
    <!-- Page Header -->
    <div class="mb-8">
      <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Insumos y Gastos</h1>
      <p class="mt-1 text-warm-500">Control de insumos y registro de gastos</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6">
      <button 
        :class="tab === 'supplies' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'" 
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="tab = 'supplies'"
      >
        <span class="mr-2">🧂</span> Insumos
      </button>
      <button 
        :class="tab === 'expenses' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'" 
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="tab = 'expenses'"
      >
        <span class="mr-2">💸</span> Gastos
      </button>
    </div>

    <!-- ====== SUPPLIES TAB ====== -->
    <div v-if="tab === 'supplies'">
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div class="relative flex-1 max-w-md">
          <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <svg class="h-5 w-5 text-warm-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
          </div>
          <input
            v-model="supplySearch"
            type="text"
            placeholder="Buscar insumos..."
            class="block w-full pl-11 pr-4 py-3 border border-warm-200 rounded-xl text-warm-800 placeholder-warm-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
            @input="debouncedSearch"
          >
        </div>
        <button 
          @click="openSupplyModal()"
          class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Nuevo Insumo</span>
        </button>
      </div>

          <div v-if="suppliesLoading" class="flex flex-col items-center justify-center py-16">
            <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
            <p class="mt-4 text-warm-500">Cargando insumos...</p>
          </div>
          <div v-else-if="suppliesError" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
            <div class="flex items-center gap-3">
              <span class="text-error-500 text-xl">⚠️</span>
              <p class="text-error-700">{{ suppliesError }}</p>
            </div>
          </div>
          <div v-else>
            <!-- Desktop Table -->
            <div class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
              <table class="min-w-full divide-y divide-warm-100">
                <thead class="bg-warm-50">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Insumo</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Unidad</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Último Precio</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Actualizado</th>
                    <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-warm-100">
                  <tr v-if="supplies.length === 0">
                    <td colspan="5" class="px-4 py-8 text-center text-warm-400">No hay insumos registrados</td>
                  </tr>
                  <tr v-for="s in supplies" :key="s.id" class="hover:bg-warm-50/50 transition-colors">
                    <td class="px-4 py-3">
                      <div class="text-sm font-medium text-warm-800">{{ s.name }}</div>
                      <div v-if="s.notes" class="text-xs text-warm-400">{{ s.notes }}</div>
                    </td>
                    <td class="px-4 py-3 text-sm text-warm-600">{{ s.unit || '—' }}</td>
                    <td class="px-4 py-3 text-sm font-semibold text-warm-800">
                      {{ s.last_price_clp ? `$${formatPrice(s.last_price_clp)}` : '—' }}
                    </td>
                    <td class="px-4 py-3">
                      <span v-if="s.last_updated" :class="isPriceStale(s.last_updated) ? 'text-warning-600' : 'text-warm-500'" class="text-xs">
                        {{ isPriceStale(s.last_updated) ? '⚠️ ' : '' }}{{ formatDate(s.last_updated) }}
                      </span>
                      <span v-else class="text-xs text-warm-400">Sin precio</span>
                    </td>
                    <td class="px-4 py-3 text-right">
                      <button class="text-primary-600 hover:text-primary-700 text-sm font-medium" @click="openSupplyModal(s)">Editar</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Mobile Cards -->
            <div class="sm:hidden space-y-3">
              <div v-if="supplies.length === 0" class="text-center py-8 text-warm-400">
                No hay insumos registrados
              </div>
              <div v-for="s in supplies" :key="s.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
                <div class="flex items-start gap-3">
                  <div class="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-xl flex-shrink-0">
                    🧂
                  </div>
                  <div class="flex-1 min-w-0">
                    <h3 class="font-semibold text-warm-800 truncate">{{ s.name }}</h3>
                    <p v-if="s.notes" class="text-xs text-warm-400 mt-0.5 truncate">{{ s.notes }}</p>
                    
                    <div class="mt-2 flex items-center justify-between text-sm">
                      <div class="text-warm-500">
                        <span class="block">Unidad: <span class="text-warm-700 font-medium">{{ s.unit || '—' }}</span></span>
                        <span class="block mt-0.5 text-xs">
                          {{ s.last_updated ? formatDate(s.last_updated) : '—' }}
                          <span v-if="isPriceStale(s.last_updated)">⚠️</span>
                        </span>
                      </div>
                      <div class="text-right">
                        <p class="text-xs text-warm-400">Precio</p>
                        <p class="font-bold text-warm-800 text-lg">
                          {{ s.last_price_clp ? `$${formatPrice(s.last_price_clp)}` : '—' }}
                        </p>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-warm-100">
                      <button 
                        class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors"
                        @click="openSupplyModal(s)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                        </svg>
                        Editar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ====== EXPENSES TAB ====== -->
        <div v-if="tab === 'expenses'">
          <!-- Month selector -->
          <div class="card mb-4 flex flex-wrap gap-4 items-end">
            <div>
              <label class="label">Año</label>
              <input v-model.number="expYear" type="number" min="2020" max="2099" class="input w-28" @change="loadExpenses">
            </div>
            <div>
              <label class="label">Mes</label>
              <select v-model.number="expMonth" class="input" @change="loadExpenses">
                <option v-for="m in months" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </div>
            <button class="btn-secondary text-sm" @click="loadExpenses">🔄 Actualizar</button>
            <div class="ml-auto">
              <p class="text-sm text-gray-500">Total gastos del mes:</p>
              <p class="text-2xl font-bold text-red-500">${{ formatPrice(expensesTotal) }}</p>
            </div>
          </div>

          <!-- Add expense form -->
          <div class="card mb-4">
            <h3 class="text-sm font-semibold text-gray-700 mb-3">Registrar gasto</h3>
            <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input v-model="newExpense.description" type="text" placeholder="Descripción *" class="input sm:col-span-2">
              <input v-model.number="newExpense.amount_clp" type="number" min="1" placeholder="Monto CLP *" class="input">
              <input v-model="newExpense.expense_date" type="date" class="input">
              <select v-model="newExpense.supply_id" class="input sm:col-span-2">
                <option value="">Sin insumo asociado</option>
                <option v-for="s in supplies" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <input v-model="newExpense.notes" type="text" placeholder="Notas (opcional)" class="input">
              <button :disabled="expenseSaving" class="btn-primary text-sm disabled:opacity-50" @click="addExpense">
                {{ expenseSaving ? 'Guardando...' : '+ Agregar' }}
              </button>
            </div>
            <div v-if="expenseError" class="mt-2 text-sm text-red-600">{{ expenseError }}</div>
          </div>

          <!-- Expenses list -->
          <div v-if="expensesLoading" class="flex flex-col items-center justify-center py-16">
            <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
            <p class="mt-4 text-warm-500">Cargando gastos...</p>
          </div>
          <div v-else>
            <!-- Desktop Table -->
            <div class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
              <table class="min-w-full divide-y divide-warm-100">
                <thead class="bg-warm-50">
                  <tr>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Fecha</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Descripción</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Insumo</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Monto</th>
                    <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Eliminar</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-warm-100">
                  <tr v-if="expenses.length === 0">
                    <td colspan="5" class="px-4 py-8 text-center text-warm-400">No hay gastos registrados este mes</td>
                  </tr>
                  <tr v-for="e in expenses" :key="e.id" class="hover:bg-warm-50/50 transition-colors">
                    <td class="px-4 py-3 text-sm text-warm-600">{{ e.expense_date }}</td>
                    <td class="px-4 py-3">
                      <div class="text-sm text-warm-800">{{ e.description }}</div>
                      <div v-if="e.notes" class="text-xs text-warm-400">{{ e.notes }}</div>
                    </td>
                    <td class="px-4 py-3 text-sm text-warm-500">{{ e.supply_name || '—' }}</td>
                    <td class="px-4 py-3 text-sm font-semibold text-error-500">${{ formatPrice(e.amount_clp) }}</td>
                    <td class="px-4 py-3 text-right">
                      <button class="text-error-400 hover:text-error-600 text-lg leading-none" @click="deleteExpense(e.id)">×</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Mobile Cards -->
            <div class="sm:hidden space-y-3">
              <div v-if="expenses.length === 0" class="text-center py-8 text-warm-400">
                No hay gastos registrados este mes
              </div>
              <div v-for="e in expenses" :key="e.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
                <div class="flex items-start gap-3">
                  <div class="w-12 h-12 rounded-full bg-error-100 flex items-center justify-center text-xl flex-shrink-0">
                    💸
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-warm-500 bg-warm-100 px-2 py-0.5 rounded-full">{{ e.expense_date }}</span>
                      <span class="font-bold text-error-500">${{ formatPrice(e.amount_clp) }}</span>
                    </div>
                    <h3 class="font-medium text-warm-800 mt-2 truncate">{{ e.description }}</h3>
                    <p v-if="e.notes" class="text-xs text-warm-400 truncate">{{ e.notes }}</p>
                    <p v-if="e.supply_name" class="text-xs text-primary-600 mt-1 truncate">📦 {{ e.supply_name }}</p>
                    
                    <div class="flex items-center gap-2 mt-3 pt-3 border-t border-warm-100">
                      <button 
                        class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-error-600 bg-error-50 hover:bg-error-100 rounded-lg transition-colors"
                        @click="deleteExpense(e.id)"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

    <!-- Supply Modal -->
    <Modal
      v-model="showSupplyModal"
      :title="editingSupply ? 'Editar Insumo' : 'Nuevo Insumo'"
      :loading="supplySaving"
      @submit="saveSupply"
    >
      <div class="space-y-4">
        <div>
          <label class="label">Nombre *</label>
          <input v-model="supplyForm.name" type="text" class="input" placeholder="Ej: Harina">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">Unidad</label>
            <input v-model="supplyForm.unit" type="text" class="input" placeholder="kg, lt, unidad...">
          </div>
          <div>
            <label class="label">Último precio (CLP)</label>
            <input v-model.number="supplyForm.last_price_clp" type="number" min="0" class="input" placeholder="0">
          </div>
        </div>
        <div>
          <label class="label">Notas</label>
          <textarea v-model="supplyForm.notes" rows="2" class="input" placeholder="Notas opcionales"></textarea>
        </div>
        <div v-if="supplyFormError" class="text-sm text-red-600 bg-red-50 rounded p-2">{{ supplyFormError }}</div>
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

useHead({ title: 'Insumos y Gastos | Dulce María' })

const tab = ref<'supplies' | 'expenses'>('supplies')

// ── Supplies ─────────────────────────────────────────────────────────────────
const supplies = ref<any[]>([])
const suppliesLoading = ref(false)
const suppliesError = ref('')
const supplySearch = ref('')
const showSupplyModal = ref(false)
const editingSupply = ref<any>(null)
const supplySaving = ref(false)
const supplyFormError = ref('')
const supplyForm = ref({ name: '', unit: '', last_price_clp: null as number | null, notes: '' })

const now = new Date()
const months = [
  { value: 1, label: 'Enero' }, { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' }, { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' }, { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' }, { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' }, { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' }, { value: 12, label: 'Diciembre' }
]

const formatPrice = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n))
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('es-CL')
const isPriceStale = (iso: string) => {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)
  return diff > 30
}

let searchTimer: any = null
const debouncedSearch = () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadSupplies, 300)
}

const loadSupplies = async () => {
  suppliesLoading.value = true
  suppliesError.value = ''
  try {
    const q = supplySearch.value ? `?q=${encodeURIComponent(supplySearch.value)}` : ''
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/supplies${q}`)
    if (res.ok) supplies.value = res.items
  } catch (e: any) {
    suppliesError.value = e?.data?.error || 'Error al cargar insumos'
  } finally {
    suppliesLoading.value = false
  }
}

const openSupplyModal = (supply?: any) => {
  editingSupply.value = supply || null
  supplyFormError.value = ''
  supplyForm.value = {
    name: supply?.name || '',
    unit: supply?.unit || '',
    last_price_clp: supply?.last_price_clp ?? null,
    notes: supply?.notes || '',
  }
  showSupplyModal.value = true
}

const saveSupply = async () => {
  if (!supplyForm.value.name.trim()) {
    supplyFormError.value = 'El nombre es requerido'
    return
  }
  supplySaving.value = true
  supplyFormError.value = ''
  try {
    const body = {
      name: supplyForm.value.name.trim(),
      unit: supplyForm.value.unit || null,
      last_price_clp: supplyForm.value.last_price_clp || null,
      notes: supplyForm.value.notes || null,
    }
    if (editingSupply.value) {
      await api.patch(`/admin/supplies/${editingSupply.value.id}`, body)
    } else {
      await api.post('/admin/supplies', body)
    }
    showSupplyModal.value = false
    await loadSupplies()
  } catch (e: any) {
    supplyFormError.value = e?.data?.error || 'Error al guardar'
  } finally {
    supplySaving.value = false
  }
}

// ── Expenses ──────────────────────────────────────────────────────────────────
const expenses = ref<any[]>([])
const expensesTotal = ref(0)
const expensesLoading = ref(false)
const expYear = ref(now.getFullYear())
const expMonth = ref(now.getMonth() + 1)
const expenseSaving = ref(false)
const expenseError = ref('')
const newExpense = ref({ description: '', amount_clp: null as number | null, expense_date: now.toISOString().split('T')[0], supply_id: '', notes: '' })

const loadExpenses = async () => {
  expensesLoading.value = true
  try {
    const mm = String(expMonth.value).padStart(2, '0')
    const res = await api.get<{ ok: boolean; items: any[]; total_clp: number }>(`/admin/supplies/expenses?year=${expYear.value}&month=${mm}`)
    if (res.ok) {
      expenses.value = res.items
      expensesTotal.value = res.total_clp
    }
  } catch (e: any) {
    console.error('Error loading expenses:', e)
  } finally {
    expensesLoading.value = false
  }
}

const addExpense = async () => {
  if (!newExpense.value.description.trim() || !newExpense.value.amount_clp) {
    expenseError.value = 'Descripción y monto son requeridos'
    return
  }
  expenseSaving.value = true
  expenseError.value = ''
  try {
    await api.post('/admin/supplies/expenses', {
      description: newExpense.value.description.trim(),
      amount_clp: newExpense.value.amount_clp,
      expense_date: newExpense.value.expense_date,
      supply_id: newExpense.value.supply_id || null,
      notes: newExpense.value.notes || null,
    })
    newExpense.value = { description: '', amount_clp: null, expense_date: now.toISOString().split('T')[0], supply_id: '', notes: '' }
    await loadExpenses()
  } catch (e: any) {
    expenseError.value = e?.data?.error || 'Error al registrar gasto'
  } finally {
    expenseSaving.value = false
  }
}

const deleteExpense = async (id: string) => {
  if (!confirm('¿Eliminar este gasto?')) return
  try {
    await api.delete(`/admin/supplies/expenses/${id}`)
    await loadExpenses()
  } catch (e: any) {
    alert(e?.data?.error || 'Error al eliminar')
  }
}

onMounted(() => {
  loadSupplies()
  loadExpenses()
})
</script>
