import { Command } from 'commander';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { requireResolvedConfig } from '../lib/config';
import { ExecutionManager, toExecutionEntity } from '../lib/execution-manager';

// ─── JSON Body Parser ─────────────────────────────────────────────

function parseJsonBody(req: IncomingMessage): Promise<object> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── URL routing helpers ──────────────────────────────────────────

function parseUrl(url: string) {
  const [pathname] = url.split('?');
  return { pathname: pathname || '/' };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Command ──────────────────────────────────────────────────────

export const localServerCommand = new Command('local-server')
  .description(
    'Start a local execution server that mimics the cloud API for testing cloud components',
  )
  .option('--port <port>', 'Port for the local server', '4001')
  .option('--skip-build', 'Skip the initial build step')
  .action(async (opts: { port: string; skipBuild?: boolean }) => {
    const cwd = process.cwd();
    const config = requireResolvedConfig(cwd);
    const port = parseInt(opts.port);
    const bundlePath = join(cwd, 'dist', 'bundle.js');

    // ─── esbuild watch mode ────────────────────────────────

    let esbuild: typeof import('esbuild');
    try {
      esbuild = await import('esbuild');
    } catch {
      console.error(
        'Could not find esbuild. Make sure you have run `npm install`.',
      );
      process.exit(1);
    }

    let buildReady = false;

    if (!opts.skipBuild) {
      const ctx = await esbuild.context({
        entryPoints: [join(cwd, 'src', 'main.ts')],
        bundle: true,
        format: 'iife',
        globalName: 'ThatOpenComponent',
        footer: { js: 'var main = ThatOpenComponent.main;' },
        outfile: bundlePath,
        logLevel: 'info',
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
        plugins: [
          {
            name: 'local-server-rebuild',
            setup(build) {
              build.onEnd((result) => {
                if (result.errors.length === 0) {
                  buildReady = true;
                  console.log('[local-server] Rebuild complete.');
                }
              });
            },
          },
        ],
      });

      await ctx.watch();
      console.log('[local-server] Watching for file changes...');

      // Clean up esbuild on exit
      process.on('SIGINT', async () => {
        await ctx.dispose();
        process.exit(0);
      });
    } else {
      buildReady = true;
    }

    // ─── Execution manager ──────────────────────────────────

    const manager = new ExecutionManager();

    // ─── HTTP Server ────────────────────────────────────────

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const { pathname } = parseUrl(req.url || '/');
      const method = req.method || 'GET';

      // POST /api/processor/:componentId/execute
      const executeMatch = pathname.match(
        /^\/api\/processor\/([^/]+)\/execute$/,
      );
      if (executeMatch && method === 'POST') {
        const componentId = executeMatch[1];
        try {
          const body = await parseJsonBody(req);
          const state = manager.startExecution(componentId, body, {
            bundlePath,
            accessToken: config.accessToken,
            apiUrl: config.apiUrl,
            cwd,
          });
          sendJson(res, 200, { executionId: state._id });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          sendJson(res, 500, { error: message });
        }
        return;
      }

      // GET /api/processor/progress/:executionId
      const getProgressMatch = pathname.match(
        /^\/api\/processor\/progress\/([^/]+)$/,
      );
      if (getProgressMatch && method === 'GET') {
        const executionId = getProgressMatch[1];
        const state = manager.getExecution(executionId);
        if (!state) {
          sendJson(res, 404, { error: 'Execution not found' });
          return;
        }
        sendJson(res, 200, toExecutionEntity(state));
        return;
      }

      // POST /api/processor/progress/:executionId/abort
      const abortMatch = pathname.match(
        /^\/api\/processor\/progress\/([^/]+)\/abort$/,
      );
      if (abortMatch && method === 'POST') {
        const executionId = abortMatch[1];
        const entity = manager.abortExecution(executionId);
        if (!entity) {
          sendJson(res, 404, { error: 'Execution not found' });
          return;
        }
        sendJson(res, 200, entity);
        return;
      }

      // GET /api/processor/:componentId/progress — list executions for a component
      const listProgressMatch = pathname.match(
        /^\/api\/processor\/([^/]+)\/progress$/,
      );
      if (listProgressMatch && method === 'GET') {
        const componentId = listProgressMatch[1];
        sendJson(res, 200, manager.listExecutions(componentId));
        return;
      }

      // Health check
      if (pathname === '/' && method === 'GET') {
        sendJson(res, 200, {
          status: 'ok',
          server: 'thatopen-local-server',
          buildReady,
        });
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    });

    // ─── Socket.IO server ───────────────────────────────────

    const io = new SocketIOServer(server, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    io.on('connection', (socket) => {
      let subscribedExecutionId = '';

      const unsubscribe = manager.onExecutionEvent((executionId, data) => {
        if (executionId === subscribedExecutionId) {
          socket.emit('execution', data);
        }
      });

      socket.on('executionSubscription', (payload: string | { executionId: string }) => {
        const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
        subscribedExecutionId = parsed.executionId;
        console.log(`[local-server] WebSocket subscribed to execution ${subscribedExecutionId.slice(0, 8)}...`);
      });

      socket.on('disconnect', () => {
        unsubscribe();
      });
    });

    // ─── Start listening ────────────────────────────────────

    server.listen(port, () => {
      console.log('');
      console.log(`[local-server] Running at http://localhost:${port}`);
      console.log('');
      console.log('Usage with EngineServicesClient:');
      console.log('');
      console.log(`  const client = new EngineServicesClient(token, apiUrl, {`);
      console.log(`    localServerUrl: 'http://localhost:${port}'`);
      console.log(`  });`);
      console.log('');
      console.log('Endpoints:');
      console.log(`  POST /api/processor/:componentId/execute`);
      console.log(`  GET  /api/processor/progress/:executionId`);
      console.log(`  POST /api/processor/progress/:executionId/abort`);
      console.log(`  GET  /api/processor/:componentId/progress`);
      console.log('');
    });

    process.on('SIGINT', () => {
      io.close();
      server.close();
      process.exit(0);
    });
  });
