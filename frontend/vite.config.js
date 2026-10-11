import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API is proxied, so the SPA and API share an origin:
// no CORS round-trips and the httpOnly refresh cookie is first-party. This also means one public
// tunnel to the dev server exposes both the app and the API (email links, Chapa webhooks).
export default defineConfig(({ mode }) => {
  // Shell variables override .env / .env.local.
  const env = loadEnv(mode, process.cwd(), '');
  // VITE_ALLOWED_HOSTS: extra host names (comma-separated) the dev server answers, e.g. the public host
  // of a tunnel used to open email links on another device. A leading dot allows subdomains.
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      allowedHosts,
      proxy: { '/api': { target: env.VITE_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false } },
    },
    build: {
      rollupOptions: {
        output: {
          // Long-lived vendor chunks: app deploys don't invalidate the browser's cached libraries.
          // Matched by path so sub-entries (e.g. react-dom/client) land in the vendor chunk too.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react';
            if (/node_modules\/(@tanstack|zod|react-hook-form|@hookform)\//.test(id)) return 'data';
            if (/node_modules\/(@radix-ui|sonner|lucide-react)\//.test(id)) return 'ui';
            return undefined;
          },
        },
      },
    },
  };
});
