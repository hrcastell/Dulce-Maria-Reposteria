<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-5xl font-bold text-primary-600 mb-4">
        🍰 Dulce María Repostería
      </h1>
      <p class="text-xl text-gray-600 mb-8">
        Sistema de Gestión
      </p>
      <div class="space-x-4">
        <NuxtLink to="/login" class="btn-primary inline-block">
          Iniciar Sesión
        </NuxtLink>
        <NuxtLink to="/catalog" class="btn-secondary inline-block">
          Ver Catálogo
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({
  title: 'Inicio'
})
</script>
