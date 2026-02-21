<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Header -->
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-3xl font-bold text-gray-900">
            🍰 Catálogo de Productos
          </h1>
          <NuxtLink to="/" class="text-sm text-primary-600 hover:text-primary-500">
            ← Volver
          </NuxtLink>
        </div>
      </div>
    </header>

    <!-- Content -->
    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div v-if="loading" class="flex justify-center items-center py-12">
        <div class="text-gray-500">Cargando productos...</div>
      </div>

      <div v-else-if="error" class="rounded-md bg-red-50 p-4 mx-4">
        <div class="flex">
          <div class="ml-3">
            <h3 class="text-sm font-medium text-red-800">
              Error al cargar productos: {{ error }}
            </h3>
          </div>
        </div>
      </div>

      <div v-else-if="products.length > 0" class="px-4 py-6">
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div
            v-for="product in products"
            :key="product.id"
            class="card hover:shadow-lg transition-shadow duration-200"
          >
            <!-- Product Image -->
            <div class="w-full h-48 bg-gray-100 rounded-lg mb-4 overflow-hidden flex items-center justify-center">
              <img
                v-if="product.thumb_url"
                :src="getImageUrl(product.thumb_url)"
                :alt="product.name"
                class="w-full h-full object-cover"
                loading="lazy"
              >
              <span v-else class="text-6xl">🍰</span>
            </div>

            <!-- Product Info -->
            <h3 class="text-lg font-semibold text-gray-900 mb-2">
              {{ product.name }}
            </h3>
            
            <p v-if="product.description" class="text-sm text-gray-600 mb-4 line-clamp-2">
              {{ product.description }}
            </p>

            <div class="flex justify-between items-center">
              <span class="text-2xl font-bold text-primary-600">
                ${{ formatPrice(product.price_clp) }}
              </span>
              <span
                v-if="product.stock_qty > 0"
                class="text-sm text-green-600"
              >
                Stock: {{ product.stock_qty }}
              </span>
              <span v-else class="text-sm text-red-600">
                Sin stock
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-12">
        <p class="text-gray-500">No hay productos disponibles en este momento.</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig()

useHead({
  title: 'Catálogo de Productos'
})

interface Product {
  id: string
  name: string
  description?: string
  price_clp: number
  stock_qty: number
  is_active: boolean
  thumb_url?: string
}

const products = ref<Product[]>([])
const loading = ref(true)
const error = ref('')

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('es-CL').format(price)
}

const getImageUrl = (url: string) => {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return `${config.public.apiBase}${url}`
}

// Cargar productos del catálogo público
const loadProducts = async () => {
  try {
    loading.value = true
    error.value = ''
    
    const response = await $fetch<{ ok: boolean; items: Product[] }>(
      `${config.public.apiBase}/catalog/products`
    )
    
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

// Cargar productos al montar el componente
onMounted(() => {
  loadProducts()
})
</script>
