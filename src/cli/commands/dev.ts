import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

export const devCommand = new Command('dev')
  .description('Start local development server')
  .option('--port <port>', 'Port for standalone dev server', '5173')
  .option('--platform', 'Serve IIFE bundle for use inside the platform iframe')
  .option('--bundle-port <port>', 'Port for the bundle server in --platform mode', '4000')
  .action(async (opts: { port: string; platform: boolean; bundlePort: string }) => {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error(
        'No package.json found. Run this from a ThatOpen app project.',
      );
      process.exit(1);
    }

    if (opts.platform) {
      startPlatformMode(cwd, opts.bundlePort);
    } else {
      startStandaloneMode(cwd, opts.port);
    }
  });

function startStandaloneMode(cwd: string, port: string) {
  console.log(`Starting standalone dev server on http://localhost:${port}`);
  console.log('');
  console.log('Tip: To test inside the platform, run:');
  console.log('  thatopen dev --platform');
  console.log('');

  const vite = spawn('npx', ['vite', '--port', port], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  vite.on('exit', (code) => process.exit(code ?? 0));
}

function startPlatformMode(cwd: string, bundlePort: string) {
  const bundlePath = join(cwd, 'dist', 'bundle.js');
  const mapPath = join(cwd, 'dist', 'bundle.js.map');

  console.log('Building in watch mode...');
  console.log('');

  // Start vite build --watch
  const vite = spawn('npx', ['vite', 'build', '--watch'], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  // SSE clients for live reload
  const sseClients: Set<ServerResponse> = new Set();

  // Watch bundle.js for changes and notify SSE clients
  let watchReady = false;
  const startWatching = () => {
    if (watchReady) return;
    const distDir = join(cwd, 'dist');
    if (!existsSync(distDir)) return;

    watchReady = true;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    watch(distDir, (_, filename) => {
      if (filename === 'bundle.js') {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          console.log('[reload] bundle.js changed, notifying clients...');
          for (const client of sseClients) {
            client.write('data: reload\n\n');
          }
        }, 200);
      }
    });
  };

  // Poll until dist/ exists, then start watching
  const watchInterval = setInterval(() => {
    if (existsSync(join(cwd, 'dist'))) {
      startWatching();
      clearInterval(watchInterval);
    }
  }, 500);

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for live reload
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Bundle JS
    if (req.url === '/bundle.js' || req.url === '/') {
      if (!existsSync(bundlePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Bundle not built yet. Waiting for vite build...');
        return;
      }

      const content = readFileSync(bundlePath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-store',
      });
      res.end(content);
      return;
    }

    // Source map
    if (req.url === '/bundle.js.map') {
      if (!existsSync(mapPath)) {
        res.writeHead(404);
        res.end('Source map not found');
        return;
      }

      const content = readFileSync(mapPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(content);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  };

  const bundleUrl = `http://localhost:${bundlePort}/bundle.js`;
  const server = createServer(handler);

  server.listen(parseInt(bundlePort), () => {
    console.log(`Bundle server running at http://localhost:${bundlePort}`);
    console.log('');
    console.log('Use this devUrl in the platform:');
    console.log(`  ${bundleUrl}`);
    console.log('');
    console.log('Live reload is enabled — save a file to rebuild and');
    console.log('the app will automatically reload inside the platform.');
    console.log('');
  });

  // Cleanup on exit
  process.on('SIGINT', () => {
    vite.kill();
    server.close();
    process.exit(0);
  });

  vite.on('exit', (code) => {
    server.close();
    process.exit(code ?? 0);
  });
}
