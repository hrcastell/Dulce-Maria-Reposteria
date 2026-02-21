<template>
  <div class="min-h-screen bg-warm-50">
    <!-- Mobile Header -->
    <header class="lg:hidden bg-white shadow-soft sticky top-0 z-40">
      <div class="flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="text-2xl">🍰</span>
          <span class="font-semibold text-warm-800">Dulce María</span>
        </div>
        <button
          @click="mobileMenuOpen = !mobileMenuOpen"
          class="p-2 rounded-lg text-warm-600 hover:bg-warm-100 transition-colors"
          aria-label="Toggle menu"
        >
          <svg v-if="!mobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
          <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Mobile Navigation Menu -->
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 -translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 -translate-y-2"
      >
        <nav v-if="mobileMenuOpen" class="border-t border-warm-100 px-4 py-3 space-y-1">
          <NuxtLink
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            @click="mobileMenuOpen = false"
            :class="[
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
              isActive(item.path)
                ? 'bg-primary-50 text-primary-600 shadow-sm'
                : 'text-warm-600 hover:bg-warm-50 hover:text-warm-800'
            ]"
          >
            <span class="text-lg">{{ item.icon }}</span>
            {{ item.label }}
          </NuxtLink>

          <div class="border-t border-warm-100 my-2"></div>

          <button
            @click="handleLogout"
            class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-error-600 hover:bg-error-50 transition-all duration-200 w-full"
          >
            <span class="text-lg">🚪</span>
            Cerrar Sesión
          </button>
        </nav>
      </Transition>
    </header>

    <div class="flex min-h-[calc(100vh-64px)] lg:min-h-screen">
      <!-- Desktop Sidebar -->
      <aside class="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white shadow-soft-lg">
        <!-- Logo -->
        <div class="flex items-center gap-3 px-6 py-5 border-b border-warm-100">
          <span class="text-3xl">🍰</span>
          <div>
            <h1 class="font-bold text-warm-800 text-lg">Dulce María</h1>
            <p class="text-xs text-warm-500">Portal Admin</p>
          </div>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          <NuxtLink
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            :class="[
              'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
              isActive(item.path)
                ? 'bg-primary-50 text-primary-600 shadow-soft'
                : 'text-warm-600 hover:bg-warm-50 hover:text-warm-800'
            ]"
          >
            <span class="text-xl">{{ item.icon }}</span>
            {{ item.label }}
          </NuxtLink>
        </nav>

        <!-- User Info & Logout -->
        <div class="border-t border-warm-100 p-4">
          <div class="flex items-center gap-3 mb-3 px-2">
            <div class="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg">
              👤
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-warm-800 truncate">{{ user?.email || 'Usuario' }}</p>
              <p class="text-xs text-warm-500 capitalize">{{ user?.role || 'Admin' }}</p>
            </div>
          </div>
          <button
            @click="handleLogout"
            class="flex items-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-medium text-error-600 hover:bg-error-50 transition-all duration-200"
          >
            <span>🚪</span>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 lg:ml-64">
        <div class="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const router = useRouter()
const route = useRoute()

const mobileMenuOpen = ref(false)

interface User {
  email: string
  role: string
}

const user = ref<User | null>(null)

onMounted(() => {
  const userStr = localStorage.getItem('user')
  if (userStr) {
    user.value = JSON.parse(userStr)
  }
})

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/dashboard/orders', label: 'Órdenes', icon: '📦' },
  { path: '/dashboard/products', label: 'Productos', icon: '🍰' },
  { path: '/dashboard/customers', label: 'Clientes', icon: '👥' },
  { path: '/dashboard/supplies', label: 'Insumos', icon: '🧂' },
  { path: '/dashboard/cake-builder', label: 'Tortas', icon: '🎂' },
  { path: '/dashboard/reports', label: 'Reportes', icon: '📈' },
]

// Add users link only for admin
if (user.value?.email === 'hernan.castellanos@hrcastell.com' || user.value?.role === 'GOD') {
  navItems.push({ path: '/dashboard/users', label: 'Usuarios', icon: '🔐' })
}

const isActive = (path: string) => {
  if (path === '/dashboard') {
    return route.path === '/dashboard'
  }
  return route.path.startsWith(path)
}

const handleLogout = () => {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('user')
  router.push('/login')
}
</script>
