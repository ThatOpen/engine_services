// Production build config — builds dist/bundle.js as IIFE.
// For local development, use: npm run dev (runs thatopen serve with esbuild).
// Do NOT run "vite" or "vite build --watch" directly for dev.
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// When `.thatopen` marks the project as beta, alias the public engine imports
// to their `@thatopen-platform/*-beta` packages at build time, so the source
// can use the stable import names in both stable and beta modes.
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

// Some three.js example loaders (e.g. TTFLoader) import their deps from a
// jsdelivr `/+esm` CDN URL. A bundler can't put a URL import in an IIFE — it
// degrades to a runtime `require("https://…")` that throws — so rewrite any such
// URL back to the bare package name and let it resolve from node_modules.
const CDN_ESM = /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)(?:@[^/]+)?\/\+esm$/;

export default defineConfig({
  resolve: {
    alias: [
      { find: CDN_ESM, replacement: '$1' },
      ...Object.entries(getBetaAliases()).map(([find, replacement]) => ({
        find,
        replacement,
      })),
    ],
  },
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
