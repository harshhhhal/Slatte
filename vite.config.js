import { defineConfig } from 'vite';

export default defineConfig({
  appType: 'spa',
  build: { target: 'es2022', sourcemap: false },
  server: { port: 5173 },
});
