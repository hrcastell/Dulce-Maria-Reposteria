<template>
  <div>
    <!-- Header -->
    <header class="bg-white shadow">
      <PageContainer class="py-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h1 class="text-2xl sm:text-3xl font-bold text-warm-800 min-w-0">
            🍰 Catálogo de Productos
          </h1>
          <NuxtLink to="/" class="text-sm text-primary-600 hover:text-primary-500 flex-shrink-0">
            ← Volver
          </NuxtLink>
        </div>
      </PageContainer>
    </header>

    <!-- Content -->
    <PageContainer as="main" class="py-6">
      <div v-if="loading" class="flex justify-center items-center py-12">
        <div class="text-warm-500">Cargando productos...</div>
      </div>

      <div v-else-if="error" class="rounded-xl bg-error-50 border border-error-100 p-4">
        <div class="flex">
          <div class="ml-3">
            <h3 class="text-sm font-medium text-error-700">
              Error al cargar productos: {{ error }}
            </h3>
          </div>
        </div>
      </div>

      <div v-else-if="products.length > 0">
        <div class="grid grid-cols-1 gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div
            v-for="product in products"
            :key="product.id"
            class="card hover:shadow-lg transition-shadow duration-200"
          >
            <!-- Product Image -->
            <div class="w-full h-48 bg-warm-100 rounded-lg mb-4 overflow-hidden flex items-center justify-center">
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
            <h3 class="text-lg font-semibold text-warm-800 mb-2">
              {{ product.name }}
            </h3>

            <p v-if="product.description" class="text-sm text-warm-600 mb-4 line-clamp-2">
              {{ product.description }}
            </p>

            <div class="flex justify-between items-center">
              <span class="text-2xl font-bold text-primary-600">
                ${{ formatPrice(product.price_clp) }}
              </span>
              <span
                v-if="product.stock_qty > 0"
                class="text-sm text-success-600"
              >
                Stock: {{ product.stock_qty }}
              </span>
              <span v-else class="text-sm text-error-600">
                Sin stock
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-12">
        <p class="text-warm-500">No hay productos disponibles en este momento.</p>
      </div>
    </PageContainer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

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
