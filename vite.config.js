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
      '/api/auth': 'http://localhost:5199',
      '/api/me': 'http://localhost:5199',
      // K20/K18: leaderboard + my-sets routes live on the :5199 backend but
      // were missing from the dev proxy, so these calls fell through to the
      // Vite SPA server (index.html/404) instead of the real endpoint.
      '/api/leaderboard': 'http://localhost:5199',
      '/api/my/sets': 'http://localhost:5199',
      '/api/ai': 'http://localhost:5198',
    },
  },
})
