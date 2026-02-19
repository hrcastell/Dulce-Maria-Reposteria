export default defineNuxtRouteMiddleware((to, from) => {
  // Solo ejecutar en el cliente
  if (process.client) {
    const token = localStorage.getItem('auth_token')
    
    if (!token) {
      return navigateTo('/login')
    }
  }
})
