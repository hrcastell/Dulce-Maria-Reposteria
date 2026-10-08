export default defineNuxtRouteMiddleware(async () => {
  if (!process.client) return

  const config = useRuntimeConfig()
  try {
    const response: any = await $fetch(`${config.public.apiBase}/auth/me`, {
      credentials: 'include'
    })
    if (response?.user) {
      localStorage.setItem('user', JSON.stringify(response.user))
      localStorage.removeItem('auth_token')
    }
  } catch {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user')
    return navigateTo('/login')
  }
})
