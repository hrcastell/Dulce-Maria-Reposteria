<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Header -->
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-900">
            Dashboard - Dulce María
          </h1>
          <button
            @click="handleLogout"
            class="text-sm text-red-600 hover:text-red-500"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    </header>

    <!-- Content -->
    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <!-- Welcome Message -->
        <div class="card mb-6">
          <h2 class="text-xl font-semibold mb-2">
            Bienvenido, {{ user?.email }}
          </h2>
          <p class="text-gray-600">
            Rol: <span class="font-medium">{{ user?.role }}</span>
          </p>
        </div>

        <!-- Quick Actions -->
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <!-- Productos -->
          <NuxtLink
            to="/dashboard/products"
            class="card hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <span class="text-4xl">🍰</span>
              </div>
              <div class="ml-4">
                <h3 class="text-lg font-semibold text-gray-900">Productos</h3>
                <p class="text-sm text-gray-600">Gestionar catálogo</p>
              </div>
            </div>
          </NuxtLink>

          <!-- Órdenes -->
          <NuxtLink
            to="/dashboard/orders"
            class="card hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <span class="text-4xl">📦</span>
              </div>
              <div class="ml-4">
                <h3 class="text-lg font-semibold text-gray-900">Órdenes</h3>
                <p class="text-sm text-gray-600">Ver y gestionar pedidos</p>
              </div>
            </div>
          </NuxtLink>

          <!-- Clientes -->
          <NuxtLink
            to="/dashboard/customers"
            class="card hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <span class="text-4xl">👥</span>
              </div>
              <div class="ml-4">
                <h3 class="text-lg font-semibold text-gray-900">Clientes</h3>
                <p class="text-sm text-gray-600">Gestionar clientes</p>
              </div>
            </div>
          </NuxtLink>

          <!-- Reportes -->
          <NuxtLink
            to="/dashboard/reports"
            class="card hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <span class="text-4xl">📊</span>
              </div>
              <div class="ml-4">
                <h3 class="text-lg font-semibold text-gray-900">Reportes</h3>
                <p class="text-sm text-gray-600">Ventas y estadísticas</p>
              </div>
            </div>
          </NuxtLink>

          <!-- Usuarios (solo para admin principal) -->
          <NuxtLink
            v-if="user?.email === 'hernan.castellanos@hrcastell.com'"
            to="/dashboard/users"
            class="card hover:shadow-lg transition-shadow cursor-pointer border-2 border-purple-200"
          >
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <span class="text-4xl">👤</span>
              </div>
              <div class="ml-4">
                <h3 class="text-lg font-semibold text-gray-900">Usuarios</h3>
                <p class="text-sm text-gray-600">Gestionar accesos y permisos</p>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const router = useRouter()

definePageMeta({
  middleware: 'auth'
})

useHead({
  title: 'Dashboard'
})

interface User {
  email: string
  role: string
}

const user = ref<User | null>(null)

onMounted(() => {
  // Obtener usuario de localStorage
  const userStr = localStorage.getItem('user')
  if (userStr) {
    user.value = JSON.parse(userStr)
  } else {
    // Si no hay usuario, redirigir al login
    router.push('/login')
  }
})

const handleLogout = () => {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('user')
  router.push('/login')
}
</script>
