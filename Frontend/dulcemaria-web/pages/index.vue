<template>
  <PageContainer>
    <div class="text-center py-12 sm:py-16">
      <h1 class="text-2xl sm:text-4xl font-bold text-primary-600 mb-4">
        🍰 Dulce María Repostería
      </h1>
      <p class="text-xl text-warm-600 mb-8">
        Sistema de Gestión
      </p>
      <div class="flex flex-wrap justify-center gap-3">
        <NuxtLink to="/login" class="btn-primary">
          Iniciar Sesión
        </NuxtLink>
        <NuxtLink to="/catalog" class="btn-secondary">
          Ver Catálogo
        </NuxtLink>
      </div>
    </div>
  </PageContainer>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

useHead({
  title: 'Inicio'
})
</script>
