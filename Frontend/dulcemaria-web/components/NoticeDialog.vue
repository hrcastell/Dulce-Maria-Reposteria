<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 overflow-y-auto"
        @click.self="close"
      >
        <div class="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
          <div class="fixed inset-0 transition-opacity bg-warm-900/50 backdrop-blur-sm" @click="close"></div>

          <div class="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-soft-lg transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
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
          </div>
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

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.modelValue) {
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
