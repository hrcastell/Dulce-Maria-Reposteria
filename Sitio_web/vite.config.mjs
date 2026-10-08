export default {
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Docker (dev local únicamente): forzar polling para que el HMR de Vite
    // detecte cambios de archivo a través de un bind mount en Windows/WSL.
    watch: { usePolling: true, interval: 300 }
  }
}
