export const useApi = () => {
  const config = useRuntimeConfig()
  const router = useRouter()

  const getToken = () => {
    if (process.client) {
      return localStorage.getItem('auth_token')
    }
    return null
  }

  const apiRequest = async <T>(endpoint: string, options: any = {}): Promise<T> => {
    const token = getToken()

    if (!token && !options.skipAuth) {
      router.push('/login')
      throw new Error('No authentication token')
    }

    const isFormData = options.body instanceof FormData

    const headers: any = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers
    }

    if (token && !options.skipAuth) {
      headers.Authorization = `Bearer ${token}`
    }

    try {
      const response = await $fetch<T>(`${config.public.apiBase}${endpoint}`, {
        ...options,
        headers
      })

      return response
    } catch (error: any) {
      // Si el error es 401 (no autorizado), redirigir al login
      if (error?.response?.status === 401) {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('user')
        router.push('/login')
      }
      throw error
    }
  }

  return {
    get: <T>(endpoint: string, options?: any) =>
      apiRequest<T>(endpoint, { ...options, method: 'GET' }),
    
    post: <T>(endpoint: string, body: any, options?: any) =>
      apiRequest<T>(endpoint, { ...options, method: 'POST', body }),
    
    patch: <T>(endpoint: string, body: any, options?: any) =>
      apiRequest<T>(endpoint, { ...options, method: 'PATCH', body }),
    
    put: <T>(endpoint: string, body: any, options?: any) =>
      apiRequest<T>(endpoint, { ...options, method: 'PUT', body }),
    
    delete: <T>(endpoint: string, options?: any) =>
      apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
  }
}
