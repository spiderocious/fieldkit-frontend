import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The service worker is a second entry, bundled to /sw.js with no hash so
// the browser can find it at a fixed URL. It imports nothing from the app
// bundle, so it never shares a chunk with it.
const buildId = Date.now().toString(36);

// After the bundle is written, emit the list of built assets. The service
// worker fetches it on install and precaches exactly those files, so the
// cache always matches the deploy. This is the one piece a hand-written
// worker cannot know on its own.
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.values(bundle)
        .map((f) => f.fileName)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .map((f) => `/${f}`);
      this.emitFile({
        type: 'asset',
        fileName: 'precache.json',
        source: JSON.stringify({ buildId, files: ['/', '/manifest.webmanifest', ...files] }),
      });
    },
  };
}

// In dev, Vite serves src/sw.ts as a module at /src/sw.ts. The browser only
// lets a worker control '/' when this header says so.
function devServiceWorkerScope(): Plugin {
  return {
    name: 'dev-sw-scope',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/src/sw.ts')) res.setHeader('Service-Worker-Allowed', '/');
        next();
      });
    },
  };
}

// Local only. In production the host rewrites /api and /__control to the
// backend (see vercel.json) so the app stays same-origin with its API.
const proxy = {
  '/api': { target: 'http://localhost:8090', changeOrigin: true },
  '/__control': { target: 'http://localhost:8090', changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), precacheManifest(), devServiceWorkerScope()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./src', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@icons': fileURLToPath(new URL('./src/ui/icons/index.ts', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        sw: fileURLToPath(new URL('./src/sw.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
