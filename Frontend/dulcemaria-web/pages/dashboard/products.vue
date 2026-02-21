<template>
  <div>
    <!-- Page Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-warm-800">Productos</h1>
        <p class="mt-1 text-warm-500">Gestiona tu catálogo de productos</p>
      </div>
      <button
        @click="openCreateModal"
        class="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200 shadow-soft hover:shadow-md"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span>Nuevo Producto</span>
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex flex-col items-center justify-center py-16">
      <div class="w-12 h-12 border-4 border-primary-200 border-t-primary-500 rounded-full animate-spin"></div>
      <p class="mt-4 text-warm-500">Cargando productos...</p>
    </div>

    <div v-else-if="error" class="rounded-2xl bg-error-50 border border-error-100 p-6 mb-6">
      <div class="flex items-center gap-3">
        <span class="text-error-500 text-xl">⚠️</span>
        <p class="text-error-700">{{ error }}</p>
      </div>
    </div>

    <div v-else>
      <!-- Stats Bar -->
      <div class="flex items-center justify-between mb-6">
        <p class="text-sm text-warm-500">
          <span class="font-medium text-warm-700">{{ products.length }}</span> productos en total
        </p>
      </div>

      <!-- Empty State -->
      <div v-if="products.length === 0" class="text-center py-16 bg-white rounded-2xl shadow-soft border border-warm-100">
        <div class="w-20 h-20 bg-warm-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span class="text-4xl">🍰</span>
        </div>
        <h3 class="text-lg font-semibold text-warm-800 mb-2">No hay productos</h3>
        <p class="text-warm-500 mb-6">Comienza agregando tu primer producto al catálogo</p>
        <button
          @click="openCreateModal"
          class="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-xl transition-all duration-200"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Agregar Producto</span>
        </button>
      </div>

      <div v-else class="hidden sm:block bg-white rounded-2xl shadow-soft border border-warm-100 overflow-hidden">
        <table class="min-w-full divide-y divide-warm-100">
          <thead class="bg-warm-50">
            <tr>
              <th class="px-4 py-3 w-16"></th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Producto</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Precio</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Stock</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-warm-100">
            <tr v-for="product in products" :key="product.id" class="hover:bg-warm-50/50 transition-colors">
              <td class="px-4 py-3">
                <img
                  v-if="product.thumb_url"
                  :src="getImageUrl(product.thumb_url)"
                  :alt="product.name"
                  class="w-12 h-12 object-cover rounded-xl"
                  loading="lazy"
                >
                <div v-else class="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center text-xl">🍰</div>
              </td>
              <td class="px-4 py-3">
                <div class="text-sm font-medium text-warm-800">{{ product.name }}</div>
                <div class="text-sm text-warm-400">{{ product.slug }}</div>
              </td>
              <td class="px-4 py-3 text-sm font-medium text-warm-800">${{ formatPrice(product.price_clp) }}</td>
              <td class="px-4 py-3 text-sm text-warm-600">{{ product.stock_qty }}</td>
              <td class="px-4 py-3">
                <span
                  :class="product.is_active ? 'bg-success-100 text-success-700' : 'bg-error-100 text-error-700'"
                  class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                >
                  {{ product.is_active ? 'Activo' : 'Inactivo' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 mr-3 disabled:opacity-50 transition-colors"
                  :disabled="loadingProductId === product.id"
                  @click="openEditModal(product)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  {{ loadingProductId === product.id ? 'Cargando...' : 'Editar' }}
                </button>
                <button
                  class="inline-flex items-center gap-1 text-sm font-medium text-error-600 hover:text-error-700 transition-colors"
                  @click="openDeleteDialog(product)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                  Eliminar
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile Cards -->
      <div v-if="products.length > 0" class="sm:hidden space-y-3">
        <div v-for="product in products" :key="product.id" class="bg-white rounded-xl p-4 shadow-soft border border-warm-100">
          <div class="flex items-start gap-3">
            <img
              v-if="product.thumb_url"
              :src="getImageUrl(product.thumb_url)"
              :alt="product.name"
              class="w-16 h-16 object-cover rounded-xl flex-shrink-0"
              loading="lazy"
            >
            <div v-else class="w-16 h-16 bg-primary-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">🍰</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="font-semibold text-warm-800 truncate">{{ product.name }}</h3>
                  <p class="text-sm text-warm-400">{{ product.slug }}</p>
                </div>
                <span
                  :class="product.is_active ? 'bg-success-100 text-success-700' : 'bg-error-100 text-error-700'"
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                >
                  {{ product.is_active ? 'Activo' : 'Inactivo' }}
                </span>
              </div>
              <div class="flex items-center justify-between mt-3">
                <div class="text-sm">
                  <span class="text-warm-400">Precio:</span>
                  <span class="font-semibold text-warm-800 ml-1">${{ formatPrice(product.price_clp) }}</span>
                </div>
                <div class="text-sm">
                  <span class="text-warm-400">Stock:</span>
                  <span class="font-semibold text-warm-800 ml-1">{{ product.stock_qty }}</span>
                </div>
              </div>
              <div class="flex items-center gap-3 mt-3 pt-3 border-t border-warm-100">
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg transition-colors disabled:opacity-50"
                  :disabled="loadingProductId === product.id"
                  @click="openEditModal(product)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                  {{ loadingProductId === product.id ? 'Cargando...' : 'Editar' }}
                </button>
                <button
                  class="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-error-600 bg-error-50 hover:bg-error-100 rounded-lg transition-colors"
                  @click="openDeleteDialog(product)"
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

    <!-- Create Product Modal -->
    <Modal
      v-model="showCreateModal"
      title="Nuevo Producto"
      :loading="saving"
      @submit="handleCreateProduct"
    >
      <ProductForm ref="productFormRef" @submit="handleSubmitProduct" />
    </Modal>

    <!-- Edit Product Modal -->
    <Modal
      v-model="showEditModal"
      title="Editar Producto"
      :loading="saving"
      @submit="handleEditProduct"
    >
      <ProductForm ref="editFormRef" :product="selectedProduct" @submit="handleUpdateProduct" />
    </Modal>

    <!-- Delete Confirmation -->
    <ConfirmDialog
      v-model="showDeleteDialog"
      title="Eliminar Producto"
      :message="`¿Estás seguro de que deseas eliminar ${productToDelete?.name}? Esta acción no se puede deshacer.`"
      :loading="deleting"
      @confirm="handleDeleteProduct"
    />
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth'
})

