import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API is proxied, so the SPA and API share an origin:
// no CORS round-trips and the httpOnly refresh cookie is first-party.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app deploys don't invalidate the browser's cached libraries.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          data: ['@tanstack/react-query', 'zod', 'react-hook-form', '@hookform/resolvers'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', 'sonner'],
        },
      },
    },
  },
});
