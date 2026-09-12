<!--
  Captura + parseo + revisión de una boleta/factura (foto/PDF/Excel/CSV) para
  precargar el detalle de un gasto. Solo hace esto — el emparejamiento con
  insumos del catálogo y el gate de contenido neto viven en supplies.vue
  (startImportQueue), reusando el panel "Agregar Producto al Detalle" que ya
  existe. Acá nada se guarda: el usuario elige qué ítems detectados pasar a la
  cola con el evento `parsed`, y cada uno se confirma de a uno en ese panel.

  Sobre DialogShell directo (no <Modal>): es un wizard de 3 pasos con acciones
  distintas por paso, no un formulario simple con Guardar/Cancelar fijos.
-->
<template>
  <DialogShell
    :open="modelValue"
    title="Importar boleta o factura"
    size="xl"
    :dismissible="step !== 'parsing'"
    @close="close"
  >
    <template #title>
      <div class="px-6 py-5 border-b border-warm-100">
        <h3 class="text-lg font-semibold text-warm-800">Importar boleta o factura</h3>
        <p class="text-sm text-warm-500 mt-1">Sacale una foto o subí un PDF/Excel — vas a poder revisar cada producto antes de agregarlo, nada se guarda solo.</p>
      </div>
    </template>

    <div class="px-6 py-6">
      <!-- Paso 1: captura -->
      <div v-if="step === 'capture'">
        <div v-if="captureMode === 'choose'" class="space-y-4">
          <input
            ref="fileInput"
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,image/jpeg,image/png,image/webp"
            class="hidden"
            @change="handleFileSelect"
          >
          <div class="flex flex-wrap gap-3">
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2.5 bg-warm-100 hover:bg-warm-200 text-warm-700 text-sm font-medium rounded-xl transition-colors"
              @click="fileInput?.click()"
            >
              <span class="text-lg">📁</span> Seleccionar Archivo
            </button>
            <button
              v-if="supportsCamera"
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2.5 bg-warm-100 hover:bg-warm-200 text-warm-700 text-sm font-medium rounded-xl transition-colors"
              @click="openCamera"
            >
              <span class="text-lg">📷</span> Tomar Foto
            </button>
          </div>
          <p class="text-xs text-warm-500">Formatos: PDF, Excel (.xlsx/.xls), CSV o foto (JPG/PNG/WebP). Máx 15 MB.</p>

          <div v-if="captureError" class="rounded-xl bg-error-50 p-3 border border-error-100 text-sm text-error-700">
            {{ captureError }}
          </div>
        </div>

        <!-- Cámara: mismo patrón que ImageUpload.vue (getUserMedia + video/canvas),
             pero como paso interno en vez de un <Modal> anidado — un modal-sobre-modal
             duplicaría el backdrop de DialogShell. -->
        <div v-else class="space-y-3">
          <div class="relative rounded-xl overflow-hidden bg-black aspect-[3/4] sm:aspect-video">
            <video ref="videoElement" autoplay playsinline class="w-full h-full object-cover"></video>
          </div>
          <canvas ref="canvasElement" class="hidden"></canvas>
          <div v-if="captureError" class="rounded-xl bg-error-50 p-3 border border-error-100 text-sm text-error-700">
            {{ captureError }}
          </div>
        </div>
      </div>

      <!-- Paso 2: parseando -->
      <div v-else-if="step === 'parsing'" class="py-10 flex flex-col items-center gap-4">
        <svg class="animate-spin h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
        </svg>
        <div class="text-center">
          <p class="text-sm font-medium text-warm-700">{{ parsingLabel }}</p>
          <div v-if="parseProgress?.progress != null" class="w-56 h-1.5 bg-warm-100 rounded-full overflow-hidden mt-3 mx-auto">
            <div
              class="h-full bg-primary-500 transition-all duration-300"
              :style="{ width: `${Math.round((parseProgress.progress ?? 0) * 100)}%` }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Paso 3: revisión -->
      <div v-else class="space-y-4">
        <!-- Error duro: archivo no soportado, >15MB, o falla de lectura -->
        <div v-if="!result?.ok" class="space-y-3">
          <div class="rounded-xl bg-error-50 p-4 border border-error-100">
            <p class="text-sm font-medium text-error-700">{{ result?.error || 'No se pudo leer el archivo.' }}</p>
            <p v-if="result?.source === 'foto'" class="text-xs text-error-600 mt-1">
              Si el problema persiste, revisá tu conexión — la primera vez se descargan los modelos de reconocimiento de texto.
            </p>
          </div>
        </div>

        <template v-else>
          <!-- Sin ítems reconocibles -->
          <div v-if="!result.isQuote || result.items.length === 0" class="rounded-xl bg-warm-50 p-4 border border-warm-200">
            <p class="text-sm text-warm-700">{{ result.reason || 'No se encontraron productos legibles en el documento.' }}</p>
            <p class="text-xs text-warm-500 mt-1">Podés seguir cargando el gasto a mano con "+ Agregar Producto".</p>
          </div>

          <template v-else>
            <!-- Resumen del documento -->
            <div class="rounded-xl bg-warm-50 p-4 border border-warm-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div class="text-warm-500 text-xs">Tipo</div>
                <div class="font-medium text-warm-800 capitalize">{{ result.docType || 'No detectado' }}</div>
              </div>
              <div v-if="result.documentNumber">
                <div class="text-warm-500 text-xs">Folio</div>
                <div class="font-medium text-warm-800">{{ result.documentNumber }}</div>
              </div>
              <div v-if="result.subtotal != null">
                <div class="text-warm-500 text-xs">Subtotal</div>
                <div class="font-medium text-warm-800">${{ formatPrice(result.subtotal) }}</div>
              </div>
              <div v-if="result.iva != null">
                <div class="text-warm-500 text-xs">IVA</div>
                <div class="font-medium text-warm-800">${{ formatPrice(result.iva) }}</div>
              </div>
              <div v-if="result.total != null">
                <div class="text-warm-500 text-xs">Total</div>
                <div class="font-medium text-warm-800">${{ formatPrice(result.total) }}</div>
              </div>
            </div>

            <!-- Confianza OCR baja -->
            <div v-if="result.ocrConfidence != null && result.ocrConfidence < 0.5" class="rounded-xl bg-warning-50 p-3 border border-warning-100 text-sm text-warning-700">
              ⚠️ Confianza de lectura baja ({{ Math.round(result.ocrConfidence * 100) }}%) — revisá cada ítem con cuidado antes de confirmarlo.
            </div>

            <!-- Advertencias del motor (suma no cuadra, IVA no leído, etc.) -->
            <div v-if="result.warnings?.length" class="rounded-xl bg-warning-50 p-3 border border-warning-100 text-sm text-warning-700 space-y-1">
              <p v-for="(w, i) in result.warnings" :key="i">⚠️ {{ w }}</p>
            </div>

            <!-- Checklist de ítems detectados -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-medium text-warm-700">{{ result.items.length }} producto(s) detectado(s)</span>
                <div class="flex gap-3 text-xs">
                  <button type="button" class="text-primary-600 hover:text-primary-700 font-medium" @click="selectAll(true)">Seleccionar todos</button>
                  <button type="button" class="text-warm-500 hover:text-warm-700 font-medium" @click="selectAll(false)">Ninguno</button>
                </div>
              </div>
              <div class="border border-warm-200 rounded-xl divide-y divide-warm-100 max-h-64 overflow-y-auto">
                <label
                  v-for="(item, idx) in result.items"
                  :key="idx"
                  class="flex items-start gap-3 px-4 py-3 hover:bg-warm-50 cursor-pointer"
                >
                  <input type="checkbox" v-model="included[idx]" class="mt-1 rounded border-warm-300 text-primary-600 focus:ring-primary-400">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-warm-800 truncate">{{ item.descripcion }}</div>
                    <div class="text-xs text-warm-500">
                      {{ item.cantidad ?? '—' }} × ${{ item.valorUnitario != null ? formatPrice(item.valorUnitario) : '—' }}
                      <span v-if="item.total != null"> = ${{ formatPrice(item.total) }}</span>
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <template #footer>
      <div class="bg-warm-50 px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        <!-- Paso 1, modo cámara -->
        <template v-if="step === 'capture' && captureMode === 'camera'">
          <button type="button" class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-warm-100 text-warm-700 font-medium rounded-xl border border-warm-200 transition-all duration-200" @click="closeCamera">
            Cancelar
          </button>
          <button type="button" class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200" @click="capturePhoto">
            📷 Capturar
          </button>
        </template>

        <!-- Paso 1, elegir archivo -->
        <template v-else-if="step === 'capture'">
          <button type="button" class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-warm-100 text-warm-700 font-medium rounded-xl border border-warm-200 transition-all duration-200" @click="close">
            Cancelar
          </button>
        </template>

        <!-- Paso 3: revisión -->
        <template v-else-if="step === 'review'">
          <button type="button" class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-warm-100 text-warm-700 font-medium rounded-xl border border-warm-200 transition-all duration-200" @click="close">
            Cancelar
          </button>
          <button
            v-if="!result?.ok && result?.source === 'foto'"
            type="button"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200"
            @click="retryParse"
          >
            Reintentar
          </button>
          <button
            v-if="!result?.ok || !result?.isQuote || !result?.items?.length"
            type="button"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200"
            @click="backToCapture"
          >
            Elegir otro archivo
          </button>
          <button
            v-if="result?.ok && result.isQuote && result.items.length > 0"
            type="button"
            :disabled="selectedCount === 0"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200"
            @click="confirmParsed"
          >
            Cargar {{ selectedCount }} ítem{{ selectedCount === 1 ? '' : 's' }}
          </button>
        </template>
      </div>
    </template>
  </DialogShell>
