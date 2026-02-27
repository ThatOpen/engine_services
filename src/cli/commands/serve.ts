import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';

export const serveCommand = new Command('serve')
  .description(
    'Build in watch mode and serve the IIFE bundle for local development',
  )
  .option('--port <port>', 'Port for the bundle server', '4000')
  .action(async (opts: { port: string }) => {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');

    if (!existsSync(pkgPath)) {
      console.error(
        'No package.json found. Run this from a ThatOpen app project.',
      );
      process.exit(1);
    }

    // Resolve the project's vite config to determine the IIFE global name
    const globalName = detectGlobalName(cwd);

    const bundlePath = join(cwd, 'dist', 'bundle.js');
    const mapPath = join(cwd, 'dist', 'bundle.js.map');
    const port = parseInt(opts.port);

    // SSE clients for live reload
    const sseClients: Set<ServerResponse> = new Set();

    function notifyClients() {
      for (const client of sseClients) {
        client.write('data: reload\n\n');
      }
    }

    // Import esbuild from the user's node_modules (it's a Vite dependency)
    let esbuild: typeof import('esbuild');
    try {
      esbuild = await import('esbuild');
    } catch {
      console.error(
        'Could not find esbuild. Make sure you have run `npm install`.',
      );
      process.exit(1);
    }

    // esbuild incremental watch mode
    const ctx = await esbuild.context({
      entryPoints: [join(cwd, 'src', 'main.ts')],
      bundle: true,
      format: 'iife',
      globalName,
      outfile: bundlePath,
      sourcemap: true,
      logLevel: 'info',
      plugins: [
        {
          name: 'reload',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                notifyClients();
              }
            });
          },
        },
      ],
    });

    await ctx.watch();

    // HTTP server to serve the bundle
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');

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
          Connection: 'keep-alive',
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
          res.end('Bundle not built yet...');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-store',
        });
        res.end(readFileSync(bundlePath, 'utf-8'));
        return;
      }

      // Source map
      if (req.url === '/bundle.js.map') {
        if (!existsSync(mapPath)) {
          res.writeHead(404);
          res.end('Source map not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(readFileSync(mapPath, 'utf-8'));
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(port, () => {
      console.log(`Bundle server running at http://localhost:${port}`);
      console.log('');
      console.log(
        'Open your project on the platform and click the debug button.',
      );
      console.log(
        'Live reload is enabled — save a file to rebuild automatically.',
      );
      console.log('');
    });

    // Cleanup
    process.on('SIGINT', async () => {
      await ctx.dispose();
      server.close();
      process.exit(0);
    });
  });

/**
 * Peek at the project's vite.config to detect the IIFE global name.
 * Falls back to 'ThatOpenApp' if not found.
 */
function detectGlobalName(cwd: string): string {
  for (const filename of ['vite.config.js', 'vite.config.ts', 'vite.config.mts']) {
    const configPath = join(cwd, filename);
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const match = content.match(/name:\s*['"]([^'"]+)['"]/);
      if (match) return match[1];
    }
  }
  return 'ThatOpenApp';
}
