<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-md bg-red-50 p-4">
      <p class="text-sm text-red-800">{{ error }}</p>
    </div>

    <div>
      <label class="label">Nombre Completo *</label>
      <input
        v-model="form.full_name"
        type="text"
        required
        class="input"
        placeholder="Ej: María González"
      >
    </div>

    <div>
      <label class="label">Email</label>
      <input
        v-model="form.email"
        type="email"
        class="input"
        placeholder="maria@example.com"
      >
      <p class="text-xs text-gray-500 mt-1">Opcional - puede quedar vacío</p>
    </div>

    <div>
      <label class="label">Teléfono</label>
      <input
        v-model="form.phone"
        type="tel"
        class="input"
        placeholder="+56912345678"
      >
    </div>

    <div>
      <label class="label">Dirección</label>
      <textarea
        v-model="form.address"
        rows="2"
        class="input"
        placeholder="Dirección de entrega"
      ></textarea>
    </div>

    <div>
      <label class="label">Notas</label>
      <textarea
        v-model="form.notes"
        rows="2"
        class="input"
        placeholder="Notas adicionales sobre el cliente"
      ></textarea>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  customer?: any
}>()

const emit = defineEmits<{
  submit: [data: any]
  error: [error: string]
}>()

const form = ref({
  full_name: props.customer?.full_name || '',
  email: props.customer?.email || '',
  phone: props.customer?.phone || '',
  address: props.customer?.address || '',
  notes: props.customer?.notes || ''
})

const error = ref('')

const validate = () => {
  if (!form.value.full_name.trim()) {
    error.value = 'El nombre completo es requerido'
    return false
  }
  
  // Validar email si está presente
  if (form.value.email && form.value.email.trim()) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.value.email)) {
      error.value = 'El email no es válido'
      return false
    }
  }
  
  error.value = ''
  return true
}

const submit = () => {
  if (validate()) {
    // Enviar solo campos no vacíos en camelCase
    const data: any = {
      fullName: form.value.full_name
    }
    
    if (form.value.email && form.value.email.trim()) {
      data.email = form.value.email
    }
    if (form.value.phone && form.value.phone.trim()) {
      data.phone = form.value.phone
    }
    if (form.value.address && form.value.address.trim()) {
      data.address = form.value.address
    }
    if (form.value.notes && form.value.notes.trim()) {
      data.notes = form.value.notes
    }
    
    emit('submit', data)
  }
}

defineExpose({ submit })
</script>
