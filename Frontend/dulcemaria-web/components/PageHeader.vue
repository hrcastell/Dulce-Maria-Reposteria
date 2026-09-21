<template>
  <!--
    Encabezado de página estándar. Apila título y acciones en mobile y pasa a
    fila en sm+. Reemplaza los encabezados ad-hoc de cada página del panel.
  -->
  <div>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-bold text-warm-800 sm:text-2xl truncate">{{ title }}</h1>
        <p v-if="description" class="text-sm text-warm-500 mt-1">{{ description }}</p>
      </div>
      <!-- Acciones (botones) alineadas a la derecha en sm+, envuelven si no caben -->
      <div v-if="hasActions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <!-- Fila inferior opcional para filtros / tabs -->
    <div v-if="hasExtra" class="mt-3">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Comment } from 'vue'

defineProps({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  }
})

// $slots.actions/$slots.default son "truthy" aunque el contenido sea un v-if
// falso (que produce un nodo Comment). Comprobamos que el slot renderice al
// menos un nodo real para no dejar un contenedor flex vacío que sume gap
// muerto junto al título.
const slots = useSlots()
const hasRealContent = (name: 'actions' | 'default') => {
  const nodes = slots[name]?.()
  return !!nodes?.some((n) => n.type !== Comment)
}
const hasActions = computed(() => hasRealContent('actions'))
const hasExtra = computed(() => hasRealContent('default'))
</script>
