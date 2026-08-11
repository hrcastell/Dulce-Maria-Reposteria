// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  ssr: false,

  modules: [
    '@nuxtjs/tailwindcss'
  ],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      apiBase: 'https://api.dulcemaria.hrcastell.com'
    }
  },

  // Docker (dev local únicamente): bind mounts en Windows/WSL no siempre
  // emiten eventos inotify, así que forzamos polling para que el HMR de
  // Nuxt/Vite detecte cambios de archivo dentro del contenedor.
  vite: {
    server: {
      watch: { usePolling: true, interval: 300 },
    },
  },

  app: {
    baseURL: '/',
    head: {
      title: 'Dulce María Repostería',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Sistema de gestión para Dulce María Repostería' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }
      ]
    }
  }
})
