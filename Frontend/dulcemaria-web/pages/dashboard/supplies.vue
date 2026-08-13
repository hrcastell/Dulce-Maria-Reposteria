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
          v-if="canWrite"
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
                      <button v-if="canWrite" class="text-primary-600 hover:text-primary-700 text-sm font-medium" @click="openSupplyModal(s)">Editar</button>
                      <span v-else class="text-warm-300 text-sm">—</span>
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

                    <div v-if="canWrite" class="flex items-center gap-2 mt-3 pt-3 border-t border-warm-100">
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
          <div v-if="!canWrite" class="bg-warm-50 rounded-2xl border border-dashed border-warm-200 p-5 mb-4 text-center text-sm text-warm-500">
            No tenés permisos para registrar gastos. Consultá a un administrador.
          </div>
          <div v-else class="bg-white rounded-2xl shadow-soft border border-warm-100 p-5 mb-4">
            <h3 class="text-lg font-semibold text-warm-800 mb-4">Registrar Gasto</h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input v-model="newExpense.description" type="text" placeholder="Descripción / N° boleta *" class="input sm:col-span-2">
              <input v-model="newExpense.expense_date" type="date" class="input">
            </div>

            <!-- Proveedor: buscador + creación/eliminación inline -->
            <div class="mt-3">
              <label class="block text-xs font-medium text-warm-500 mb-1">Proveedor (opcional)</label>
              <div class="relative max-w-md">
                <input
                  type="text"
                  v-model="providerSearch"
                  placeholder="Buscar proveedor..."
                  class="block w-full pl-3 pr-8 py-2.5 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                  @focus="onProviderSearchInput()"
                  @input="onProviderSearchInput()"
                  @blur="showProviderDropdown = false"
                >
                <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-warm-400">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </div>

                <div
                  v-if="showProviderDropdown && !showCreateProvider && providerResults.length > 0"
                  class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
                >
                  <div v-for="p in providerResults" :key="p.id" class="flex items-center justify-between px-2 py-1 hover:bg-primary-50 transition-colors text-sm border-b border-warm-50 last:border-0">
                    <button type="button" class="flex-1 text-left px-2 py-1 font-medium text-warm-800" @mousedown.prevent="selectProvider(p)">
                      {{ p.name }}
                    </button>
                    <button
                      type="button"
                      :disabled="deletingProviderId === p.id"
                      class="p-1.5 text-warm-300 hover:text-error-500 hover:bg-error-50 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
                      aria-label="Eliminar proveedor"
                      @mousedown.prevent="deleteProvider(p)"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  </div>
                </div>
                <div
                  v-else-if="showProviderDropdown && !showCreateProvider && providerSearch"
                  class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg p-3"
                >
                  <p class="text-center text-xs text-warm-500 mb-2">No se encontró "{{ providerSearch }}"</p>
                  <button
                    type="button"
                    class="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 py-1"
                    @mousedown.prevent="showCreateProvider = true"
                  >
                    + Crear proveedor "{{ providerSearch }}"
                  </button>
                </div>
              </div>

              <div v-if="newExpense.provider_id" class="mt-2 flex items-center gap-2 text-xs text-primary-700 bg-primary-50 px-2 py-1 rounded-lg inline-block">
                <span class="font-bold">✓</span> {{ newExpense.provider_name }}
                <button type="button" class="ml-1 text-primary-400 hover:text-primary-600 font-bold" @click="clearProviderSelection">×</button>
              </div>

              <div v-if="showCreateProvider" class="mt-2 max-w-md p-3 bg-warm-50 rounded-xl border border-warm-200 space-y-2">
                <p class="text-xs text-warm-600">Nuevo proveedor: <span class="font-semibold">{{ providerSearch }}</span></p>
                <div class="flex gap-2">
                  <button type="button" :disabled="creatingProvider" class="btn-primary text-sm flex-1 disabled:opacity-50" @click="createProvider">
                    {{ creatingProvider ? 'Creando...' : 'Crear y usar' }}
                  </button>
                  <button type="button" class="btn-secondary text-sm" @click="showCreateProvider = false">Cancelar</button>
                </div>
              </div>
              <p v-if="providerError" class="mt-1 text-xs text-error-600">{{ providerError }}</p>
            </div>

            <!-- Simple mode: solo aparece si no hay detalle cargado -->
            <div v-if="newExpense.items.length === 0" class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <input v-model.number="newExpense.amount_clp" type="number" min="1" placeholder="Monto CLP *" class="input">
              <select v-model="newExpense.supply_id" class="input">
                <option value="">Sin insumo asociado</option>
                <option v-for="s in allSupplies" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <input v-model="newExpense.notes" type="text" placeholder="Notas (opcional)" class="input">
            </div>
            <div v-else class="mt-3">
              <input v-model="newExpense.notes" type="text" placeholder="Notas (opcional)" class="input">
            </div>

            <!-- Detalle de la boleta/factura -->
            <div class="mt-4 pt-4 border-t border-warm-100">
              <div class="flex items-center justify-between mb-3">
                <h4 class="text-sm font-semibold text-warm-700">Detalle de productos (opcional)</h4>
                <button type="button" class="text-sm font-medium text-primary-600 hover:text-primary-700" @click="openAddExpenseItemModal">
                  + Agregar producto
                </button>
              </div>

              <div v-if="newExpense.items.length === 0" class="text-center py-4 bg-warm-50 rounded-xl border border-dashed border-warm-200 text-xs text-warm-500">
                Sin productos en el detalle. El monto se ingresa manualmente arriba.
              </div>

              <div v-else class="space-y-2">
                <div v-for="(item, index) in newExpense.items" :key="item._key" class="flex items-center justify-between gap-3 bg-warm-50 px-3 py-2.5 rounded-xl border border-warm-100">
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-warm-800 truncate">{{ item.product_name }}</p>
                    <p class="text-xs text-warm-500">{{ item.quantity }} x ${{ formatPrice(item.unit_price_clp) }}</p>
                  </div>
                  <p class="text-sm font-semibold text-warm-800 flex-shrink-0">${{ formatPrice(item.total_clp) }}</p>
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <button type="button" class="p-1.5 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" aria-label="Editar" @click="openEditExpenseItemModal(index)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <button type="button" class="p-1.5 text-warm-400 hover:text-error-500 hover:bg-error-50 rounded-lg transition-colors" aria-label="Eliminar" @click="removeExpenseItem(index)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                  </div>
                </div>

                <!-- Desglose IVA -->
                <div class="bg-primary-50 rounded-xl p-3 space-y-1 mt-2">
                  <div class="flex justify-between text-xs text-warm-600">
                    <span>Subtotal neto:</span>
                    <span>${{ formatPrice(expenseIvaBreakdown.net) }}</span>
                  </div>
                  <div class="flex justify-between text-xs text-warm-600">
                    <span>IVA (19%):</span>
                    <span>${{ formatPrice(expenseIvaBreakdown.iva) }}</span>
                  </div>
                  <div class="flex justify-between text-sm font-bold text-warm-800 pt-1 border-t border-primary-100">
                    <span>Total boleta/factura:</span>
                    <span>${{ formatPrice(expenseIvaBreakdown.total) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-4 flex justify-end">
              <button :disabled="expenseSaving" class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft disabled:opacity-50" @click="addExpense">
                {{ expenseSaving ? 'Guardando...' : '+ Registrar Gasto' }}
              </button>
            </div>
            <div v-if="expenseError" class="mt-2 text-sm text-error-600">{{ expenseError }}</div>
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
                      <div v-if="e.provider_name" class="text-xs text-warm-500 mt-0.5">🏢 {{ e.provider_name }}</div>
                      <div v-if="e.items && e.items.length > 0" class="text-xs text-primary-600 mt-0.5">
                        🧾 {{ e.items.map((i) => i.product_name_snapshot).join(', ') }}
                      </div>
                    </td>
                    <td class="px-4 py-3 text-sm text-warm-500">{{ e.supply_name || (e.items && e.items.length > 0 ? `${e.items.length} productos` : '—') }}</td>
                    <td class="px-4 py-3 text-sm font-semibold text-error-500">${{ formatPrice(e.amount_clp) }}</td>
                    <td class="px-4 py-3 text-right">
                      <button v-if="canWrite" class="text-error-400 hover:text-error-600 text-lg leading-none" @click="deleteExpense(e.id)">×</button>
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
                    <p v-if="e.provider_name" class="text-xs text-warm-500 mt-1 truncate">🏢 {{ e.provider_name }}</p>
                    <p v-if="e.supply_name" class="text-xs text-primary-600 mt-1 truncate">📦 {{ e.supply_name }}</p>
                    <p v-if="e.items && e.items.length > 0" class="text-xs text-primary-600 mt-1 truncate">
                      🧾 {{ e.items.map((i) => i.product_name_snapshot).join(', ') }}
                    </p>
                    
                    <div v-if="canWrite" class="flex items-center gap-2 mt-3 pt-3 border-t border-warm-100">
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

    <!-- Expense Item Modal -->
    <Modal
      v-model="showExpenseItemModal"
      :title="editingExpenseItemIndex === null ? 'Agregar Producto al Detalle' : 'Editar Producto'"
      submit-text="Aceptar"
      @submit="confirmExpenseItemModal"
    >
      <div class="space-y-4">
        <div v-if="expenseItemModalError" class="rounded-xl bg-error-50 p-3 border border-error-100 text-sm text-error-700">
          {{ expenseItemModalError }}
        </div>

        <div>
          <label class="label">Producto (Insumo) *</label>
          <div class="relative">
            <input
              type="text"
              v-model="draftExpenseItem._supplySearch"
              placeholder="Buscar insumo..."
              class="block w-full pl-3 pr-8 py-2.5 border border-warm-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              @focus="onSupplySearchInput(draftExpenseItem)"
              @input="onSupplySearchInput(draftExpenseItem)"
              @blur="draftExpenseItem._showSupplyDropdown = false"
            >
            <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-warm-400">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            </div>

            <div
              v-if="draftExpenseItem._showSupplyDropdown && !draftExpenseItem._showCreateSupply && filteredSuppliesFor(draftExpenseItem).length > 0"
              class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
            >
              <div
                v-for="s in filteredSuppliesFor(draftExpenseItem)"
                :key="s.id"
                class="px-4 py-2 hover:bg-primary-50 cursor-pointer transition-colors text-sm border-b border-warm-50 last:border-0"
                @mousedown.prevent="selectSupplyForItem(draftExpenseItem, s)"
              >
                <div class="font-medium text-warm-800">{{ s.name }}</div>
                <div class="text-xs text-warm-500">{{ s.unit || 'Sin unidad' }} · {{ s.last_price_clp ? `$${formatPrice(s.last_price_clp)}` : 'Sin precio' }}</div>
              </div>
            </div>
            <div
              v-else-if="draftExpenseItem._showSupplyDropdown && !draftExpenseItem._showCreateSupply && draftExpenseItem._supplySearch"
              class="absolute z-10 w-full mt-1 bg-white border border-warm-200 rounded-xl shadow-lg p-3"
            >
              <p class="text-center text-xs text-warm-500 mb-2">No se encontró "{{ draftExpenseItem._supplySearch }}"</p>
              <button
                type="button"
                class="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 py-1"
                @mousedown.prevent="draftExpenseItem._showCreateSupply = true"
              >
                + Crear insumo "{{ draftExpenseItem._supplySearch }}"
              </button>
            </div>
          </div>

          <div v-if="draftExpenseItem.supply_id" class="mt-2 flex items-center gap-2 text-xs text-primary-700 bg-primary-50 px-2 py-1 rounded-lg inline-block">
            <span class="font-bold">✓</span> {{ draftExpenseItem.product_name }}
            <button type="button" class="ml-1 text-primary-400 hover:text-primary-600 font-bold" @click="clearSupplySelection(draftExpenseItem)">×</button>
          </div>

          <!-- Creación inline de insumo -->
          <div v-if="draftExpenseItem._showCreateSupply" class="mt-2 p-3 bg-warm-50 rounded-xl border border-warm-200 space-y-2">
            <p class="text-xs text-warm-600">Nuevo insumo: <span class="font-semibold">{{ draftExpenseItem._supplySearch }}</span></p>
            <input v-model="draftExpenseItem._createUnit" type="text" placeholder="Unidad (kg, lt, unidad...)" class="input text-sm">
            <div class="flex gap-2">
              <button
                type="button"
                :disabled="draftExpenseItem._creatingSupply"
                class="btn-primary text-sm flex-1 disabled:opacity-50"
                @click="createSupplyForItem(draftExpenseItem)"
              >
                {{ draftExpenseItem._creatingSupply ? 'Creando...' : 'Crear y usar' }}
              </button>
              <button type="button" class="btn-secondary text-sm" @click="draftExpenseItem._showCreateSupply = false">Cancelar</button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="label">Cantidad *</label>
            <input v-model.number="draftExpenseItem.quantity" type="number" min="0.001" step="0.001" class="input">
          </div>
          <div>
            <label class="label">Precio Unitario (CLP, c/IVA) *</label>
            <input v-model.number="draftExpenseItem.unit_price_clp" type="number" min="0" class="input">
          </div>
        </div>

        <div class="flex justify-between items-center pt-3 border-t border-warm-100 text-sm">
          <span class="text-warm-500">Total línea:</span>
          <span class="font-bold text-warm-800">${{ formatPrice((draftExpenseItem.quantity || 0) * (draftExpenseItem.unit_price_clp || 0)) }}</span>
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

useHead({ title: 'Insumos y Gastos | Dulce María' })

const tab = ref<'supplies' | 'expenses'>('supplies')

// El backend ya bloquea estas acciones para STAFF con 403; esto solo oculta
// los controles que fallarían, en vez de dejar que el usuario los toque y falle.
const currentUserRole = ref('')
const canWrite = computed(() => currentUserRole.value !== 'STAFF')

// ── Supplies ─────────────────────────────────────────────────────────────────
const supplies = ref<any[]>([])
// Catálogo completo, sin filtrar, para el <select> de insumo del modo simple de
// gastos — no puede depender de `supplies`, que el buscador del tab Insumos acota.
const allSupplies = ref<any[]>([])
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

const loadAllSupplies = async () => {
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>('/admin/supplies')
    if (res.ok) allSupplies.value = res.items
  } catch (e: any) {
    console.error('Error loading full supplies catalog:', e)
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
    await loadAllSupplies()
  } catch (e: any) {
    supplyFormError.value = e?.data?.error || 'Error al guardar'
  } finally {
    supplySaving.value = false
  }
}

// ── Expenses ──────────────────────────────────────────────────────────────────
const IVA_RATE = 0.19

interface ExpenseItem {
  _key: string
  supply_id: string
  product_name: string
  quantity: number
  unit_price_clp: number
  total_clp: number
}

interface DraftExpenseItem {
  supply_id: string
  product_name: string
  quantity: number | null
  unit_price_clp: number | null
  _supplySearch: string
  _searchResults: any[]
  _searchSeq: number
  _showSupplyDropdown: boolean
  _showCreateSupply: boolean
  _createUnit: string
  _creatingSupply: boolean
}

const createEmptyExpenseItem = (): DraftExpenseItem => ({
  supply_id: '',
  product_name: '',
  quantity: 1,
  unit_price_clp: null,
  _supplySearch: '',
  _searchResults: [],
  _searchSeq: 0,
  _showSupplyDropdown: false,
  _showCreateSupply: false,
  _createUnit: '',
  _creatingSupply: false,
})

const expenses = ref<any[]>([])
const expensesTotal = ref(0)
const expensesLoading = ref(false)
const expYear = ref(now.getFullYear())
const expMonth = ref(now.getMonth() + 1)
const expenseSaving = ref(false)
const expenseError = ref('')
const newExpense = ref({
  description: '',
  amount_clp: null as number | null,
  expense_date: now.toISOString().split('T')[0],
  supply_id: '',
  provider_id: '',
  provider_name: '',
  notes: '',
  items: [] as ExpenseItem[],
})

const showExpenseItemModal = ref(false)
const editingExpenseItemIndex = ref<number | null>(null)
const draftExpenseItem = ref<DraftExpenseItem>(createEmptyExpenseItem())
const expenseItemModalError = ref('')

// ── Proveedores (buscador + creación/eliminación inline en el form de gasto) ──
const providerSearch = ref('')
const providerResults = ref<any[]>([])
const showProviderDropdown = ref(false)
const showCreateProvider = ref(false)
const creatingProvider = ref(false)
const deletingProviderId = ref<string | null>(null)
const providerError = ref('')

let providerSearchTimer: any = null
let providerSearchSeq = 0
const searchProviders = async () => {
  const seq = ++providerSearchSeq
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/providers?q=${encodeURIComponent(providerSearch.value.trim())}`)
    if (seq !== providerSearchSeq) return // llegó una respuesta vieja después de una búsqueda más nueva, se descarta
    if (res.ok) providerResults.value = res.items
  } catch (e) {
    if (seq !== providerSearchSeq) return
    providerResults.value = []
  }
}

const onProviderSearchInput = () => {
  showProviderDropdown.value = true
  showCreateProvider.value = false
  clearTimeout(providerSearchTimer)
  providerSearchTimer = setTimeout(searchProviders, 250)
}

const selectProvider = (p: any) => {
  newExpense.value.provider_id = p.id
  newExpense.value.provider_name = p.name
  providerSearch.value = ''
  providerResults.value = []
  showProviderDropdown.value = false
  showCreateProvider.value = false
}

const clearProviderSelection = () => {
  newExpense.value.provider_id = ''
  newExpense.value.provider_name = ''
}

const createProvider = async () => {
  const name = providerSearch.value.trim()
  if (!name) return
  creatingProvider.value = true
  providerError.value = ''
  try {
    const res = await api.post<{ ok: boolean; provider: any }>('/admin/providers', { name })
    if (res.ok) selectProvider(res.provider)
  } catch (e: any) {
    providerError.value = e?.data?.error || 'Error al crear proveedor'
  } finally {
    creatingProvider.value = false
  }
}

const deleteProvider = async (p: any) => {
  if (!confirm(`¿Eliminar el proveedor "${p.name}"?`)) return
  deletingProviderId.value = p.id
  providerError.value = ''
  try {
    await api.delete(`/admin/providers/${p.id}`)
    providerResults.value = providerResults.value.filter((x) => x.id !== p.id)
    if (newExpense.value.provider_id === p.id) clearProviderSelection()
  } catch (e: any) {
    providerError.value = e?.data?.error || 'Error al eliminar proveedor'
  } finally {
    deletingProviderId.value = null
  }
}

const expenseItemsTotal = computed(() => newExpense.value.items.reduce((sum, it) => sum + it.total_clp, 0))
const expenseIvaBreakdown = computed(() => {
  const total = expenseItemsTotal.value
  const net = Math.round(total / (1 + IVA_RATE))
  return { net, iva: total - net, total }
})

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

// Búsqueda propia (no reutiliza `supplies`, que puede venir acotado por el
// buscador del tab Insumos) para que el picker del detalle siempre vea el catálogo completo.
let expenseItemSearchTimer: any = null
const searchSuppliesForItem = async (item: DraftExpenseItem) => {
  const seq = ++item._searchSeq
  try {
    const res = await api.get<{ ok: boolean; items: any[] }>(`/admin/supplies?q=${encodeURIComponent(item._supplySearch.trim())}`)
    if (seq !== item._searchSeq) return // llegó una respuesta vieja después de una búsqueda más nueva, se descarta
    if (res.ok) item._searchResults = res.items
  } catch (e) {
    if (seq !== item._searchSeq) return
    item._searchResults = []
  }
}

const onSupplySearchInput = (item: DraftExpenseItem) => {
  item._showSupplyDropdown = true
  item._showCreateSupply = false
  clearTimeout(expenseItemSearchTimer)
  expenseItemSearchTimer = setTimeout(() => searchSuppliesForItem(item), 250)
}

const filteredSuppliesFor = (item: DraftExpenseItem) => item._searchResults

const selectSupplyForItem = (item: DraftExpenseItem, supply: any) => {
  item.supply_id = supply.id
  item.product_name = supply.name
  item._supplySearch = ''
  item._searchResults = []
  item._showSupplyDropdown = false
  item._showCreateSupply = false
  item._createUnit = ''
  if (supply.last_price_clp && !item.unit_price_clp) {
    item.unit_price_clp = supply.last_price_clp
  }
}

const clearSupplySelection = (item: DraftExpenseItem) => {
  item.supply_id = ''
  item.product_name = ''
  item._supplySearch = ''
}

const createSupplyForItem = async (item: DraftExpenseItem) => {
  const name = item._supplySearch.trim()
  if (!name) return
  item._creatingSupply = true
  expenseItemModalError.value = ''
  try {
    const res = await api.post<{ ok: boolean; supply: any }>('/admin/supplies', {
      name,
      unit: item._createUnit.trim() || null,
    })
    if (res.ok) selectSupplyForItem(item, res.supply)
  } catch (e: any) {
    expenseItemModalError.value = e?.data?.error || 'Error al crear insumo'
  } finally {
    item._creatingSupply = false
  }
}

const openAddExpenseItemModal = () => {
  editingExpenseItemIndex.value = null
  draftExpenseItem.value = createEmptyExpenseItem()
  expenseItemModalError.value = ''
  showExpenseItemModal.value = true
}

const openEditExpenseItemModal = (index: number) => {
  editingExpenseItemIndex.value = index
  const original = newExpense.value.items[index]
  draftExpenseItem.value = {
    ...createEmptyExpenseItem(),
    supply_id: original.supply_id,
    product_name: original.product_name,
    quantity: original.quantity,
    unit_price_clp: original.unit_price_clp,
  }
  expenseItemModalError.value = ''
  showExpenseItemModal.value = true
}

const removeExpenseItem = (index: number) => {
  newExpense.value.items.splice(index, 1)
}

const confirmExpenseItemModal = () => {
  const d = draftExpenseItem.value
  if (!d.supply_id) {
    expenseItemModalError.value = 'Debes seleccionar o crear un producto'
    return
  }
  if (!d.quantity || d.quantity <= 0) {
    expenseItemModalError.value = 'La cantidad debe ser mayor a 0'
    return
  }
  if (d.unit_price_clp == null || d.unit_price_clp < 0) {
    expenseItemModalError.value = 'El precio unitario es requerido'
    return
  }
  const existingKey = editingExpenseItemIndex.value !== null
    ? newExpense.value.items[editingExpenseItemIndex.value]._key
    : crypto.randomUUID()
  const item: ExpenseItem = {
    _key: existingKey,
    supply_id: d.supply_id,
    product_name: d.product_name,
    quantity: d.quantity,
    unit_price_clp: d.unit_price_clp,
    total_clp: Math.round(d.quantity * d.unit_price_clp),
  }
  if (editingExpenseItemIndex.value !== null) {
    newExpense.value.items[editingExpenseItemIndex.value] = item
  } else {
    newExpense.value.items.push(item)
  }
  showExpenseItemModal.value = false
}

const addExpense = async () => {
  const hasItems = newExpense.value.items.length > 0
  if (!newExpense.value.description.trim()) {
    expenseError.value = 'La descripción es requerida'
    return
  }
  if (!hasItems && !newExpense.value.amount_clp) {
    expenseError.value = 'Ingresa un monto o agrega al menos un producto al detalle'
    return
  }
  expenseSaving.value = true
  expenseError.value = ''
  try {
    await api.post('/admin/supplies/expenses', {
      description: newExpense.value.description.trim(),
      amount_clp: hasItems ? undefined : newExpense.value.amount_clp,
      expense_date: newExpense.value.expense_date,
      supply_id: hasItems ? null : (newExpense.value.supply_id || null),
      provider_id: newExpense.value.provider_id || null,
      notes: newExpense.value.notes || null,
      items: hasItems ? newExpense.value.items : undefined,
    })
    newExpense.value = {
      description: '', amount_clp: null, expense_date: now.toISOString().split('T')[0],
      supply_id: '', provider_id: '', provider_name: '', notes: '', items: [],
    }
    providerSearch.value = ''
    providerResults.value = []
    await loadExpenses()
    await loadSupplies()
    await loadAllSupplies()
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
  const userStr = localStorage.getItem('user')
  if (userStr) {
    try {
      currentUserRole.value = JSON.parse(userStr)?.role || ''
    } catch (e) {}
  }
  loadSupplies()
  loadAllSupplies()
  loadExpenses()
})
</script>
