import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/cli/index.ts'),
      formats: ['cjs'],
      fileName: () => 'cli.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      external: [
        // Externalize Node builtins only — bundle everything else
        /^node:/,
        'fs',
        'path',
        'os',
        'child_process',
        'url',
        'buffer',
        'crypto',
        'stream',
        'events',
        'util',
        'http',
        'https',
        'net',
        'tls',
        'zlib',
        // esbuild is a native binary — cannot be bundled.
        // Resolved from the user's node_modules at runtime (Vite depends on it).
        'esbuild',
        // socket.io is used for WebSocket server in the local-server command.
        // Must be external because it depends on engine.io/ws with native optional deps.
        'socket.io',
      ],
      output: {
        banner: '#!/usr/bin/env node',
      },
    },
    target: 'node18',
    minify: false,
  },
  resolve: { alias: { src: resolve('src/') } },
});
