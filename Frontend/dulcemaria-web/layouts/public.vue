<template>
  <!--
    Layout de las páginas públicas fuera del panel (index, catalog).
    Solo aporta el piso de alto y el fondo neutro del sistema — sin header ni nav.
    El ancho/gutter de cada página lo pone <PageContainer>.
  -->
  <div class="min-h-dvh bg-warm-50">
    <slot />
  </div>
</template>
