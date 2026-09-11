<template>
  <!--
    Wrapper fino sobre <DialogShell>. API pública SIN cambios: props
    modelValue/title/submitText/loading/hideSubmit, emits update:modelValue/submit,
    slot default. Prop aditiva `dismissible` (default FALSE): este modal envuelve
    formularios, así que por defecto NO se cierra por clic en backdrop ni Esc
    (evita perder datos a medio cargar) — se mantiene el comportamiento previo:
    solo cierra por el botón Cancelar. Pasar :dismissible="true" para permitir
    descarte por backdrop/Esc en usos sin formulario.
  -->
  <DialogShell
    :open="modelValue"
    :title="title"
    :dismissible="dismissible"
    :size="size"
    @close="close"
  >
    <div class="bg-white px-6 py-6">
      <div class="flex items-start">
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-warm-800">
            {{ title }}
          </h3>
          <div class="mt-2">
            <slot></slot>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="bg-warm-50 px-6 py-4 flex flex-col sm:flex-row-reverse gap-3">
        <button
          v-if="!hideSubmit"
          type="button"
          :disabled="loading"
          class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200"
          @click="$emit('submit')"
        >
          <svg v-if="loading" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          {{ submitText }}
        </button>
        <button
          type="button"
          :disabled="loading"
          class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-warm-100 text-warm-700 font-medium rounded-xl border border-warm-200 transition-all duration-200"
          @click="close"
        >
          Cancelar
        </button>
      </div>
    </template>
  </DialogShell>
</template>

<script setup lang="ts">
defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  submitText: {
    type: String,
    default: 'Guardar'
  },
  loading: {
    type: Boolean,
    default: false
  },
  hideSubmit: {
    type: Boolean,
    default: false
  },
  dismissible: {
    type: Boolean,
    default: false
  },
  // Ancho del diálogo: 'sm' | 'md' | 'lg' | 'xl' (pasa a DialogShell)
  size: {
    type: String,
    default: 'lg'
  }
})

const emit = defineEmits(['update:modelValue', 'submit'])

const close = () => {
  emit('update:modelValue', false)
}
</script>
