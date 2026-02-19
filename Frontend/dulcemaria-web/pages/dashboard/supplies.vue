<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">Insumos y Gastos</h1>
          <NuxtLink to="/dashboard" class="text-sm text-primary-600 hover:text-primary-500">← Dashboard</NuxtLink>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 sm:px-0 space-y-8">

        <!-- Tabs -->
        <div class="flex gap-2">
          <button :class="tab === 'supplies' ? 'btn-primary' : 'btn-secondary'" class="text-sm" @click="tab = 'supplies'">
            🧂 Insumos
          </button>
          <button :class="tab === 'expenses' ? 'btn-primary' : 'btn-secondary'" class="text-sm" @click="tab = 'expenses'">
            💸 Gastos del mes
          </button>
        </div>

        <!-- ====== SUPPLIES TAB ====== -->
        <div v-if="tab === 'supplies'">
          <div class="mb-4 flex flex-wrap gap-3 items-center justify-between">
            <input
              v-model="supplySearch"
              type="text"
              placeholder="Buscar por nombre..."
              class="input max-w-xs"
              @input="debouncedSearch"
            >
            <button class="btn-primary text-sm" @click="openSupplyModal()">+ Nuevo insumo</button>
          </div>

          <div v-if="suppliesLoading" class="text-center py-12 text-gray-400">Cargando...</div>
          <div v-else-if="suppliesError" class="rounded-md bg-red-50 p-4 text-sm text-red-800">{{ suppliesError }}</div>
          <div v-else class="bg-white shadow sm:rounded-lg overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Insumo</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unidad</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Último Precio</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actualizado</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr v-if="supplies.length === 0">
                  <td colspan="5" class="px-4 py-8 text-center text-gray-400">No hay insumos registrados</td>
                </tr>
                <tr v-for="s in supplies" :key="s.id">
                  <td class="px-4 py-3">
                    <div class="text-sm font-medium text-gray-900">{{ s.name }}</div>
                    <div v-if="s.notes" class="text-xs text-gray-400">{{ s.notes }}</div>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-600">{{ s.unit || '—' }}</td>
                  <td class="px-4 py-3 text-sm font-semibold text-gray-900">
                    {{ s.last_price_clp ? `$${formatPrice(s.last_price_clp)}` : '—' }}
                  </td>
                  <td class="px-4 py-3">
                    <span v-if="s.last_updated" :class="isPriceStale(s.last_updated) ? 'text-orange-500' : 'text-gray-500'" class="text-xs">
                      {{ isPriceStale(s.last_updated) ? '⚠️ ' : '' }}{{ formatDate(s.last_updated) }}
                    </span>
                    <span v-else class="text-xs text-gray-400">Sin precio</span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <button class="text-primary-600 hover:text-primary-900 text-sm mr-3" @click="openSupplyModal(s)">Editar</button>
                  </td>
                </tr>
              </tbody>
            </table>
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
          <div v-if="expensesLoading" class="text-center py-12 text-gray-400">Cargando...</div>
          <div v-else class="bg-white shadow sm:rounded-lg overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Descripción</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Insumo</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Monto</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Eliminar</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr v-if="expenses.length === 0">
                  <td colspan="5" class="px-4 py-8 text-center text-gray-400">No hay gastos registrados este mes</td>
                </tr>
                <tr v-for="e in expenses" :key="e.id">
                  <td class="px-4 py-3 text-sm text-gray-600">{{ e.expense_date }}</td>
                  <td class="px-4 py-3">
                    <div class="text-sm text-gray-900">{{ e.description }}</div>
                    <div v-if="e.notes" class="text-xs text-gray-400">{{ e.notes }}</div>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-500">{{ e.supply_name || '—' }}</td>
                  <td class="px-4 py-3 text-sm font-semibold text-red-500">${{ formatPrice(e.amount_clp) }}</td>
                  <td class="px-4 py-3 text-right">
                    <button class="text-red-400 hover:text-red-600 text-lg leading-none" @click="deleteExpense(e.id)">×</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </main>

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

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Insumos y Gastos' })

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
