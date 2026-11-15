import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every URL relative, so the build can be hosted from any folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: true },
  preview: { host: true },
});
