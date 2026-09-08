import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend API port for dev proxy. Override: VITE_API_PROXY_TARGET=http://127.0.0.1:8002
// Default 8001 matches the documented backend port (README / CLAUDE.md);
// 8002 belongs to another project on this machine.
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:8001'

export default defineConfig(() => {
  return {
    plugins: [react()],
    server: {
      // Default 5176 so we do not collide with other local Vite apps on 5173/5174/5175
      port: 5176,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
