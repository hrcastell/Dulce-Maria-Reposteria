<template>
  <div v-if="isOwner">
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Motor de Tarifa</h1>
        <p class="mt-1 text-warm-500">Cobro por uso de la plataforma</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6">
      <button
        :class="tab === 'lista' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'"
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="tab = 'lista'"
      >
        <span class="mr-2">🧾</span> Lista de cobro
      </button>
      <button
        :class="tab === 'config' ? 'bg-primary-500 text-white shadow-soft' : 'bg-white text-warm-600 hover:bg-warm-50'"
        class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border border-warm-200"
        @click="tab = 'config'"
      >
        <span class="mr-2">⚙️</span> Configuración
      </button>
    </div>

    <!-- ====== LISTA DE COBRO TAB ====== -->
    <div v-if="tab === 'lista'">
      <!-- Alerta de fallback -->
      <div
        v-if="dashboard && dashboard.fallback_alert.count > 0"
        class="rounded-2xl bg-error-50 border border-error-100 p-4 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div class="flex items-start gap-3">
          <span class="text-error-500 text-xl flex-shrink-0">⚠️</span>
          <p class="text-sm text-error-700">
            {{ dashboard.fallback_alert.count }} {{ dashboard.fallback_alert.count === 1 ? 'cobro' : 'cobros' }} sin tarifa configurada este mes (${{ formatPrice(dashboard.fallback_alert.total_fees_clp) }} aplicado). Configurá un tier para no perder estos cobros.
          </p>
        </div>
        <button
          type="button"
          class="px-4 py-2 bg-error-500 hover:bg-error-600 text-white text-sm font-medium rounded-xl transition-all duration-200 flex-shrink-0"
          @click="tab = 'config'"
        >
          Ir a Configuración
        </button>
      </div>

      <!-- Dashboard cards -->
      <div v-if="dashboardLoading" class="flex flex-col items-center justify-center py-12">
        <div class="w-10 h-10 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      </div>
      <div v-else-if="dashboardError" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
        <div class="flex items-center gap-3">
          <span class="text-error-500 text-xl">⚠️</span>
          <p class="text-error-700">{{ dashboardError }}</p>
        </div>
      </div>
      <div v-else-if="dashboard" class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <!-- Cobros hoy -->
        <div class="bg-white rounded-2xl p-5 shadow-soft border border-warm-100">
          <p class="text-sm text-warm-500 mb-1">Cobros hoy</p>
          <p class="text-3xl font-bold text-warm-800">{{ dashboard.today.count }}</p>
          <p class="text-sm text-warm-500 mt-1">${{ formatPrice(dashboard.today.total_fees_clp) }}</p>
        </div>

        <!-- Cobros del mes -->
        <div class="bg-white rounded-2xl p-5 shadow-soft border border-warm-100">
          <p class="text-sm text-warm-500 mb-1">Cobros del mes</p>
          <p class="text-3xl font-bold text-warm-800">{{ dashboard.this_month.count }}</p>
          <p class="text-sm text-warm-500 mt-1">${{ formatPrice(dashboard.this_month.total_fees_clp) }}</p>
        </div>

        <!-- Tier vigente -->
        <div class="bg-white rounded-2xl p-5 shadow-soft border border-warm-100">
          <p class="text-sm text-warm-500 mb-1">Tier vigente</p>
          <template v-if="dashboard.current_tier">
            <p class="text-lg font-semibold text-warm-800 truncate">{{ dashboard.current_tier.label }}</p>
            <p class="text-2xl font-bold text-warm-800 mt-1">
              ${{ formatPrice(dashboard.current_tier.fee_per_transaction_clp) }}
              <span class="text-sm font-normal text-warm-500">/ transacción</span>
            </p>
            <div v-if="dashboard.current_tier.max_monthly_volume_clp != null" class="mt-3">
              <div class="w-full h-2 bg-warm-200 rounded-full overflow-hidden">
                <div
                  class="h-full bg-primary-500 rounded-full transition-all duration-300"
                  :style="{ width: tierProgressPct + '%' }"
                ></div>
              </div>
            </div>
            <p v-else class="mt-3 text-xs font-medium text-warm-500">Tier máximo</p>
          </template>
          <p v-else class="text-warm-600 font-medium mt-2">Sin tier configurado</p>
        </div>
      </div>

      <!-- Segmented control -->
      <div class="flex gap-6 border-b border-warm-200 mb-4">
        <button
          type="button"
          :class="subView === 'cobros' ? 'text-primary-600 border-primary-500' : 'text-warm-500 border-transparent hover:text-warm-700'"
          class="pb-2.5 px-1 text-sm font-medium border-b-2 transition-all duration-200"
          @click="subView = 'cobros'"
        >
          Cobros
        </button>
        <button
          type="button"
          :class="subView === 'conciliacion' ? 'text-primary-600 border-primary-500' : 'text-warm-500 border-transparent hover:text-warm-700'"
          class="pb-2.5 px-1 text-sm font-medium border-b-2 transition-all duration-200"
          @click="subView = 'conciliacion'"
        >
          Conciliación
        </button>
      </div>

      <!-- ── Vista: Cobros ── -->
      <div v-if="subView === 'cobros'">
        <div class="flex flex-wrap gap-4 items-end mb-4">
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Desde</label>
            <input
              v-model="chargesFrom"
              type="date"
              class="block px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
              @change="applyChargesFilters"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Hasta</label>
            <input
              v-model="chargesTo"
              type="date"
              class="block px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
              @change="applyChargesFilters"
            >
          </div>
        </div>

        <div v-if="chargesLoading" class="flex justify-center py-10">
          <div class="w-10 h-10 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
        </div>
        <div v-else-if="chargesError" class="rounded-2xl bg-error-50 border border-error-100 p-4">
          <p class="text-sm text-error-700">⚠️ {{ chargesError }}</p>
        </div>
        <div v-else-if="chargesItems.length === 0" class="text-center py-12 bg-white rounded-2xl shadow-soft border border-warm-100">
          <p class="text-warm-500">No hay cobros en este rango</p>
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="c in chargesItems"
            :key="c.id"
            class="bg-white rounded-xl border border-warm-100 shadow-soft overflow-hidden"
          >
            <div class="flex flex-wrap items-center gap-3 sm:gap-4 p-4">
              <div class="text-sm text-warm-500 w-36 flex-shrink-0">{{ formatDateTime(c.charged_at) }}</div>
              <div class="text-sm font-medium text-warm-800 flex-1 min-w-[90px]">{{ c.order_no || c.order_code }}</div>
              <div class="flex-shrink-0">
                <span v-if="c.is_fallback" class="text-xs font-medium px-2 py-0.5 rounded-full bg-warning-100 text-warning-600">⚠️ Sin tier</span>
                <span v-else class="text-xs font-medium px-2 py-0.5 rounded-full bg-warm-100 text-warm-600">{{ c.tier_label_snapshot }}</span>
              </div>
              <div class="font-semibold text-warm-800 flex-shrink-0">${{ formatPrice(c.fee_applied_clp) }}</div>
              <div class="text-xs text-warm-400 flex-shrink-0">#{{ c.monthly_txn_ordinal }} del mes</div>
              <button
                type="button"
                class="text-xs font-medium text-primary-600 hover:text-primary-700 flex-shrink-0 ml-auto"
                @click="toggleChargeExpand(c.id)"
              >
                ver montos {{ expandedCharges.has(c.id) ? '︿' : '⌄' }}
              </button>
            </div>
            <div
              v-if="expandedCharges.has(c.id)"
              class="px-4 pb-4 pt-3 border-t border-warm-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm"
            >
              <div class="flex items-center justify-between">
                <span class="text-warm-500">Total de la orden</span>
                <span class="font-medium text-warm-700">${{ formatPrice(c.order_total_clp) }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-warm-500">Volumen del mes al momento del cobro</span>
                <span class="font-medium text-warm-700">${{ formatPrice(c.monthly_volume_at_charge_clp) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="chargesTotalPages > 1" class="flex items-center justify-between mt-4">
          <button
            type="button"
            :disabled="chargesPage <= 1"
            class="px-3 py-1.5 text-sm font-medium text-warm-600 bg-white border border-warm-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-warm-50 transition-all duration-200"
            @click="loadCharges(chargesPage - 1)"
          >
            ← Anterior
          </button>
          <span class="text-sm text-warm-500">Página {{ chargesPage }} de {{ chargesTotalPages }}</span>
          <button
            type="button"
            :disabled="chargesPage >= chargesTotalPages"
            class="px-3 py-1.5 text-sm font-medium text-warm-600 bg-white border border-warm-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-warm-50 transition-all duration-200"
            @click="loadCharges(chargesPage + 1)"
          >
            Siguiente →
          </button>
        </div>
      </div>

      <!-- ── Vista: Conciliación ── -->
      <div v-else>
        <div class="flex flex-wrap gap-4 items-end mb-4">
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Desde</label>
            <input
              v-model="reconciliationFrom"
              type="date"
              class="block px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
              @change="applyReconciliationFilters"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1.5">Hasta</label>
            <input
              v-model="reconciliationTo"
              type="date"
              class="block px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all duration-200 bg-white"
              @change="applyReconciliationFilters"
            >
          </div>
        </div>

        <div
          v-if="reconciliation && reconciliation.gap_count > 0"
          class="rounded-xl bg-error-50 border border-error-100 p-3 mb-4"
        >
          <p class="text-sm text-error-700 font-medium">
            ⚠️ {{ reconciliation.gap_count }} {{ reconciliation.gap_count === 1 ? 'orden entregada sin cobro asociado' : 'órdenes entregadas sin cobro asociado' }}
          </p>
        </div>
        <div
          v-else-if="reconciliation"
          class="rounded-xl bg-success-50 border border-success-100 p-3 mb-4"
        >
          <p class="text-sm text-success-700 font-medium">✅ Sin huecos de cobro en este rango</p>
        </div>

        <div v-if="reconciliationLoading" class="flex justify-center py-10">
          <div class="w-10 h-10 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
        </div>
        <div v-else-if="reconciliationError" class="rounded-2xl bg-error-50 border border-error-100 p-4">
          <p class="text-sm text-error-700">⚠️ {{ reconciliationError }}</p>
        </div>
        <div
          v-else-if="reconciliation && reconciliation.items.length === 0"
          class="text-center py-12 bg-white rounded-2xl shadow-soft border border-warm-100"
        >
          <p class="text-warm-500">No hay órdenes entregadas en este rango</p>
        </div>
        <div v-else-if="reconciliation" class="space-y-2">
          <div
            v-for="item in reconciliation.items"
            :key="item.order_id"
            :class="item.is_gap ? 'bg-error-50 border-error-200' : 'bg-white border-warm-100'"
            class="flex flex-wrap items-center gap-4 p-4 rounded-xl border shadow-soft"
          >
            <div class="text-sm text-warm-500 w-28 flex-shrink-0">{{ formatDate(item.created_at) }}</div>
            <div class="text-sm font-medium text-warm-800 flex-1 min-w-[90px]">{{ item.order_no || item.order_code }}</div>
            <div class="text-sm flex-shrink-0">
              <span v-if="item.is_gap" class="font-semibold text-error-700">⚠️ SIN COBRO</span>
              <span v-else class="text-success-700">✅ Cobrada · ${{ formatPrice(item.fee_applied_clp) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ====== CONFIGURACIÓN TAB ====== -->
    <div v-if="tab === 'config'">
      <!-- Panel informativo colapsable -->
      <div class="bg-warm-50 rounded-2xl border border-warm-100 mb-6 overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-5 py-4 text-left"
          @click="showInfoPanel = !showInfoPanel"
        >
          <span class="text-sm font-medium text-warm-700">ℹ️ ¿Cómo funciona el volumen y los tiers?</span>
          <svg
            :class="showInfoPanel ? 'rotate-180' : ''"
            class="w-4 h-4 text-warm-400 transition-transform duration-200 flex-shrink-0"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div v-if="showInfoPanel" class="px-5 pb-4 text-sm text-warm-600 space-y-1.5">
          <p>El volumen facturado se reinicia el primer día de cada mes calendario.</p>
          <p>El tier aplicado cambia solo cuando el acumulado del mes cruza el techo del tier vigente — no requiere ninguna acción manual.</p>
        </div>
      </div>

      <!-- Gestión de tiers -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 class="text-lg font-semibold text-warm-800">Tiers de tarifa</h2>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft"
          @click="openCreateTierPanel"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Nuevo tier</span>
        </button>
      </div>

      <div v-if="tiersLoading" class="flex flex-col items-center justify-center py-12">
        <div class="w-10 h-10 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      </div>
      <div v-else-if="tiersError" class="rounded-2xl bg-error-50 border border-error-100 p-6">
        <div class="flex items-center gap-3">
          <span class="text-error-500 text-xl">⚠️</span>
          <p class="text-error-700">{{ tiersError }}</p>
        </div>
      </div>
      <div v-else-if="tiers.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
        <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-4xl">🧾</span>
        </div>
        <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay tiers configurados</h3>
        <p class="text-warm-500">Creá el primer tier para empezar a cobrar por transacción</p>
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="t in tiers"
          :key="t.id"
          class="bg-white rounded-2xl p-5 shadow-soft border border-warm-100 flex items-start justify-between gap-4"
        >
          <div class="min-w-0">
            <div class="flex items-center flex-wrap gap-2 mb-1">
              <h3 class="font-semibold text-warm-800">{{ t.label }}</h3>
              <span v-if="t.is_active" class="text-xs font-medium px-2 py-0.5 rounded-full bg-success-100 text-success-600">● Activo</span>
              <span v-else class="text-xs font-medium px-2 py-0.5 rounded-full bg-warm-100 text-warm-500">○ Inactivo</span>
            </div>
            <p class="text-sm text-warm-500">{{ formatTierRange(t) }}</p>
            <p class="text-xl font-bold text-warm-800 mt-2">
              ${{ formatPrice(t.fee_per_transaction_clp) }}
              <span class="text-sm font-normal text-warm-500">/ transacción</span>
            </p>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              class="p-2 text-warm-500 hover:text-primary-600 hover:bg-warm-50 rounded-lg transition-all duration-200"
              aria-label="Editar tier"
              @click="openEditTierPanel(t)"
            >
              ✏️
            </button>
            <button
              v-if="t.is_active"
              type="button"
              class="p-2 text-warm-500 hover:text-error-600 hover:bg-warm-50 rounded-lg transition-all duration-200"
              aria-label="Desactivar tier"
              @click="openDeactivateDialog(t)"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Panel: Crear/Editar tier -->
    <SidePanel
      v-model="showTierPanel"
      :title="editingTierId ? 'Editar Tier' : 'Nuevo Tier'"
      submit-text="Guardar"
      :loading="tierSaving"
      :disable-submit="!canSaveTier"
      @submit="saveTier"
    >
      <div class="space-y-4">
        <div v-if="tierPanelError" class="rounded-xl bg-error-50 p-4 border border-error-100">
          <p class="text-sm text-error-700">{{ tierPanelError }}</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">Nombre / etiqueta *</label>
          <input
            v-model="tierForm.label"
            type="text"
            class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent transition-all"
            placeholder="Ej: Tier 1"
          >
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1">Desde (CLP) *</label>
            <input
              v-model.number="tierForm.min"
              type="number"
              min="0"
              class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all"
              placeholder="0"
            >
          </div>
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-1">Hasta (CLP)</label>
            <input
              v-model.number="tierForm.max"
              type="number"
              min="0"
              :disabled="tierForm.noCeiling"
              class="block w-full px-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all disabled:bg-gray-100"
              placeholder="Ej: 500000"
            >
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input v-model="tierForm.noCeiling" type="checkbox" class="w-4 h-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500">
          <span class="text-sm font-medium text-warm-700">Sin techo</span>
        </label>

        <div>
          <label class="block text-sm font-medium text-warm-700 mb-1">Tarifa por transacción (CLP) *</label>
          <div class="relative">
            <span class="absolute left-4 top-1/2 -translate-y-1/2 text-warm-400">$</span>
            <input
              v-model.number="tierForm.fee"
              type="number"
              min="0"
              class="block w-full pl-8 pr-4 py-2.5 border border-warm-200 rounded-xl text-warm-800 focus:outline-none focus:ring-2 focus:ring-primary-400 transition-all"
              placeholder="Ej: 500"
            >
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input v-model="tierForm.isActive" type="checkbox" class="w-4 h-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500">
          <span class="text-sm font-medium text-warm-700">Activo</span>
        </label>

        <p v-if="overlapError" class="text-sm text-error-600">⚠️ {{ overlapError }}</p>
      </div>
    </SidePanel>

    <!-- Confirmación: desactivar tier -->
    <ConfirmDialog
      v-model="showDeactivateDialog"
      title="Desactivar Tier"
      :message="`¿Desactivar el tier '${tierToDeactivate?.label}'? Los cobros ya registrados con este tier no se ven afectados.`"
      confirm-text="Desactivar"
      :loading="deactivating"
      @confirm="confirmDeactivateTier"
    />

    <NoticeDialog
      v-model="showNotice"
      :variant="noticeVariant"
      :message="noticeMessage"
    />
  </div>
</template>

<script setup lang="ts">
const api = useApi()

definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({ title: 'Motor de Tarifa | Dulce María' })

const formatPrice = (n: number | null | undefined) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))

const formatDateTime = (iso: string) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const formatDate = (iso: string) => {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Guard: exclusivo del dueño de la plataforma. Cubre navegación directa por
// URL, no solo el link oculto del sidebar (que ya está gateado en dashboard.vue).
// El contenido real (datos, tiers) queda detrás de v-if="isOwner" en el template
// para no ni siquiera renderizar el shell de la página a un usuario no autorizado.
const isOwner = ref(false)

// ── Tabs / vistas ──
const tab = ref<'lista' | 'config'>('lista')
const subView = ref<'cobros' | 'conciliacion'>('cobros')
const showInfoPanel = ref(false)

// ── Dashboard ──
interface TierSummary {
  id: string
  label: string
  min_monthly_volume_clp: number
  max_monthly_volume_clp: number | null
  fee_per_transaction_clp: number
}
interface DashboardData {
  today: { count: number; total_fees_clp: number }
  this_month: { count: number; total_fees_clp: number; volume_clp: number }
  current_tier: TierSummary | null
  fallback_alert: { count: number; total_fees_clp: number }
}

const dashboard = ref<DashboardData | null>(null)
const dashboardLoading = ref(true)
const dashboardError = ref('')

const loadDashboard = async () => {
  dashboardLoading.value = true
  dashboardError.value = ''
  try {
    const res = await api.get<{ ok: boolean } & DashboardData>('/admin/platform-fees/dashboard')
    if (res.ok) dashboard.value = res
  } catch (e: any) {
    dashboardError.value = e?.data?.error || 'Error al cargar el resumen'
  } finally {
    dashboardLoading.value = false
  }
}

// Progreso dentro de la banda del tier vigente (desde su piso hasta su techo).
// Nunca se muestra this_month.volume_clp como cifra — solo esta proporción.
const tierProgressPct = computed(() => {
  const t = dashboard.value?.current_tier
  const month = dashboard.value?.this_month
  if (!t || t.max_monthly_volume_clp == null || !month) return 0
  const min = t.min_monthly_volume_clp || 0
  const max = t.max_monthly_volume_clp
  if (max <= min) return 0
  const pct = ((month.volume_clp - min) / (max - min)) * 100
  return Math.min(100, Math.max(0, pct))
})

// ── Cobros ──
interface ChargeItem {
  id: string
  order_id: string
  order_no: string | number | null
  order_code: string | null
  order_total_clp: number
  tier_id: string | null
  tier_label_snapshot: string | null
  fee_applied_clp: number
  is_fallback: boolean
  monthly_volume_at_charge_clp: number
  monthly_txn_ordinal: number
  charged_at: string
}

const chargesFrom = ref('')
const chargesTo = ref('')
const chargesItems = ref<ChargeItem[]>([])
const chargesPage = ref(1)
const chargesTotalPages = ref(1)
const chargesLoading = ref(false)
const chargesError = ref('')
const expandedCharges = ref<Set<string>>(new Set())

const toggleChargeExpand = (id: string) => {
  const next = new Set(expandedCharges.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedCharges.value = next
}

const loadCharges = async (page = 1) => {
  chargesLoading.value = true
  chargesError.value = ''
  try {
    const params = new URLSearchParams()
    if (chargesFrom.value) params.set('from', chargesFrom.value)
    if (chargesTo.value) params.set('to', chargesTo.value)
    params.set('page', String(page))
    params.set('limit', '50')
    const res = await api.get<{ ok: boolean; items: ChargeItem[]; page: number; total_pages: number }>(`/admin/platform-fees/charges?${params.toString()}`)
    if (res.ok) {
      chargesItems.value = res.items
      chargesPage.value = res.page
      chargesTotalPages.value = res.total_pages
    }
  } catch (e: any) {
    chargesError.value = e?.data?.error || 'Error al cargar los cobros'
  } finally {
    chargesLoading.value = false
  }
}

const applyChargesFilters = () => loadCharges(1)

// ── Conciliación ──
interface ReconciliationItem {
  order_id: string
  order_no: string | number | null
  order_code: string | null
  total_clp: number
  created_at: string
  charge_id: string | null
  fee_applied_clp: number | null
  charged_at: string | null
  is_gap: boolean
}
interface ReconciliationData {
  items: ReconciliationItem[]
  total: number
  gap_count: number
}

const reconciliationFrom = ref('')
const reconciliationTo = ref('')
const reconciliation = ref<ReconciliationData | null>(null)
const reconciliationLoading = ref(false)
const reconciliationError = ref('')
const reconciliationLoaded = ref(false)

const loadReconciliation = async () => {
  reconciliationLoading.value = true
  reconciliationError.value = ''
  try {
    const params = new URLSearchParams()
    if (reconciliationFrom.value) params.set('from', reconciliationFrom.value)
    if (reconciliationTo.value) params.set('to', reconciliationTo.value)
    const res = await api.get<{ ok: boolean } & ReconciliationData>(`/admin/platform-fees/reconciliation?${params.toString()}`)
    if (res.ok) reconciliation.value = res
    reconciliationLoaded.value = true
  } catch (e: any) {
    reconciliationError.value = e?.data?.error || 'Error al cargar la conciliación'
  } finally {
    reconciliationLoading.value = false
  }
}

const applyReconciliationFilters = () => loadReconciliation()

watch(subView, (v) => {
  if (v === 'conciliacion' && !reconciliationLoaded.value) {
    loadReconciliation()
  }
})

// ── Tiers ──
interface TierItem {
  id: string
  label: string
  min_monthly_volume_clp: number
  max_monthly_volume_clp: number | null
  fee_per_transaction_clp: number
  is_active: boolean
}

const tiers = ref<TierItem[]>([])
const tiersLoading = ref(true)
const tiersError = ref('')

const loadTiers = async () => {
  tiersLoading.value = true
  tiersError.value = ''
  try {
    const res = await api.get<{ ok: boolean; tiers: TierItem[] }>('/admin/platform-fees/tiers')
    if (res.ok) tiers.value = res.tiers
  } catch (e: any) {
    tiersError.value = e?.data?.error || 'Error al cargar los tiers'
  } finally {
    tiersLoading.value = false
  }
}

const formatTierRange = (t: TierItem) => {
  if (t.max_monthly_volume_clp == null) {
    return `Desde $${formatPrice(t.min_monthly_volume_clp)} — sin techo`
  }
  if (t.min_monthly_volume_clp === 0) {
    return `Hasta $${formatPrice(t.max_monthly_volume_clp)}/mes`
  }
  return `Desde $${formatPrice(t.min_monthly_volume_clp)} hasta $${formatPrice(t.max_monthly_volume_clp)}/mes`
}

// ── Panel crear/editar tier ──
const showTierPanel = ref(false)
const editingTierId = ref<string | null>(null)
const tierSaving = ref(false)
const tierPanelError = ref('')

const tierForm = ref({
  label: '',
  min: 0 as number | null,
  max: null as number | null,
  noCeiling: false,
  fee: 0 as number | null,
  isActive: true,
})

watch(() => tierForm.value.noCeiling, (v) => {
  if (v) tierForm.value.max = null
})

// Misma lógica de solapamiento semi-abierto [min, max) que usa el backend
// (findOverlappingTier en admin.platformFees.js), tratando null como infinito
// — corre en vivo mientras se edita, ANTES de mandar el request.
const rangesOverlap = (aMin: number, aMax: number | null, bMin: number, bMax: number | null) => {
  const aMaxN = aMax == null ? Infinity : aMax
  const bMaxN = bMax == null ? Infinity : bMax
  return aMin < bMaxN && bMin < aMaxN
}

const overlapError = computed(() => {
  if (!tierForm.value.isActive) return ''
  const min = Number(tierForm.value.min)
  if (Number.isNaN(min)) return ''
  const max = tierForm.value.noCeiling ? null : (tierForm.value.max != null ? Number(tierForm.value.max) : null)
  if (max != null && max <= min) return 'El techo debe ser mayor que el piso'

  for (const t of tiers.value) {
    if (!t.is_active) continue
    if (editingTierId.value && t.id === editingTierId.value) continue
    if (rangesOverlap(t.min_monthly_volume_clp, t.max_monthly_volume_clp, min, max)) {
      if (max == null && t.max_monthly_volume_clp == null) {
        return `Ya existe un tier sin techo activo ("${t.label}"). Solo puede haber uno.`
      }
      return `Se superpone con "${t.label}"`
    }
  }
  return ''
})

const canSaveTier = computed(() => {
  if (overlapError.value) return false
  if (!tierForm.value.label.trim()) return false
  if (tierForm.value.min == null || Number.isNaN(Number(tierForm.value.min))) return false
  if (tierForm.value.fee == null || Number.isNaN(Number(tierForm.value.fee))) return false
  return true
})

const openCreateTierPanel = () => {
  editingTierId.value = null
  const activeMaxes = tiers.value
    .filter(t => t.is_active && t.max_monthly_volume_clp != null)
    .map(t => t.max_monthly_volume_clp as number)
  const suggestedMin = activeMaxes.length > 0 ? Math.max(...activeMaxes) + 1 : 0
  tierForm.value = { label: '', min: suggestedMin, max: null, noCeiling: false, fee: 0, isActive: true }
  tierPanelError.value = ''
  showTierPanel.value = true
}

const openEditTierPanel = (t: TierItem) => {
  editingTierId.value = t.id
  tierForm.value = {
    label: t.label,
    min: t.min_monthly_volume_clp,
    max: t.max_monthly_volume_clp,
    noCeiling: t.max_monthly_volume_clp == null,
    fee: t.fee_per_transaction_clp,
    isActive: t.is_active,
  }
  tierPanelError.value = ''
  showTierPanel.value = true
}

const showNotice = ref(false)
const noticeVariant = ref<'success' | 'error'>('success')
const noticeMessage = ref('')

const saveTier = async () => {
  tierPanelError.value = ''
  if (!canSaveTier.value) {
    tierPanelError.value = overlapError.value || 'Completá los campos obligatorios'
    return
  }
  tierSaving.value = true
  try {
    const payload = {
      label: tierForm.value.label.trim(),
      min_monthly_volume_clp: Number(tierForm.value.min) || 0,
      max_monthly_volume_clp: tierForm.value.noCeiling ? null : (tierForm.value.max != null ? Number(tierForm.value.max) : null),
      fee_per_transaction_clp: Number(tierForm.value.fee) || 0,
      is_active: tierForm.value.isActive,
    }

    if (editingTierId.value) {
      const res = await api.patch<{ ok: boolean }>(`/admin/platform-fees/tiers/${editingTierId.value}`, payload)
      if (res.ok) {
        showTierPanel.value = false
        await loadTiers()
        noticeVariant.value = 'success'
        noticeMessage.value = 'Tier actualizado correctamente.'
        showNotice.value = true
      }
    } else {
      const res = await api.post<{ ok: boolean }>('/admin/platform-fees/tiers', payload)
      if (res.ok) {
        showTierPanel.value = false
        await loadTiers()
        noticeVariant.value = 'success'
        noticeMessage.value = 'Tier creado correctamente.'
        showNotice.value = true
      }
    }
  } catch (e: any) {
    const backendError = e?.data?.error
    tierPanelError.value = typeof backendError === 'string' ? backendError : 'Error al guardar el tier'
  } finally {
    tierSaving.value = false
  }
}

// ── Desactivar tier ──
const showDeactivateDialog = ref(false)
const tierToDeactivate = ref<TierItem | null>(null)
const deactivating = ref(false)

const openDeactivateDialog = (t: TierItem) => {
  tierToDeactivate.value = t
  showDeactivateDialog.value = true
}

const confirmDeactivateTier = async () => {
  if (!tierToDeactivate.value) return
  deactivating.value = true
  try {
    await api.delete(`/admin/platform-fees/tiers/${tierToDeactivate.value.id}`)
    showDeactivateDialog.value = false
    await loadTiers()
    noticeVariant.value = 'success'
    noticeMessage.value = 'Tier desactivado correctamente.'
    showNotice.value = true
  } catch (e: any) {
    showDeactivateDialog.value = false
    noticeVariant.value = 'error'
    noticeMessage.value = e?.data?.error || 'Error al desactivar el tier'
    showNotice.value = true
  } finally {
    deactivating.value = false
    tierToDeactivate.value = null
  }
}

onMounted(() => {
  let owner = false
  try {
    const userStr = localStorage.getItem('user')
    owner = JSON.parse(userStr || 'null')?.is_platform_owner === true
  } catch {}

  isOwner.value = owner

  if (!owner) {
    navigateTo('/dashboard')
    return
  }

  loadDashboard()
  loadCharges(1)
  loadTiers()
})
</script>
