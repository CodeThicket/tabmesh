import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'TabMeshTransportWebSocket',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['@tabmesh/core'],
    },
    sourcemap: true,
    minify: 'esbuild',
    outDir: 'dist',
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
