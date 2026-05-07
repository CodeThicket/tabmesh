import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'TabMeshReact',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', '@tabmesh/core'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          '@tabmesh/core': 'TabMesh',
        },
      },
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
