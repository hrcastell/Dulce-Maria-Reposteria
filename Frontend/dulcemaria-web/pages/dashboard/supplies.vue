<template>
  <PageContainer as="main">
    <div class="space-y-6 sm:space-y-8">
    <PageHeader title="Insumos y Gastos" description="Control de insumos y registro de gastos" />

    <!-- Tabs -->
    <div class="flex flex-wrap gap-2 mb-6">
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
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Presentación</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Precio c/u</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Stock</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Actualizado</th>
                    <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-warm-100">
                  <tr v-if="supplies.length === 0">
                    <td colspan="6" class="px-4 py-8 text-center text-warm-400">No hay insumos registrados</td>
                  </tr>
                  <tr v-for="s in supplies" :key="s.id" class="hover:bg-warm-50/50 transition-colors">
                    <td class="px-4 py-3">
                      <div class="text-sm font-medium text-warm-800">{{ s.name }}</div>
                      <div v-if="s.notes" class="text-xs text-warm-400">{{ s.notes }}</div>
                    </td>
                    <td class="px-4 py-3 text-sm text-warm-600">
                      {{ s.reference_qty }} {{ s.unit || 'unidad' }} — ${{ formatPrice(s.last_price_clp || 0) }}
                    </td>
                    <td class="px-4 py-3 text-sm font-semibold text-warm-800">
                      {{ s.last_price_clp ? `$${formatPrice(unitPriceFor(s))} / ${s.unit || 'unidad'}` : '—' }}
                    </td>
                    <td class="px-4 py-3 text-sm text-warm-600">{{ s.stock_qty }} {{ s.unit || '' }}</td>
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
                        <span class="block">Trae: <span class="text-warm-700 font-medium">{{ s.reference_qty }} {{ s.unit || 'unidad' }}</span></span>
                        <span class="block">Stock: <span class="text-warm-700 font-medium">{{ s.stock_qty }} {{ s.unit || '' }}</span></span>
                        <span class="block mt-0.5 text-xs">
                          {{ s.last_updated ? formatDate(s.last_updated) : '—' }}
                          <span v-if="isPriceStale(s.last_updated)">⚠️</span>
                        </span>
                      </div>
                      <div class="text-right">
                        <p class="text-xs text-warm-400">Precio c/u</p>
                        <p class="font-bold text-warm-800 text-lg">
                          {{ s.last_price_clp ? `$${formatPrice(unitPriceFor(s))}` : '—' }}
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
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-warm-800">Registrar Gasto</h3>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-warm-100 hover:bg-warm-200 text-warm-700 text-sm font-medium rounded-lg transition-colors"
                @click="showImportModal = true"
              >
                📥 Importar boleta/factura
              </button>
            </div>
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
          <input v-model="supplyForm.name" type="text" class="input" placeholder="Ej: Huevos">
        </div>

        <div class="p-3 bg-warm-50 rounded-xl border border-warm-100">
          <p class="text-xs font-medium text-warm-600 mb-2">¿Cómo lo comprás? — ej: una bandeja trae 30 huevos</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label text-xs">Trae (cantidad)</label>
              <input v-model.number="supplyForm.reference_qty" type="number" min="0.001" step="any" class="input" placeholder="30">
            </div>
            <div>
              <label class="label text-xs">Unidad</label>
              <select v-model="supplyForm.unit" class="input">
                <option v-for="u in UNIT_OPTIONS" :key="u.value" :value="u.value">{{ u.label }}</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <label class="label">Precio pagado por esa presentación (CLP)</label>
          <input v-model.number="supplyForm.last_price_clp" type="number" min="0" class="input" placeholder="7500">
        </div>

        <div v-if="supplyUnitPrice !== null" class="flex items-center justify-between px-3 py-2 bg-primary-50 rounded-xl border border-primary-100">
          <span class="text-sm text-warm-600">Precio por {{ supplyForm.unit || 'unidad' }}</span>
          <span class="text-sm font-bold text-warm-800">${{ formatPrice(supplyUnitPrice) }}</span>
        </div>

        <div>
          <label class="label">Stock actual</label>
          <input v-model.number="supplyForm.stock_qty" type="number" min="0" step="any" class="input" placeholder="0">
          <p class="text-xs text-warm-500 mt-1">Se suma solo al registrar un gasto con detalle — ajustá acá si hace falta corregirlo a mano.</p>
        </div>

        <div>
          <label class="label">Notas</label>
          <textarea v-model="supplyForm.notes" rows="2" class="input" placeholder="Notas opcionales"></textarea>
        </div>
        <div v-if="supplyFormError" class="text-sm text-red-600 bg-red-50 rounded p-2">{{ supplyFormError }}</div>
      </div>
    </Modal>

    <!-- Expense Item Panel -->
    <SidePanel
      v-model="showExpenseItemModal"
      :title="editingExpenseItemIndex === null ? 'Agregar Producto al Detalle' : 'Editar Producto'"
      :submit-text="noContentAcknowledged ? (editingExpenseItemIndex === null ? 'Sí, agregar así' : 'Sí, guardar así') : 'Aceptar'"
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
            <select v-model="draftExpenseItem._createUnit" class="input text-sm">
              <option v-for="u in UNIT_OPTIONS" :key="u.value" :value="u.value">{{ u.label }}</option>
            </select>
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

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label class="label">Cantidad comprada *</label>
            <input v-model.number="draftExpenseItem.quantity" type="number" min="0.001" step="0.001" class="input">
          </div>
          <div>
            <label class="label flex items-center gap-1">
              Unidad de compra *
              <span
                class="text-warm-400 hover:text-warm-600 cursor-help text-xs leading-none"
                title="Elegí la unidad directa (Gramos, Kilogramos, Mililitros, Litros) si compraste a granel. Elegí 'Unidad' si compraste por paquete, saco o bandeja cerrada — ej. un paquete de canela o un saco de harina — para después indicar cuánto pesa o mide cada uno."
              >ⓘ</span>
            </label>
            <select v-model="draftExpenseItem.unit" class="input">
              <option v-for="u in UNIT_OPTIONS" :key="u.value" :value="u.value">{{ u.label }}</option>
            </select>
          </div>
          <div>
            <label class="label">Precio por unidad de compra (CLP, c/IVA) *</label>
            <input v-model.number="draftExpenseItem.unit_price_clp" type="number" min="0" class="input">
          </div>
        </div>

        <!-- Contenido neto — solo cuando se compra por unidad discreta (paquete, saco,
             bandeja...), para poder distinguir "2 paquetes de 250g" de "2 gramos". -->
        <div v-if="draftExpenseItem.unit === 'unidad'" class="p-3 bg-warm-50 rounded-xl border border-warm-200 space-y-2">
          <label class="label flex items-center gap-1">
            Contenido neto por unidad comprada (opcional)
            <span
              class="text-warm-400 hover:text-warm-600 cursor-help text-xs leading-none"
              title="Cuánto pesa o mide CADA unidad comprada — ej. 250 / Gramos para un paquete de canela de 250 g, o 25 / Kilogramos para un saco de harina de 25 kg. Si lo dejás vacío, el sistema asume que 1 unidad comprada = 1 unidad de stock (correcto para insumos que se cuentan de a uno, como huevos)."
            >ⓘ</span>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <input v-model.number="draftExpenseItem.content_qty" type="number" min="0.001" step="0.001" class="input" placeholder="Ej: 250">
            <select v-model="draftExpenseItem.content_unit" class="input">
              <option v-for="u in UNIT_OPTIONS" :key="u.value" :value="u.value">{{ u.label }}</option>
            </select>
          </div>
          <p class="text-xs text-warm-500">Ej: si cada paquete pesa 250 g, poné 250 / Gramos. Si lo dejás vacío, cada unidad comprada suma 1 al stock del insumo.</p>

          <!-- Gate de confirmación: se arma en confirmExpenseItemModal() cuando se
               intenta guardar sin contenido neto para un insumo que no se cuenta de
               a uno — obliga a un segundo click para evitar repetir el bug original
               (paquete de 250g contado por descuido como 1 unidad de stock). -->
          <div v-if="noContentAcknowledged" class="mt-2 p-2.5 bg-warning-50 border border-warning-100 rounded-lg text-xs text-warning-700 space-y-1">
            <p>
              No especificaste el contenido neto de <strong>"{{ draftExpenseItem.product_name }}"</strong> —
              se va a sumar 1 unidad exacta al stock.
            </p>
            <p>¿Es correcto? Hacé clic de nuevo en "{{ editingExpenseItemIndex === null ? 'Sí, agregar así' : 'Sí, guardar así' }}" para confirmar, o completá el contenido neto arriba si no lo es.</p>
          </div>
        </div>

        <p class="text-xs text-warm-500">Ej: si compraste 10 kg sueltos, poné cantidad 10 y unidad Kilogramos.</p>

        <div class="pt-3 border-t border-warm-100 space-y-1.5">
          <div class="flex justify-between items-center text-sm">
            <span class="text-warm-500">Total línea:</span>
            <span class="font-bold text-warm-800">${{ formatPrice((draftExpenseItem.quantity || 0) * (draftExpenseItem.unit_price_clp || 0)) }}</span>
          </div>
          <div class="flex justify-between items-center text-sm">
            <span class="text-warm-500">Suma a inventario:</span>
            <span class="font-bold text-primary-700">{{ itemStockPreview(draftExpenseItem) }}</span>
          </div>
        </div>
      </div>
    </SidePanel>

    <NoticeDialog
      v-model="showNotice"
      :variant="noticeVariant"
      :message="noticeMessage"
    />

    <ExpenseImportModal
      v-model="showImportModal"
      @parsed="startImportQueue"
    />
    </div>
  </PageContainer>
