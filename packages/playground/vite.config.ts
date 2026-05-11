import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In production the playground is served from tabmesh.dev/playground/ (the
// docs site iframes it). Dev keeps base `/` so the existing Playwright
// e2e suite, which hits the Vite dev server at http://localhost:5173/,
// is unaffected.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/playground/' : '/',
  server: {
    port: 5173,
  },
}));
