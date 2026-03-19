// Production build config — builds dist/bundle.js as IIFE.
// For local development, use: npm run dev (runs thatopen serve with esbuild).
// Do NOT run "vite" or "vite build --watch" directly for dev.
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'ThatOpenComponent',
      formats: ['iife'],
      fileName: () => 'bundle.js',
    },
    outDir: 'dist',
    rollupOptions: {
      external: [
        'thatopen-services',
        '@thatopen/components',
        'three',
        'web-ifc',
        'fs',
        'path',
        'crypto',
        'os',
      ],
      output: {
        footer: 'var main = ThatOpenComponent.main;',
      },
    },
  },
});
