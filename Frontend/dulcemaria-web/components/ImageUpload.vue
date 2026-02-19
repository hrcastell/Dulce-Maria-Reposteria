<template>
  <div class="space-y-4">
    <div>
      <label class="label">Imágenes del Producto</label>
      <p class="text-xs text-gray-500 mb-2">Sube hasta 5 imágenes. Formatos: JPG, PNG, WEBP (máx 5MB c/u)</p>
      
      <div class="flex gap-2 mb-3">
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
          class="btn-secondary text-sm"
          @click="$refs.fileInput.click()"
        >
          📁 Seleccionar Archivos
        </button>
        
        <button
          v-if="supportsCamera"
          type="button"
          class="btn-secondary text-sm"
          @click="openCamera"
        >
          📷 Tomar Foto
        </button>
      </div>

      <div v-if="error" class="rounded-md bg-red-50 p-3 mb-3">
        <p class="text-sm text-red-800">{{ error }}</p>
      </div>

      <div v-if="images.length > 0" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div
          v-for="(img, idx) in images"
          :key="idx"
          class="relative group border-2 rounded-lg overflow-hidden"
          :class="img.isPrimary ? 'border-primary-500' : 'border-gray-300'"
        >
          <img
            :src="img.preview"
            :alt="`Imagen ${idx + 1}`"
            class="w-full h-32 object-cover"
          >
          
          <div v-if="img.deleting" class="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center">
            <span class="text-white text-xs">Eliminando...</span>
          </div>

          <div v-else class="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              v-if="!img.isPrimary"
              type="button"
              class="bg-white text-gray-800 px-2 py-1 rounded text-xs hover:bg-gray-100"
              @click="setPrimary(idx)"
              title="Marcar como principal"
            >
              ⭐ Principal
            </button>
            <button
              type="button"
              class="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700"
              @click="removeImage(idx)"
            >
              🗑️ Eliminar
            </button>
          </div>

          <div v-if="img.isPrimary" class="absolute top-1 left-1 bg-primary-600 text-white text-xs px-2 py-0.5 rounded">
            Principal
          </div>

          <div v-if="img.uploading" class="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
            <div class="text-sm text-gray-700">Subiendo...</div>
          </div>
        </div>
      </div>

      <div v-else class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center text-gray-500">
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
        <video
          ref="videoElement"
          autoplay
          playsinline
          class="w-full rounded-lg bg-black"
          style="max-height: 400px;"
        ></video>
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
