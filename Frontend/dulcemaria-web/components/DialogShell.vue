<script lang="ts">
// Bloqueo de scroll del <body> con recuento de referencias — así varios
// diálogos (o un SidePanel + un NoticeDialog) apilados no se pisan al cerrarse.
// Mismo mecanismo base que SidePanel.vue (document.body.style.overflow), pero
// compartido entre todas las instancias de DialogShell.
let _lockCount = 0
let _prevOverflow = ''

function lockBodyScroll() {
  if (!import.meta.client) return
  if (_lockCount === 0) {
    _prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  _lockCount++
}

function unlockBodyScroll() {
  if (!import.meta.client) return
  if (_lockCount === 0) return
  _lockCount--
  if (_lockCount === 0) {
    document.body.style.overflow = _prevOverflow
  }
}
</script>

<script setup lang="ts">
// Shell compartido de los modales del panel (Modal / ConfirmDialog / NoticeDialog).
// - Ancho fijo en TODOS los breakpoints (w-full + max-w-*), nunca solo en sm+ → sin
//   scroll horizontal dentro del modal en mobile (F-05).
// - Bottom-sheet en mobile (items-end), centrado en sm+ (items-center).
// - Cierre uniforme: backdrop + Esc (si dismissible) → emit('close') (F-12).
// - Scroll-lock de <body> con recuento de referencias.
const props = defineProps({
  open: {
    type: Boolean,
    default: false
  },
  // 'sm' | 'md' | 'lg'
  size: {
    type: String,
    default: 'lg'
  },
  // Permite cerrar por clic en backdrop / tecla Esc
  dismissible: {
    type: Boolean,
    default: true
  },
  // Solo para aria-label del diálogo (el título visible lo pone cada modal)
  title: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close'])

const sizeClass = computed(() => {
  if (props.size === 'sm') return 'max-w-sm'
  if (props.size === 'md') return 'max-w-md'
  if (props.size === 'xl') return 'max-w-2xl'
  return 'max-w-lg'
})

const requestClose = () => {
  if (props.dismissible !== false) emit('close')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.open && props.dismissible !== false) {
    emit('close')
  }
}

// Idempotente por instancia: evita doble unlock si el componente se desmonta
// mientras está abierto.
let locked = false
const applyLock = () => {
  if (!locked) {
    locked = true
    lockBodyScroll()
  }
}
const releaseLock = () => {
  if (locked) {
    locked = false
    unlockBodyScroll()
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) applyLock()
    else releaseLock()
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  releaseLock()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="open"
        class="fixed inset-0 z-50 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
      >
        <!-- Backdrop -->
        <div
          class="fixed inset-0 bg-warm-900/50 backdrop-blur-sm"
          @click="requestClose"
        ></div>

        <!-- Wrapper de posición: bottom-sheet en mobile, centrado en sm+ -->
        <div
          class="relative flex min-h-dvh items-end justify-center p-4 sm:items-center"
          @click.self="requestClose"
        >
          <!-- Caja: ancho fijo en todos los breakpoints -->
          <div
            class="dialog-box flex w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-soft-lg max-h-[90vh]"
            :class="sizeClass"
          >
            <div v-if="$slots.title" class="flex-shrink-0">
              <slot name="title" />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <slot />
            </div>

            <div v-if="$slots.footer" class="flex-shrink-0">
              <slot name="footer" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-active .dialog-box,
.dialog-leave-active .dialog-box {
  transition: transform 0.2s ease;
}

.dialog-enter-from .dialog-box,
.dialog-leave-to .dialog-box {
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active,
  .dialog-leave-active,
  .dialog-enter-active .dialog-box,
  .dialog-leave-active .dialog-box {
    transition: none;
  }

  .dialog-enter-from .dialog-box,
  .dialog-leave-to .dialog-box {
    transform: none;
  }
}
</style>
