<template>
  <!--
    Wrapper fino sobre <DialogShell>. API pública SIN cambios: props
    modelValue/variant/title/message/closeText, emit update:modelValue.
    El cierre por Esc (que antes gestionaba este componente) y por backdrop
    ahora lo provee DialogShell.
  -->
  <DialogShell
    :open="modelValue"
    :title="title || defaultTitle"
    size="lg"
    @close="close"
  >
    <div class="bg-white px-6 py-6">
      <div class="flex items-start gap-4">
        <div
          class="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center"
          :class="variant === 'success' ? 'bg-success-100' : 'bg-error-100'"
        >
          <svg
            v-if="variant === 'success'"
            class="h-6 w-6 text-success-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <svg
            v-else
            class="h-6 w-6 text-error-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-warm-800">
            {{ title || defaultTitle }}
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
      <div class="bg-warm-50 px-6 py-4 flex justify-end">
        <button
          type="button"
          class="px-4 py-2 rounded-xl font-medium text-white transition-all duration-200"
          :class="variant === 'success' ? 'bg-success-500 hover:bg-success-600' : 'bg-error-500 hover:bg-error-600'"
          @click="close"
        >
          {{ closeText }}
        </button>
      </div>
    </template>
  </DialogShell>
</template>

<script setup lang="ts">
const props = defineProps({
  modelValue: {
    type: Boolean,
    required: true
  },
  variant: {
    type: String as () => 'success' | 'error',
    default: 'success'
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    required: true
  },
  closeText: {
    type: String,
    default: 'Entendido'
  }
})

const emit = defineEmits(['update:modelValue'])

const defaultTitle = computed(() => (props.variant === 'success' ? '¡Listo!' : 'Ocurrió un error'))

const close = () => {
  emit('update:modelValue', false)
}
</script>
