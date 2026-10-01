import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: '0.0.0.0',
    // Dev proxies (same-origin for the frontend, no CORS):
    //   /api/sets -> python3 sets backend (:5199)
    //   /api/ai   -> K11 AI proxy (:5198)
    proxy: {
      '/api/sets': 'http://localhost:5199',
      '/api/ai': 'http://localhost:5198',
    },
  },
})