</template>

<script setup lang="ts">
import type { QuoteLineItem } from '~/lib/quote-grid'
import type { QuoteParseResult } from '~/lib/quote-parser'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  parsed: [items: QuoteLineItem[]]
}>()

const formatPrice = (n: number) => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))

type Step = 'capture' | 'parsing' | 'review'
const step = ref<Step>('capture')
const captureMode = ref<'choose' | 'camera'>('choose')
const captureError = ref('')

const fileInput = ref<HTMLInputElement>()
const currentFile = ref<File | null>(null)
const result = ref<QuoteParseResult | null>(null)
const included = ref<boolean[]>([])

type ParseProgress = { status: string; progress: number }
const parseProgress = ref<ParseProgress | null>(null)

// Traduce los `status` en inglés que manda el logger de Tesseract.js — con
// fallback al texto crudo si aparece uno que no está en el mapa, para nunca
// dejar la barra de progreso en blanco.
const PROGRESS_LABELS: Record<string, string> = {
  'preparando imagen': 'Preparando imagen…',
  'loading tesseract core': 'Cargando motor de reconocimiento…',
  'initializing tesseract': 'Iniciando reconocimiento…',
  'loading language traineddata': 'Cargando diccionario de idioma…',
  'initializing api': 'Preparando lectura…',
  'recognizing text': 'Leyendo texto…',
}
const parsingLabel = computed(() => {
  const status = parseProgress.value?.status
  if (!status) return 'Leyendo archivo…'
  return PROGRESS_LABELS[status] || status
})

