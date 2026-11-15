import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { picksMiddleware } from './server/picksApi.mjs';

// Serves /api/picks (photo picks, saved to data/runtime/picks.json) from the dev and preview servers.
const picksApi = (): Plugin => ({
  name: 'picks-api',
  configureServer: (server) => void server.middlewares.use(picksMiddleware()),
  configurePreviewServer: (server) => void server.middlewares.use(picksMiddleware()),
});

// base './' keeps every URL relative, so the build can be hosted from any folder.
export default defineConfig({
  base: './',
  plugins: [react(), picksApi()],
  worker: { format: 'es' },
  // Two pages: the original app (index.html) and Gallery Blend (gallery.html).
  build: { rollupOptions: { input: ['index.html', 'gallery.html'] } },
  server: { host: true, proxy: { '/api': 'http://127.0.0.1:43871' } },
  preview: { host: true },
});
