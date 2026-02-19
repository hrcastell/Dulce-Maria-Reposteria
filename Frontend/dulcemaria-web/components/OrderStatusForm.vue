<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-md bg-red-50 p-4">
      <p class="text-sm text-red-800">{{ error }}</p>
    </div>

    <div>
      <label class="label">Estado de la Orden</label>
      <select v-model="form.status" required class="input">
        <option value="PENDING_PAYMENT">Pendiente Pago</option>
        <option value="PAID">Pagado</option>
        <option value="PREPARING">Preparando</option>
        <option value="READY">Listo</option>
        <option value="DELIVERED">Entregado</option>
        <option value="CANCELLED">Cancelado</option>
      </select>
    </div>

    <div>
      <label class="label">Estado de Pago</label>
      <select v-model="form.paymentStatus" required class="input">
        <option value="PENDING">Pendiente</option>
        <option value="PAID">Pagado</option>
        <option value="FAILED">Fallido</option>
        <option value="REFUNDED">Reembolsado</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  order?: any
}>()

const emit = defineEmits<{
  submit: [data: any]
}>()

const form = ref({
  status: props.order?.status || 'PENDING_PAYMENT',
  paymentStatus: props.order?.payment_status || 'PENDING'
})

const error = ref('')

const submit = () => {
  if (!form.value.status || !form.value.paymentStatus) {
    error.value = 'Todos los campos son requeridos'
    return
  }
  
  error.value = ''
  emit('submit', form.value)
}

defineExpose({ submit })
</script>
