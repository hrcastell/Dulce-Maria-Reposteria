<template>
  <Teleport to="body">
    <!-- Overlay -->
    <Transition name="panel-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 bg-warm-900/50 backdrop-blur-sm"
        @click="close"
      ></div>
    </Transition>

    <!-- Panel -->
    <Transition name="panel-slide">
      <div
        v-if="modelValue"
        class="fixed inset-y-0 right-0 z-50 w-full sm:max-w-md bg-white shadow-soft-lg flex flex-col"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <!-- Header -->
        <div class="flex items-start justify-between gap-4 px-6 py-5 border-b border-warm-100 flex-shrink-0">
          <h3 class="text-lg font-semibold text-warm-800">
            {{ title }}
          </h3>
          <button
            type="button"
            class="text-warm-400 hover:text-warm-600 hover:bg-warm-50 rounded-lg p-1.5 transition-colors"
            aria-label="Cerrar"
            @click="close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Body (scrollable) -->
        <div class="flex-1 overflow-y-auto px-6 py-6">
          <slot></slot>
        </div>

        <!-- Footer -->
        <div class="flex-shrink-0 bg-warm-50 px-6 py-4 border-t border-warm-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            :disabled="loading"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-warm-100 text-warm-700 font-medium rounded-xl border border-warm-200 transition-all duration-200"
            @click="close"
          >
            Cancelar
          </button>
          <button
            v-if="!hideSubmit"
            type="button"
            :disabled="loading || disableSubmit"
            class="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200"
            @click="$emit('submit')"
          >
            <svg v-if="loading" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
            {{ submitText }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps({
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
  disableSubmit: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'submit'])

const close = () => {
  emit('update:modelValue', false)
}

// Evita el scroll del contenido de fondo mientras el panel está abierto
if (import.meta.client) {
  watch(() => props.modelValue, (isOpen) => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
  }, { immediate: true })

  onUnmounted(() => {
    document.body.style.overflow = ''
  })
}
</script>

<style scoped>
.panel-fade-enter-active,
.panel-fade-leave-active {
  transition: opacity 0.3s ease;
}

.panel-fade-enter-from,
.panel-fade-leave-to {
  opacity: 0;
}

.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: transform 0.3s ease;
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  transform: translateX(100%);
}
</style>
