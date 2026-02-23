<template>
  <div>
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-warm-800">Banners Web</h1>
        <p class="text-warm-600 mt-2">Gestiona las imágenes y textos del carrusel principal.</p>
      </div>
      <button
        @click="openCreateModal"
        class="bg-primary-600 text-white px-6 py-2.5 rounded-xl hover:bg-primary-700 transition-colors shadow-soft flex items-center gap-2"
      >
        <span>➕</span>
        Nuevo Banner
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent"></div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="bg-error-50 text-error-600 p-4 rounded-xl mb-6">
      {{ error }}
    </div>

    <!-- Empty State -->
    <div v-else-if="slides.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
      <div class="text-6xl mb-4">🖼️</div>
      <h3 class="text-xl font-bold text-warm-800 mb-2">No hay banners configurados</h3>
      <p class="text-warm-600 mb-6">Agrega el primero para dar vida a la portada de tu web.</p>
      <button
        @click="openCreateModal"
        class="bg-primary-600 text-white px-6 py-2.5 rounded-xl hover:bg-primary-700 transition-colors"
      >
        Crear Banner
      </button>
    </div>

    <!-- Grid Layout -->
    <div v-else class="grid grid-cols-1 gap-6">
      <div
        v-for="slide in slides"
        :key="slide.id"
        class="bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden flex flex-col md:flex-row"
      >
        <!-- Image Preview -->
        <div class="w-full md:w-1/3 h-48 md:h-auto relative bg-warm-50">
          <img
            :src="getImageUrl(slide.image_url)"
            :alt="slide.title || 'Banner'"
            class="w-full h-full object-cover"
          />
          <div class="absolute top-2 right-2 flex gap-2">
            <span
              :class="[
                'px-2 py-1 rounded-full text-xs font-bold shadow-sm',
                slide.is_active ? 'bg-success-100 text-success-700' : 'bg-warm-200 text-warm-600'
              ]"
            >
              {{ slide.is_active ? 'ACTIVO' : 'INACTIVO' }}
            </span>
          </div>
        </div>

        <!-- Content -->
        <div class="p-6 flex-1 flex flex-col justify-between">
          <div>
            <div class="flex justify-between items-start mb-2">
              <h3 class="text-xl font-bold text-warm-900">{{ slide.title || '(Sin título)' }}</h3>
              <span class="text-xs font-mono bg-warm-100 px-2 py-1 rounded text-warm-600">
                Orden: {{ slide.sort_order }}
              </span>
            </div>
            <p class="text-warm-600 mb-4">{{ slide.subtitle || '(Sin subtítulo)' }}</p>
            
            <div v-if="slide.button_text" class="mb-4">
              <span class="text-xs uppercase text-warm-400 font-bold tracking-wider">Botón:</span>
              <span class="ml-2 text-sm bg-primary-50 text-primary-700 px-2 py-1 rounded">
                {{ slide.button_text }} 
                <span v-if="slide.button_link" class="text-warm-400 text-xs ml-1">→ {{ slide.button_link }}</span>
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-3 mt-4 border-t border-warm-100 pt-4">
            <button
              @click="openEditModal(slide)"
              class="flex-1 px-4 py-2 bg-warm-50 text-warm-700 rounded-lg hover:bg-warm-100 transition-colors font-medium text-sm flex justify-center items-center gap-2"
            >
              <span>✏️</span> Editar
            </button>
            <button
              @click="confirmDelete(slide)"
              class="px-4 py-2 bg-error-50 text-error-600 rounded-lg hover:bg-error-100 transition-colors font-medium text-sm"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Form -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-warm-900/50 backdrop-blur-sm" @click="closeModal"></div>
      <div class="bg-white rounded-2xl shadow-soft-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative z-10">
        <div class="p-6 border-b border-warm-100 flex justify-between items-center sticky top-0 bg-white z-20">
          <h2 class="text-xl font-bold text-warm-900">
            {{ editingSlide ? 'Editar Banner' : 'Nuevo Banner' }}
          </h2>
          <button @click="closeModal" class="text-warm-400 hover:text-warm-600">
            <span class="text-2xl">×</span>
          </button>
        </div>

        <form @submit.prevent="saveSlide" class="p-6 space-y-6">
          <!-- Image Upload -->
          <div>
            <label class="block text-sm font-medium text-warm-700 mb-2">Imagen *</label>
            <div class="flex items-center gap-6">
              <div 
                class="w-32 h-20 bg-warm-50 rounded-lg border-2 border-dashed border-warm-200 flex items-center justify-center overflow-hidden relative"
              >
                <img 
                  v-if="imagePreview" 
                  :src="imagePreview" 
                  class="w-full h-full object-cover" 
                />
                <span v-else class="text-2xl text-warm-300">📷</span>
              </div>
              <div class="flex-1">
                <input
                  type="file"
                  ref="fileInput"
                  @change="handleFileChange"
                  accept="image/jpeg,image/png,image/webp"
                  class="block w-full text-sm text-warm-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-primary-50 file:text-primary-700
                    hover:file:bg-primary-100
                  "
                />
                <p class="text-xs text-warm-500 mt-1">Recomendado: 1920x600px o similar. Máx 5MB.</p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Title -->
            <div class="col-span-2">
              <label class="block text-sm font-medium text-warm-700 mb-1">Título Principal</label>
              <input
                v-model="form.title"
                type="text"
                class="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition-all"
                placeholder="Ej: ¡Ofertas Especiales!"
              />
            </div>

            <!-- Subtitle -->
            <div class="col-span-2">
              <label class="block text-sm font-medium text-warm-700 mb-1">Subtítulo / Descripción</label>
              <input
                v-model="form.subtitle"
                type="text"
                class="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition-all"
                placeholder="Ej: 30% de descuento en tortas personalizadas"
              />
            </div>

            <!-- Button Text -->
            <div>
              <label class="block text-sm font-medium text-warm-700 mb-1">Texto del Botón</label>
              <input
                v-model="form.button_text"
                type="text"
                class="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition-all"
                placeholder="Ej: Ver Catálogo"
              />
            </div>

            <!-- Button Link -->
            <div>
              <label class="block text-sm font-medium text-warm-700 mb-1">Enlace del Botón</label>
              <input
                v-model="form.button_link"
                type="text"
                class="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition-all"
                placeholder="Ej: #catalogo"
              />
            </div>

            <!-- Status -->
            <div>
              <label class="block text-sm font-medium text-warm-700 mb-1">Estado</label>
              <select
                v-model="form.is_active"
                class="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition-all"
              >
                <option :value="true">Activo</option>
                <option :value="false">Inactivo</option>
              </select>
            </div>
            
            <!-- Order (Admin hack) -->
             <div>
              <label class="block text-sm font-medium text-warm-700 mb-1">Orden (Manual)</label>
              <input
                v-if="editingSlide"
                type="number"
                disabled
                :value="editingSlide.sort_order"
                class="w-full px-4 py-2 rounded-lg border border-warm-100 bg-warm-50 text-warm-400 cursor-not-allowed"
              />
              <p v-else class="text-xs text-warm-500 mt-2">Se asignará automáticamente al final.</p>
            </div>
          </div>

          <!-- Error in Modal -->
          <div v-if="modalError" class="bg-error-50 text-error-600 p-3 rounded-lg text-sm">
            {{ modalError }}
          </div>

          <div class="flex justify-end gap-3 pt-6 border-t border-warm-100">
            <button
              type="button"
              @click="closeModal"
              class="px-6 py-2 rounded-xl text-warm-600 hover:bg-warm-50 transition-colors font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="px-6 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium shadow-soft disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span v-if="saving" class="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
              {{ saving ? 'Guardando...' : 'Guardar Banner' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

const config = useRuntimeConfig()
const api = useApi()

interface HeroSlide {
  id: string
  title: string
  subtitle: string
  button_text: string
  button_link: string
  image_url: string
  is_active: boolean
  sort_order: number
}

const slides = ref<HeroSlide[]>([])
const loading = ref(true)
const error = ref('')
const showModal = ref(false)
const editingSlide = ref<HeroSlide | null>(null)
const modalError = ref('')
const saving = ref(false)

// Form state
const form = reactive({
  title: '',
  subtitle: '',
  button_text: '',
  button_link: '',
  is_active: true
})
const selectedFile = ref<File | null>(null)
const imagePreview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// Load data
const loadSlides = async () => {
  try {
    loading.value = true
    error.value = ''
    const res = await api.get<{ ok: boolean, items: HeroSlide[] }>('/admin/hero')
    if (res.ok) {
      slides.value = res.items
    }
  } catch (e: any) {
    error.value = 'Error al cargar banners: ' + (e.message || 'Desconocido')
  } finally {
    loading.value = false
  }
}

// Helpers
const getImageUrl = (url: string) => {
  if (!url) return ''
  if (url.startsWith('http')) return url
  // Handle backend relative paths
  const base = config.public.apiBase.replace(/\/$/, '')
  const path = url.startsWith('/') ? url : '/' + url
  // Backend stores as /uploads/hero/..., we need to ensure /dulcemaria prefix if API base has it
  // Actually apiBase is https://hrcastell.com/dulcemaria
  // And backend serves /dulcemaria/uploads
  // So standard concatenation works: https://hrcastell.com/dulcemaria + /uploads/hero/img.jpg
  return base + path
}

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    const file = input.files[0]
    if (file.size > 5 * 1024 * 1024) {
      modalError.value = 'La imagen no puede pesar más de 5MB'
      input.value = ''
      return
    }
    selectedFile.value = file
    imagePreview.value = URL.createObjectURL(file)
    modalError.value = ''
  }
}

