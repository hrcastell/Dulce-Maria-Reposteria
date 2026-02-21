<template>
  <div class="space-y-4">
    <div>
      <label class="block text-sm font-medium text-warm-700 mb-2">Imágenes del Producto</label>
      <p class="text-xs text-warm-500 mb-3">Sube hasta 5 imágenes. Formatos: JPG, PNG, WEBP (máx 5MB c/u)</p>
      
      <div class="flex flex-wrap gap-3 mb-4">
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          class="hidden"
          @change="handleFileSelect"
        >
        
        <button
          type="button"
          class="inline-flex items-center gap-2 px-4 py-2.5 bg-warm-100 hover:bg-warm-200 text-warm-700 text-sm font-medium rounded-xl transition-colors"
          @click="$refs.fileInput.click()"
        >
          <span class="text-lg">📁</span> Seleccionar Archivos
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

      <div v-if="error" class="rounded-xl bg-error-50 p-4 mb-4 border border-error-100">
        <p class="text-sm text-error-700">{{ error }}</p>
      </div>

      <div v-if="images.length > 0" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        <div
          v-for="(img, idx) in images"
          :key="idx"
          class="relative group aspect-square rounded-xl overflow-hidden border-2 transition-all"
          :class="img.isPrimary ? 'border-primary-500 ring-2 ring-primary-200' : 'border-warm-200 hover:border-warm-300'"
        >
          <img
            :src="img.preview"
            :alt="`Imagen ${idx + 1}`"
            class="w-full h-full object-cover"
          >
          
          <div v-if="img.deleting" class="absolute inset-0 bg-warm-900/60 flex items-center justify-center">
            <span class="text-white text-xs font-medium">Eliminando...</span>
          </div>

          <div v-else class="absolute inset-0 bg-warm-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
            <button
              v-if="!img.isPrimary"
              type="button"
              class="w-full bg-white text-warm-800 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-warm-50 transition-colors shadow-sm"
              @click="setPrimary(idx)"
              title="Marcar como principal"
            >
              ⭐ Principal
            </button>
            <button
              type="button"
              class="w-full bg-error-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-error-600 transition-colors shadow-sm"
              @click="removeImage(idx)"
            >
              🗑️ Eliminar
            </button>
          </div>

          <div v-if="img.isPrimary" class="absolute top-2 left-2 bg-primary-500 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-sm uppercase tracking-wide">
            Principal
          </div>

          <div v-if="img.uploading" class="absolute inset-0 bg-white/80 flex items-center justify-center backdrop-blur-sm">
            <div class="text-xs font-medium text-warm-600">Subiendo...</div>
          </div>
        </div>
      </div>

      <div v-else class="border-2 border-dashed border-warm-200 rounded-xl p-8 text-center text-warm-400 bg-warm-50/50">
        <p>No hay imágenes. Selecciona archivos o toma una foto.</p>
      </div>
    </div>

    <!-- Camera Modal -->
    <Modal
      v-model="showCamera"
      title="Tomar Foto"
      submit-text="Capturar"
      @submit="capturePhoto"
    >
      <div class="space-y-3">
        <div class="relative rounded-xl overflow-hidden bg-black aspect-[3/4] sm:aspect-video">
          <video
            ref="videoElement"
            autoplay
            playsinline
            class="w-full h-full object-cover"
          ></video>
        </div>
        <canvas ref="canvasElement" class="hidden"></canvas>
      </div>
    </Modal>
  </div>
</template>

<script setup lang="ts">
interface ImageData {
  file?: File
  preview: string
  isPrimary: boolean
  uploading: boolean
  deleting?: boolean
  id?: string
}

const props = defineProps<{
  productId?: string
  existingImages?: any[]
}>()

const config = useRuntimeConfig()
const api = useApi()

const getAbsoluteUrl = (url: string) => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) return url
  return `${config.public.apiBase}${url}`
}

const emit = defineEmits<{
  update: [images: ImageData[]]
}>()

const images = ref<ImageData[]>([])
const error = ref('')
const fileInput = ref<HTMLInputElement>()
const showCamera = ref(false)
const videoElement = ref<HTMLVideoElement>()
const canvasElement = ref<HTMLCanvasElement>()
let mediaStream: MediaStream | null = null

const supportsCamera = computed(() => {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
})

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files) return

  error.value = ''

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    
    if (images.value.length >= 5) {
      error.value = 'Máximo 5 imágenes permitidas'
      break
    }

    if (file.size > 5 * 1024 * 1024) {
      error.value = `${file.name} es muy grande (máx 5MB)`
      continue
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      error.value = `${file.name} no es un formato válido`
      continue
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      images.value.push({
        file,
        preview: e.target?.result as string,
        isPrimary: images.value.length === 0,
        uploading: false
      })
      emit('update', images.value)
    }
    reader.readAsDataURL(file)
  }

  target.value = ''
}

const openCamera = async () => {
  try {
    error.value = ''
    showCamera.value = true
    
    await nextTick()
    
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    })
    
    if (videoElement.value) {
      videoElement.value.srcObject = mediaStream
    }
  } catch (e: any) {
    error.value = 'No se pudo acceder a la cámara: ' + e.message
    showCamera.value = false
  }
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

    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
    const preview = canvas.toDataURL('image/jpeg')

    images.value.push({
      file,
      preview,
      isPrimary: images.value.length === 0,
      uploading: false
    })

    emit('update', images.value)
    closeCamera()
  }, 'image/jpeg', 0.9)
}

const closeCamera = () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop())
    mediaStream = null
  }
  showCamera.value = false
}

const setPrimary = (idx: number) => {
  images.value.forEach((img, i) => {
    img.isPrimary = i === idx
  })
  emit('update', images.value)
}

const removeImage = async (idx: number) => {
  const img = images.value[idx]

  if (img.id) {
    img.deleting = true
    try {
      await api.delete(`/admin/products/images/${img.id}`)
    } catch (e: any) {
      error.value = 'Error al eliminar imagen: ' + (e?.data?.error || e.message)
      img.deleting = false
      return
    }
  }

  images.value.splice(idx, 1)

  if (images.value.length > 0 && !images.value.some(i => i.isPrimary)) {
    images.value[0].isPrimary = true
  }

  emit('update', images.value)
}

watch(() => showCamera.value, (newVal) => {
  if (!newVal) {
    closeCamera()
  }
})

const loadExistingImages = (list: any[]) => {
  if (list && list.length > 0) {
    images.value = list.map(img => ({
      preview: getAbsoluteUrl(img.url_thumb || img.url_original),
      isPrimary: img.is_primary,
      uploading: false,
      deleting: false,
      id: img.id
    }))
  }
}

watch(() => props.existingImages, (newVal) => {
  if (newVal) loadExistingImages(newVal)
}, { immediate: true })

onUnmounted(() => {
  closeCamera()
})

defineExpose({ images })
</script>
