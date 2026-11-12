import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2019', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
