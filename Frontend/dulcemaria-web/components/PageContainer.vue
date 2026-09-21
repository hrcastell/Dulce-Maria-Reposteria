<template>
  <!--
    Molde único de página del panel: centraliza el ancho máximo y el gutter
    lateral. Las páginas NO deben volver a declarar max-w-*, mx-auto ni px-*
    de nivel raíz — todo eso vive acá.
  -->
  <component
    :is="as"
    class="mx-auto w-full"
    :class="[widthClass, gutter ? 'px-4 sm:px-6 lg:px-8' : '']"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
const props = defineProps({
  // Etiqueta raíz a renderizar (div, main, section, ...)
  as: {
    type: String,
    default: 'div'
  },
  // 'default' → ancho estándar del panel · 'narrow' → formularios/detalle · 'full' → sin límite
  width: {
    type: String,
    default: 'default'
  },
  // Aplica el gutter lateral estándar (px-4 sm:px-6 lg:px-8)
  gutter: {
    type: Boolean,
    default: true
  }
})

const widthClass = computed(() => {
  if (props.width === 'narrow') return 'max-w-3xl'
  if (props.width === 'full') return 'max-w-none'
  return 'max-w-7xl'
})
</script>
