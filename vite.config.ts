import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // lets the frontend call /api/* without CORS while both dev servers run.
  // target must match PORT in server/.env
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
