// Production build config — builds dist/bundle.js as IIFE.
// For local development, use: npm run dev (runs thatopen serve with esbuild).
// Do NOT run "vite" or "vite build --watch" directly for dev.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

function getBetaAliases() {
  if (!existsSync('.thatopen')) return {};
  try {
    const config = JSON.parse(readFileSync('.thatopen', 'utf-8'));
    if (!config.beta) return {};
    return {
      '@thatopen/components': '@thatopen-platform/components-beta',
      '@thatopen/components-front': '@thatopen-platform/components-front-beta',
      '@thatopen/fragments': '@thatopen-platform/fragments-beta',
    };
  } catch {
    return {};
  }
}

export default defineConfig({
  resolve: {
    alias: getBetaAliases(),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'ThatOpenComponent',
      formats: ['iife'],
      fileName: () => 'bundle.js',
    },
    outDir: 'dist',
    rollupOptions: {
      // Only @thatopen/services is externalized — the execution wrapper
      // provides it at runtime via require('@thatopen/services'). Every
      // other dependency (including @thatopen/components, three, web-ifc,
      // or any npm package you install) must be bundled into bundle.js.
      external: ['@thatopen/services'],
      output: {
        footer: 'var main = ThatOpenComponent.main;',
      },
    },
  },
});