</template>

<script setup lang="ts">
import { norm, type QuoteLineItem } from '~/lib/quote-grid'

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
const showNotice = ref(false)
const noticeVariant = ref<'success' | 'error'>('success')
const noticeMessage = ref('')

// Unidades fijas — antes era texto libre y permitía cargar cosas como "1 Kg" o
// "30 Unidades" en vez de solo "kg"/"unidad", lo que rompía la conversión (el
// sistema las tomaba como una unidad "rara" compatible solo consigo misma, sin
// convertir de verdad). Debe coincidir con Backend/dulcemaria-api/src/lib/units.js.
const UNIT_OPTIONS = [
  { value: 'g', label: 'Gramos (g)' },
  { value: 'kg', label: 'Kilogramos (kg)' },
  { value: 'ml', label: 'Mililitros (ml)' },
  { value: 'l', label: 'Litros (l)' },
  { value: 'unidad', label: 'Unidad' },
]

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
const supplyForm = ref({
  name: '',
  unit: 'unidad',
  last_price_clp: null as number | null,
  reference_qty: 1 as number,
  stock_qty: 0 as number,
  notes: '',
})

// Precio por unidad de referencia (ej: $7.500 / 30 huevos = $250 c/u) — mismo
// cálculo que usa el backend para costear recetas, mostrado acá para que quede
// claro de inmediato qué está pagando por unidad.
const supplyUnitPrice = computed(() => {
  const price = supplyForm.value.last_price_clp
  const ref = supplyForm.value.reference_qty
  if (!price || !ref || ref <= 0) return null
  return price / ref
})

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
const unitPriceFor = (s: any) => (s.last_price_clp && s.reference_qty ? s.last_price_clp / s.reference_qty : 0)
const isPriceStale = (iso: string) => {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)
  return diff > 30
}

