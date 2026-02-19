<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">Productos</h1>
          <NuxtLink to="/dashboard" class="text-sm text-primary-600 hover:text-primary-500">
            ← Dashboard
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <div v-if="loading" class="text-center py-12">
          <p class="text-gray-500">Cargando productos...</p>
        </div>

        <div v-else-if="error" class="rounded-md bg-red-50 p-4 mb-4">
          <p class="text-sm text-red-800">{{ error }}</p>
        </div>

        <div v-else>
          <div class="mb-4 flex justify-between items-center">
            <p class="text-sm text-gray-600">
              Total: {{ products.length }} productos
            </p>
            <button class="btn-primary text-sm" @click="openCreateModal">
              + Nuevo Producto
            </button>
          </div>

          <div v-if="products.length === 0" class="text-center py-12">
            <p class="text-gray-500">No hay productos registrados</p>
          </div>

          <div v-else class="bg-white shadow overflow-hidden sm:rounded-lg">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 w-16"></th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Producto
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Precio
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stock
                  </th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Estado
                  </th>
                  <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr v-for="product in products" :key="product.id">
                  <td class="px-4 py-2">
                    <img
                      v-if="product.thumb_url"
                      :src="getImageUrl(product.thumb_url)"
                      :alt="product.name"
                      class="w-12 h-12 object-cover rounded-lg"
                      loading="lazy"
                    >
                    <div v-else class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-xl">🍰</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">{{ product.name }}</div>
                    <div class="text-sm text-gray-500">{{ product.slug }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">${{ formatPrice(product.price_clp) }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">{{ product.stock_qty }}</div>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap">
                    <span
                      :class="product.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
                      class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                    >
                      {{ product.is_active ? 'Activo' : 'Inactivo' }}
                    </span>
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      class="text-primary-600 hover:text-primary-900 mr-3 disabled:opacity-50"
                      :disabled="loadingImages"
                      @click="openEditModal(product)"
                    >
                      {{ loadingImages ? 'Cargando...' : 'Editar' }}
                    </button>
                    <button 
                      class="text-red-600 hover:text-red-900"
                      @click="openDeleteDialog(product)"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>

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
const api = useApi()

definePageMeta({
  middleware: 'auth'
})

useHead({
  title: 'Productos'
})

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
const loadingImages = ref(false)
const editFormRef = ref<any>(null)
const selectedProduct = ref<Product | null>(null)
const productToDelete = ref<Product | null>(null)

const config = useRuntimeConfig()

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
      // Subir imágenes si existen
      const images = productFormRef.value?.getImages() || []
      if (images.length > 0) {
        await uploadProductImages(response.product.id, images)
      }
      
      // Recargar productos para obtener las imágenes
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
  loadingImages.value = true
  try {
    const images = await loadProductImages(product.id)
    selectedProduct.value = { ...product, images }
    showEditModal.value = true
  } finally {
    loadingImages.value = false
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
    
    if (response.ok && response.product) {
      // Subir nuevas imágenes si existen
      const images = editFormRef.value?.getImages() || []
      const newImages = images.filter((img: any) => img.file && !img.id)
      if (newImages.length > 0) {
        await uploadProductImages(selectedProduct.value.id, newImages)
      }
      
      // Recargar productos para obtener las imágenes actualizadas
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
