import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // listen on 0.0.0.0 so LAN/mobile devices and tunnels (ngrok) can reach it
    allowedHosts: ['collected-dumpling-shrewdly.ngrok-free.dev'],
    proxy: {
      // Relays /api/* to the backend so the browser only ever talks to one origin
      // (whatever host/tunnel served the page) — avoids hardcoding localhost:5000,
      // which would be unreachable from a phone or through the ngrok tunnel.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
