export function getViteConfig(template?: string): string {
  if (template === 'cloud') {
    return `import { defineConfig } from 'vite';
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
`;
  }

  return `import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'ThatOpenApp',
      formats: ['iife'],
      fileName: () => 'bundle.js',
    },
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'bundle.js',
      },
    },
  },
});
`;
}
