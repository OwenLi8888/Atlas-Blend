import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every URL relative, so the build can be hosted from any folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: true, proxy: { '/api': 'http://127.0.0.1:43871' } },
  preview: { host: true },
});