// Modal actions
const openCreateModal = () => {
  editingSlide.value = null
  form.title = ''
  form.subtitle = ''
  form.button_text = 'Ver Catálogo'
  form.button_link = '#catalogo'
  form.is_active = true
  selectedFile.value = null
  imagePreview.value = null
  if (fileInput.value) fileInput.value.value = ''
  modalError.value = ''
  showModal.value = true
}

const openEditModal = (slide: HeroSlide) => {
  editingSlide.value = slide
  form.title = slide.title || ''
  form.subtitle = slide.subtitle || ''
  form.button_text = slide.button_text || ''
  form.button_link = slide.button_link || ''
  form.is_active = slide.is_active
  selectedFile.value = null
  imagePreview.value = getImageUrl(slide.image_url)
  if (fileInput.value) fileInput.value.value = ''
  modalError.value = ''
  showModal.value = true
}

const closeModal = () => {
  showModal.value = false
  editingSlide.value = null
}

const saveSlide = async () => {
  try {
    modalError.value = ''
    saving.value = true

    const formData = new FormData()
    formData.append('title', form.title)
    formData.append('subtitle', form.subtitle)
    formData.append('button_text', form.button_text)
    formData.append('button_link', form.button_link)
    formData.append('is_active', String(form.is_active))
    
    if (selectedFile.value) {
      formData.append('image', selectedFile.value)
    }

    let res
    if (editingSlide.value) {
      // Update
      if (!selectedFile.value && !imagePreview.value) {
        // Technically imagePreview exists if editing, unless they cleared it (not possible in UI yet)
      }
      res = await api.patch<{ ok: boolean }>(`/admin/hero/${editingSlide.value.id}`, formData)
    } else {
      // Create
      if (!selectedFile.value) {
        modalError.value = 'Debes subir una imagen para el nuevo banner'
        saving.value = false
        return
      }
      res = await api.post<{ ok: boolean }>(`/admin/hero`, formData)
    }

    if (res.ok) {
      await loadSlides()
      closeModal()
    } else {
      throw new Error('Error en la respuesta del servidor')
    }
  } catch (e: any) {
    modalError.value = 'Error al guardar: ' + (e.message || 'Error desconocido')
  } finally {
    saving.value = false
  }
}

const confirmDelete = async (slide: HeroSlide) => {
  if (!confirm('¿Estás seguro de eliminar este banner? Esta acción no se puede deshacer.')) return
  
  try {
    await api.delete(`/admin/hero/${slide.id}`)
    await loadSlides()
  } catch (e: any) {
    alert('Error al eliminar: ' + e.message)
  }
}

onMounted(() => {
  loadSlides()
})
</script>
