import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API serves the built dashboard at /dashboard, so assets must be requested from there.
// In development, Vite proxies the API paths to the backend so no CORS configuration is needed.
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
  server: {
    proxy: {
      '/events': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
