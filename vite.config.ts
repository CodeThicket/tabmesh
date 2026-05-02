import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'packages/core/src/index.ts'),
      name: 'TabMesh',
      formats: ['es', 'cjs', 'umd'],
      fileName: (format) => `tabmesh.${format}.js`,
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
      },
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