// El backend manda `error` como string o, en fallos de validación zod, como
// `{ formErrors, fieldErrors }` (parsed.error.flatten()) — sin esto, ese objeto
// se interpola directo en el template y se ve literal "[object Object]".
const errorMessage = (err: any, fallback: string): string => {
  if (!err) return fallback
  if (typeof err === 'string') return err
  const firstFieldError = err.fieldErrors && (Object.values(err.fieldErrors)[0] as string[] | undefined)?.[0]
  return firstFieldError || err.formErrors?.[0] || fallback
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
    suppliesError.value = errorMessage(e?.data?.error, 'Error al cargar insumos')
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
    unit: supply?.unit || 'unidad',
    last_price_clp: supply?.last_price_clp ?? null,
    reference_qty: supply?.reference_qty ?? 1,
    stock_qty: supply?.stock_qty ?? 0,
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
      reference_qty: supplyForm.value.reference_qty || 1,
      stock_qty: supplyForm.value.stock_qty ?? 0,
      notes: supplyForm.value.notes || null,
    }
    if (editingSupply.value) {
      await api.patch(`/admin/supplies/${editingSupply.value.id}`, body)
    } else {
      await api.post('/admin/supplies', body)
    }
    const wasEditing = !!editingSupply.value
    showSupplyModal.value = false
    await loadSupplies()
    await loadAllSupplies()
    noticeVariant.value = 'success'
    noticeMessage.value = wasEditing ? 'Insumo actualizado correctamente.' : 'Insumo creado correctamente.'
    showNotice.value = true
  } catch (e: any) {
    supplyFormError.value = errorMessage(e?.data?.error, 'Error al guardar')
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
  unit: string
  unit_price_clp: number
  total_clp: number
  // Compra por unidad discreta (paquete/saco) con contenido neto conocido — ver
  // comentario de columna en Backend/dulcemaria-api/src/migrations/complete.js.
  content_qty: number | null
  content_unit: string | null
}

