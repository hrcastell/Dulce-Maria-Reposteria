<template>
  <!--
    Grilla de cards responsiva estándar del panel.
    variant 'card' → listados/catálogo (1 → 2 → 3 → 4 columnas)
    variant 'stat' → tiles de métricas (2 → 3 → 4 columnas)
  -->
  <div :class="gridClass">
    <slot />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  // 'card' | 'stat'
  variant: {
    type: String,
    default: 'card'
  }
})

const gridClass = computed(() =>
  props.variant === 'stat'
    ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
    : 'grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4'
)
</script>
