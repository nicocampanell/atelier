/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor PORT (set by preview tooling) so a busy 5173 doesn't collide.
  server: {
    port: Number(process.env.PORT) || 5173,
    // Dev only: same-origin "/api/..." → backend. Production uses VITE_API_URL in src/api/client.ts.
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    css: false,
  },
})