interface DraftExpenseItem {
  supply_id: string
  product_name: string
  quantity: number | null
  unit: string
  unit_price_clp: number | null
  content_qty: number | null
  content_unit: string
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
  unit: 'unidad',
  unit_price_clp: null,
  content_qty: null,
  content_unit: 'g',
  _supplySearch: '',
  _searchResults: [],
  _searchSeq: 0,
  _showSupplyDropdown: false,
  _showCreateSupply: false,
  _createUnit: 'unidad',
  _creatingSupply: false,
})

// Espejo liviano de Backend/dulcemaria-api/src/lib/units.js — solo para la vista
// previa en vivo del detalle de gasto; el backend es la fuente de verdad al guardar.
const UNIT_TO_BASE: Record<string, { dim: string; toBase: number }> = {
  g: { dim: 'weight', toBase: 1 },
  kg: { dim: 'weight', toBase: 1000 },
  ml: { dim: 'volume', toBase: 1 },
  l: { dim: 'volume', toBase: 1000 },
  unidad: { dim: 'count', toBase: 1 },
}
const previewConvert = (value: number, from: string, to: string): number | null => {
  if (from === to) return value
  const f = UNIT_TO_BASE[from]
  const t = UNIT_TO_BASE[to]
  if (!f || !t || f.dim !== t.dim) return null
  return (value * f.toBase) / t.toBase
}

// Cuánto suma realmente al stock del insumo este ítem del detalle — muestra el
// efecto real ANTES de guardar, para no tener que hacer la cuenta de cabeza.
const itemStockPreview = (item: DraftExpenseItem): string => {
  if (!item.supply_id || !item.quantity) return '—'
  const supply = allSupplies.value.find((s) => s.id === item.supply_id)
  const supplyUnit = supply?.unit || item.unit
  let amount: number | null
  if (item.unit === 'unidad' && item.content_qty && item.content_unit) {
    const content = previewConvert(item.content_qty, item.content_unit, supplyUnit)
    amount = content == null ? null : item.quantity * content
  } else {
    amount = previewConvert(item.quantity, item.unit, supplyUnit)
  }
  if (amount == null) return 'Unidad incompatible con el insumo'
  const label = UNIT_OPTIONS.find((u) => u.value === supplyUnit)?.label || supplyUnit
  return `${formatPrice(amount)} ${label}`
}

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

// Gate de confirmación para "Unidad de compra = Unidad" sin contenido neto (ver
// confirmExpenseItemModal). Se re-arma en falso apenas cambia cualquier campo
// relevante, para no dejar una confirmación vieja "colgada" tras editar algo.
const noContentAcknowledged = ref(false)
watch(
  () => [
    draftExpenseItem.value.unit,
    draftExpenseItem.value.content_qty,
    draftExpenseItem.value.content_unit,
    draftExpenseItem.value.supply_id,
  ],
  () => { noContentAcknowledged.value = false }
)

// ── Importación de boleta/factura (foto/PDF/Excel) — ver components/ExpenseImportModal.vue ──
// Cada línea detectada pasa, una a la vez, por el MISMO panel "Agregar Producto
// al Detalle" de arriba (con su buscador de insumo y su gate de contenido neto)
// en vez de un guardado masivo automático — la supervisión queda del lado del
// usuario, el motor solo prellena un borrador.
const showImportModal = ref(false)
const importQueue = ref<QuoteLineItem[]>([])
const importQueueIndex = ref(0)
const importQueueStartCount = ref(0)
const importMode = ref(false)
// true solo entre "se confirmó este ítem" y "el watch de abajo ya lo procesó" —
// distingue un cierre por confirmación (ya manejado en confirmExpenseItemModal)
// de un cierre por cancelar/backdrop/Esc (que el watch trata como "saltar ítem").
const importJustConfirmed = ref(false)