useHead({
  title: 'Productos | Dulce María'
})

const api = useApi()
const config = useRuntimeConfig()

interface Product {
  id: string
  name: string
  slug: string
  description?: string
  price_clp: number
  stock_qty: number
  is_active: boolean
  thumb_url?: string
  images?: any[]
}

const products = ref<Product[]>([])
const loading = ref(true)
const error = ref('')
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteDialog = ref(false)
const saving = ref(false)
const deleting = ref(false)
const productFormRef = ref<any>(null)
const loadingProductId = ref<string | null>(null)
const editFormRef = ref<any>(null)
const selectedProduct = ref<Product | null>(null)
const productToDelete = ref<Product | null>(null)

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const getImageUrl = (url: string) => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${config.public.apiBase}${url}`
}

const loadProducts = async () => {
  try {
    loading.value = true
    error.value = ''

    const response = await api.get<{ ok: boolean; items: Product[] }>('/admin/products')

    if (response.ok && response.items) {
      products.value = response.items
    }
  } catch (e: any) {
    console.error('Error loading products:', e)
    error.value = e?.data?.error || 'Error al cargar los productos'
  } finally {
    loading.value = false
  }
}

const openCreateModal = () => {
  showCreateModal.value = true
}

const loadProductImages = async (productId: string): Promise<any[]> => {
  try {
    const response = await api.get<{ ok: boolean; items: any[] }>(`/admin/products/${productId}/images`)
    return response.ok ? response.items : []
  } catch {
    return []
  }
}

const handleCreateProduct = () => {
  productFormRef.value?.submit()
}

const handleSubmitProduct = async (data: any) => {
  try {
    saving.value = true
    error.value = ''

    const response = await api.post<{ ok: boolean; product: Product }>('/admin/products', data)

    if (response.ok && response.product) {
      const images = productFormRef.value?.getImages() || []
      if (images.length > 0) {
        await uploadProductImages(response.product.id, images)
      }
      await loadProducts()
      showCreateModal.value = false
    }
  } catch (e: any) {
    console.error('Error creating product:', e)
    error.value = e?.data?.error || 'Error al crear el producto'
  } finally {
    saving.value = false
  }
}

const openEditModal = async (product: Product) => {
  selectedProduct.value = null
  loadingProductId.value = product.id
  try {
    const images = await loadProductImages(product.id)
    selectedProduct.value = { ...product, images }
    showEditModal.value = true
  } finally {
    loadingProductId.value = null
  }
}

const handleEditProduct = () => {
  editFormRef.value?.submit()
}

const handleUpdateProduct = async (data: any) => {
  if (!selectedProduct.value) return

  try {
    saving.value = true
    error.value = ''

    const response = await api.patch<{ ok: boolean; product: Product }>(
      `/admin/products/${selectedProduct.value.id}`,
      data
    )

    if (response.ok) {
      const images: any[] = editFormRef.value?.getImages() || []
      const newImages = images.filter((img: any) => img.file && !img.id)
      if (newImages.length > 0 && selectedProduct.value) {
        await uploadProductImages(selectedProduct.value.id, newImages)
      }
      await loadProducts()
      showEditModal.value = false
      selectedProduct.value = null
    }
  } catch (e: any) {
    console.error('Error updating product:', e)
    error.value = e?.data?.error || 'Error al actualizar el producto'
  } finally {
    saving.value = false
  }
}

const openDeleteDialog = (product: Product) => {
  productToDelete.value = product
  showDeleteDialog.value = true
}

const handleDeleteProduct = async () => {
  if (!productToDelete.value) return

  try {
    deleting.value = true
    error.value = ''

    await api.delete(`/admin/products/${productToDelete.value.id}`)

    products.value = products.value.filter(p => p.id !== productToDelete.value?.id)
    showDeleteDialog.value = false
    productToDelete.value = null
  } catch (e: any) {
    console.error('Error deleting product:', e)
    error.value = e?.data?.error || 'Error al eliminar el producto'
  } finally {
    deleting.value = false
  }
}

const uploadProductImages = async (productId: string, images: any[]) => {
  const newImages = images.filter((img: any) => img.file)
  if (newImages.length === 0) return

  try {
    const formData = new FormData()
    for (const img of newImages) {
      formData.append('images', img.file)
    }

    await api.post(`/admin/products/${productId}/images`, formData)
  } catch (e: any) {
    console.error('Error uploading images:', e)
  }
}

onMounted(() => {
  loadProducts()
})
</script>
