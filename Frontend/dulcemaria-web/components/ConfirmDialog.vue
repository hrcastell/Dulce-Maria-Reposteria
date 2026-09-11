<template>
  <!--
    Wrapper fino sobre <DialogShell>. API pública SIN cambios: props
    modelValue/title/message/confirmText/loading, emits update:modelValue/confirm.
    El backdrop y Esc cierran (dismissible por defecto en DialogShell) — igual que
    antes para el backdrop; Esc ahora también cierra (solo cierra, no confirma).
  -->
  <DialogShell
    :open="modelValue"
    :title="title"
    size="lg"
    @close="close"
  >
    <div class="bg-white px-6 py-6">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0 w-12 h-12 rounded-full bg-error-100 flex items-center justify-center">
          <svg class="h-6 w-6 text-error-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-warm-800">
            {{ title }}
          </h3>
          <div class="mt-2">
            <p class="text-sm text-warm-500">
              {{ message }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="bg-warm-50 px-6 py-4 flex flex-col sm:flex-row-reverse gap-3">
        <button
          type="button"
          :disabled="loading"
          class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-error-500 hover:bg-error-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200"
          @click="confirm"
        >
          <svg v-if="loading" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          {{ confirmText }}
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
    default: 'Confirmar eliminación'
  },
  message: {
    type: String,
    default: '¿Estás seguro de que deseas eliminar este elemento? Esta acción no se puede deshacer.'
  },
  confirmText: {
    type: String,
    default: 'Eliminar'
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const close = () => {
  emit('update:modelValue', false)
}

const confirm = () => {
  emit('confirm')
}
</script>