// Distancia de Levenshtein clásica (DP) — desempate del fuzzy-match cuando el
// solapamiento de tokens no alcanza para decidir (ej. ruido de OCR: "AZUKAR" vs "AZUCAR").
const levenshteinDistance = (a: string, b: string): number => {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// Puntaje de similitud 0-1 entre la descripción de la boleta y el nombre de un
// insumo del catálogo: solapamiento de tokens normalizados (tipo Jaccard) +
// distancia de Levenshtein normalizada como desempate, más un bonus si uno es
// substring del otro. Sin librerías nuevas — reusa `norm()` de lib/quote-grid.ts.
const supplyMatchScore = (descripcion: string, supplyName: string): number => {
  const a = norm(descripcion)
  const b = norm(supplyName)
  if (!a || !b) return 0
  if (a === b) return 1
  const tokensA = new Set(a.split(' ').filter(Boolean))
  const tokensB = new Set(b.split(' ').filter(Boolean))
  const shared = [...tokensA].filter((t) => tokensB.has(t)).length
  const jaccard = shared / Math.max(1, Math.max(tokensA.size, tokensB.size))
  const maxLen = Math.max(a.length, b.length)
  const levSim = maxLen ? 1 - levenshteinDistance(a, b) / maxLen : 0
  const substringBonus = a.includes(b) || b.includes(a) ? 0.15 : 0
  return Math.min(1, jaccard * 0.6 + levSim * 0.4 + substringBonus)
}

const SUPPLY_MATCH_THRESHOLD = 0.75
// Mejor candidato del catálogo para una descripción OCR, o null si ninguno supera
// el umbral — en ese caso se deja la búsqueda precargada con el texto crudo en
// vez de adivinar, reusando el flujo de búsqueda/creación inline que ya existe.
const findBestSupplyMatch = (descripcion: string): any => {
  let best: any = null
  let bestScore = 0
  for (const s of allSupplies.value) {
    const score = supplyMatchScore(descripcion, s.name)
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  return bestScore >= SUPPLY_MATCH_THRESHOLD ? best : null
}

// Abre el panel existente prellenado con la línea `index` de la cola de importación.
const openImportedItem = (index: number) => {
  const line = importQueue.value[index]
  if (!line) return
  importQueueIndex.value = index
  importMode.value = true
  importJustConfirmed.value = false
  editingExpenseItemIndex.value = null
  draftExpenseItem.value = createEmptyExpenseItem()
  expenseItemModalError.value = ''

  const match = findBestSupplyMatch(line.descripcion)
  if (match) {
    selectSupplyForItem(draftExpenseItem.value, match)
  } else {
    draftExpenseItem.value._supplySearch = line.descripcion
  }
  // El OCR nunca puede saber si la compra viene suelta (g/kg/ml/l) o por unidad
  // discreta (paquete/saco) — arranca siempre en 'unidad' para forzar el gate de
  // contenido neto existente, la misma red de seguridad del fix original.
  draftExpenseItem.value.unit = 'unidad'
  draftExpenseItem.value.quantity = line.cantidad && line.cantidad > 0 ? line.cantidad : 1
  if (line.valorUnitario != null) {
    draftExpenseItem.value.unit_price_clp = Math.round(line.valorUnitario)
  } else if (line.total != null && line.cantidad) {
    draftExpenseItem.value.unit_price_clp = Math.round(line.total / line.cantidad)
  } else {
    draftExpenseItem.value.unit_price_clp = null
  }
  showExpenseItemModal.value = true
}

const finishImportQueue = () => {
  const added = newExpense.value.items.length - importQueueStartCount.value
  const total = importQueue.value.length
  importMode.value = false
  importQueue.value = []
  importQueueIndex.value = 0
  noticeVariant.value = 'success'
  noticeMessage.value = `Se agregaron ${added} de ${total} ítems detectados.`
  showNotice.value = true
}

const advanceImportQueue = () => {
  const nextIndex = importQueueIndex.value + 1
  if (nextIndex < importQueue.value.length) {
    openImportedItem(nextIndex)
  } else {
    finishImportQueue()
  }
}

// Punto de entrada llamado por ExpenseImportModal cuando el usuario confirma
// qué ítems detectados cargar (evento `parsed`).
const startImportQueue = (lines: QuoteLineItem[]) => {
  if (!lines.length) return
  importQueue.value = lines
  importQueueStartCount.value = newExpense.value.items.length
  openImportedItem(0)
}

// Si el panel se cierra SIN pasar por confirmExpenseItemModal (Cancelar, click
// en el backdrop, Esc) durante una importación en curso, se trata como "saltar
// este ítem" — si no, un solo click accidental fuera del panel perdería el
// resto de la cola en silencio.
watch(showExpenseItemModal, (isOpen) => {
  if (isOpen || !importMode.value) return
  if (importJustConfirmed.value) {
    importJustConfirmed.value = false
    return
  }
  advanceImportQueue()
})

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
    providerError.value = errorMessage(e?.data?.error, 'Error al crear proveedor')
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
    providerError.value = errorMessage(e?.data?.error, 'Error al eliminar proveedor')
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
  item.unit = supply.unit || 'unidad'
  item._supplySearch = ''
  item._searchResults = []
  item._showSupplyDropdown = false
  item._showCreateSupply = false
  item._createUnit = 'unidad'
  const referenceUnitPrice = unitPriceFor(supply)
  if (referenceUnitPrice && !item.unit_price_clp) {
    item.unit_price_clp = Math.round(referenceUnitPrice)
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
    expenseItemModalError.value = errorMessage(e?.data?.error, 'Error al crear insumo')
  } finally {
    item._creatingSupply = false
  }
}

const openAddExpenseItemModal = () => {
  importMode.value = false
  editingExpenseItemIndex.value = null
  draftExpenseItem.value = createEmptyExpenseItem()
  expenseItemModalError.value = ''
  showExpenseItemModal.value = true
}

const openEditExpenseItemModal = (index: number) => {
  importMode.value = false
  editingExpenseItemIndex.value = index
  const original = newExpense.value.items[index]
  draftExpenseItem.value = {
    ...createEmptyExpenseItem(),
    supply_id: original.supply_id,
    product_name: original.product_name,
    quantity: original.quantity,
    unit: original.unit || 'unidad',
    unit_price_clp: original.unit_price_clp,
    content_qty: original.content_qty ?? null,
    content_unit: original.content_unit || 'g',
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

  // Compra por unidad discreta sin contenido neto: puede ser intencional (insumos
  // que se cuentan de a uno, ej. huevos) o un descuido — el bug original que este
  // campo vino a corregir. Si el insumo no se cuenta de a uno, se exige un click
  // extra de confirmación antes de guardar (ver banner "noContentAcknowledged").
  const selectedSupply = allSupplies.value.find((s) => s.id === d.supply_id)
  const needsNoContentAck = d.unit === 'unidad' && !d.content_qty && selectedSupply?.unit !== 'unidad'
  if (needsNoContentAck && !noContentAcknowledged.value) {
    expenseItemModalError.value = ''
    noContentAcknowledged.value = true
    return
  }
  noContentAcknowledged.value = false

  const existingKey = editingExpenseItemIndex.value !== null
    ? newExpense.value.items[editingExpenseItemIndex.value]._key
    : crypto.randomUUID()
  const hasContent = d.unit === 'unidad' && !!d.content_qty && !!d.content_unit
  const item: ExpenseItem = {
    _key: existingKey,
    supply_id: d.supply_id,
    product_name: d.product_name,
    quantity: d.quantity,
    unit: d.unit,
    unit_price_clp: d.unit_price_clp,
    total_clp: Math.round(d.quantity * d.unit_price_clp),
    content_qty: hasContent ? d.content_qty : null,
    content_unit: hasContent ? d.content_unit : null,
  }
  if (editingExpenseItemIndex.value !== null) {
    newExpense.value.items[editingExpenseItemIndex.value] = item
  } else {
    newExpense.value.items.push(item)
  }

  if (importMode.value) {
    // Marcado ANTES de cerrar para que el watch de arriba no lo vuelva a
    // procesar como "cancelado" — acá ya se confirmó y guardó de verdad.
    importJustConfirmed.value = true
    showExpenseItemModal.value = false
    advanceImportQueue()
  } else {
    showExpenseItemModal.value = false
  }
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
    expenseError.value = errorMessage(e?.data?.error, 'Error al registrar gasto')
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
    noticeVariant.value = 'error'
    noticeMessage.value = errorMessage(e?.data?.error, 'Error al eliminar')
    showNotice.value = true
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