const selectedCount = computed(() => included.value.filter(Boolean).length)

const selectAll = (value: boolean) => {
  included.value = included.value.map(() => value)
}

const resetState = () => {
  step.value = 'capture'
  captureMode.value = 'choose'
  captureError.value = ''
  currentFile.value = null
  result.value = null
  included.value = []
  parseProgress.value = null
}

const close = () => {
  closeCamera()
  emit('update:modelValue', false)
}

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) resetState()
  else closeCamera()
})

// ── Selección de archivo ────────────────────────────────────────────────────
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  captureError.value = ''
  runParse(file)
}

// ── Cámara: mismo patrón que components/ImageUpload.vue ────────────────────
const videoElement = ref<HTMLVideoElement>()
const canvasElement = ref<HTMLCanvasElement>()
let mediaStream: MediaStream | null = null

const supportsCamera = computed(() => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia))

const openCamera = async () => {
  captureError.value = ''
  captureMode.value = 'camera'
  await nextTick()
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    if (videoElement.value) videoElement.value.srcObject = mediaStream
  } catch (e: any) {
    captureError.value = 'No se pudo acceder a la cámara: ' + (e?.message || 'permiso denegado')
    captureMode.value = 'choose'
  }
}

const closeCamera = () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }
  if (captureMode.value === 'camera') captureMode.value = 'choose'
}

const capturePhoto = () => {
  if (!videoElement.value || !canvasElement.value) return
  const video = videoElement.value
  const canvas = canvasElement.value
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(video, 0, 0)
  canvas.toBlob((blob) => {
    if (!blob) return
    const file = new File([blob], `boleta-${Date.now()}.jpg`, { type: 'image/jpeg' })
    closeCamera()
    runParse(file)
  }, 'image/jpeg', 0.9)
}

// ── Parseo ───────────────────────────────────────────────────────────────────
const runParse = async (file: File) => {
  currentFile.value = file
  step.value = 'parsing'
  parseProgress.value = null
  const { parseQuoteFile } = await import('~/lib/quote-parser')
  const parsed = await parseQuoteFile(file, (p) => { parseProgress.value = p })
  result.value = parsed
  included.value = parsed.items.map(() => true)
  step.value = 'review'
}

const retryParse = () => {
  if (currentFile.value) runParse(currentFile.value)
}

const backToCapture = () => {
  step.value = 'capture'
  captureMode.value = 'choose'
  result.value = null
}

const confirmParsed = () => {
  if (!result.value?.items) return
  const chosen = result.value.items.filter((_, idx) => included.value[idx])
  emit('parsed', chosen)
  emit('update:modelValue', false)
}

onBeforeUnmount(() => {
  closeCamera()
})
</script>
