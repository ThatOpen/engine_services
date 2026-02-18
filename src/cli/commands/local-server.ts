import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { fork, ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { requireResolvedConfig } from '../lib/config';

// ─── Types ────────────────────────────────────────────────────────

type ExecutionResultType = 'SUCCESS' | 'ERROR' | 'WARNING';

interface ExecutionMessage {
  _id: string;
  executionId: string;
  content: string;
  createdAt: string;
}

interface ExecutionState {
  _id: string;
  toolId: string;
  toolVersion: string;
  progress: number;
  result?: ExecutionResultType;
  resultMessage?: string;
  messages: ExecutionMessage[];
  createdAt: string;
  updatedAt?: string;
  creatingUser: string;
  childProcess: ChildProcess | null;
  tmpFile: string;
}

// Socket subscriber: a raw socket that listens for execution events
interface SocketSubscriber {
  executionId: string;
  send: (event: string, data: unknown) => void;
}

// ─── Engine Script Builder ────────────────────────────────────────

function buildEngineScript(
  bundleCode: string,
  accessToken: string,
  apiUrl: string,
  executionParams: object,
): string {
  return `/* eslint-disable */
const { EngineServicesClient } = require('thatopen-services');

const OBC = require('@thatopen/components');
const THREE = require('three');
let WEBIFC; try { WEBIFC = require('web-ifc'); } catch {}
const fs = require('fs');

const executionReporter = {
  message: (message) => {
    process.send({ type: 'MESSAGE', message });
  },
  progress: (message) => {
    process.send({ type: 'PROGRESS', message });
  },
};

let thatOpenServices, executionParams;

// --- User bundle code (IIFE) ---
${bundleCode}
// --- End user bundle code ---

if (typeof main !== 'function') {
  process.send({ type: 'FAIL', message: 'Bundle does not export a main() function' });
  process.exit(1);
}

const executeAndReportProcess = async (newThatOpenServices, newExecutionParams) => {
  thatOpenServices = newThatOpenServices;
  executionParams = newExecutionParams;

  try {
    const result = await main();
    if (!result) {
      process.send({
        type: 'WARNING',
        message: 'No result returned from main function of the component',
      });
      return;
    }
    process.send(result);
  } catch (error) {
    process.send({
      type: 'FAIL',
      message: error.message,
    });
  }
};

// Start execution immediately
const thatOpenServicesInstance = new EngineServicesClient(
  ${JSON.stringify(accessToken)},
  ${JSON.stringify(apiUrl)},
);

executeAndReportProcess(thatOpenServicesInstance, ${JSON.stringify(executionParams)});
`;
}

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

    // ─── In-memory execution state ─────────────────────────

    const executions = new Map<string, ExecutionState>();

    // ─── Socket.IO subscribers (WebSocket connections) ─────

    const subscribers: Set<SocketSubscriber> = new Set();

    function emitToSubscribers(executionId: string, data: unknown) {
      for (const sub of subscribers) {
        if (sub.executionId === executionId) {
          sub.send('execution', data);
        }
      }
    }

    // ─── Start execution ───────────────────────────────────

    function startExecution(
      componentId: string,
      executionParams: object,
    ): ExecutionState {
      const executionId = randomUUID();
      const now = new Date().toISOString();

      if (!existsSync(bundlePath)) {
        throw new Error(
          'Build output not found at dist/bundle.js. Wait for the initial build or run with --skip-build after building manually.',
        );
      }

      const bundleCode = readFileSync(bundlePath, 'utf-8');
      const engineScript = buildEngineScript(
        bundleCode,
        config.accessToken,
        config.apiUrl,
        executionParams,
      );

      const tmpFile = join(tmpdir(), `thatopen-local-${executionId}.js`);
      writeFileSync(tmpFile, engineScript);

      const state: ExecutionState = {
        _id: executionId,
        toolId: componentId,
        toolVersion: 'local',
        progress: 0,
        messages: [],
        createdAt: now,
        creatingUser: 'local',
        childProcess: null,
        tmpFile,
      };

      executions.set(executionId, state);

      const child = fork(tmpFile, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
          ...process.env,
          NODE_PATH: join(cwd, 'node_modules'),
        },
      });

      state.childProcess = child;

      child.on(
        'message',
        (msg: { type: string; message: string }) => {
          const now = new Date().toISOString();
          state.updatedAt = now;

          switch (msg.type) {
            case 'MESSAGE': {
              const msgEntity: ExecutionMessage = {
                _id: randomUUID(),
                executionId,
                content: msg.message,
                createdAt: now,
              };
              state.messages.push(msgEntity);
              console.log(`[${executionId.slice(0, 8)}] [message] ${msg.message}`);
              emitToSubscribers(executionId, {
                messageUpdate: {
                  ...msgEntity,
                  creatingUser: 'local',
                  updatedAt: now,
                },
              });
              break;
            }
            case 'PROGRESS': {
              const progress = typeof msg.message === 'number'
                ? msg.message
                : parseFloat(msg.message) || 0;
              state.progress = progress;
              console.log(`[${executionId.slice(0, 8)}] [progress] ${progress}%`);
              emitToSubscribers(executionId, {
                progressUpdate: toExecutionEntity(state),
              });
              break;
            }
            case 'SUCCESS': {
              state.result = 'SUCCESS';
              state.resultMessage = msg.message;
              state.progress = 100;
              console.log(`[${executionId.slice(0, 8)}] [success] ${msg.message}`);
              emitToSubscribers(executionId, {
                progressUpdate: toExecutionEntity(state),
              });
              cleanupTmpFile(state);
              break;
            }
            case 'WARNING': {
              state.result = 'WARNING';
              state.resultMessage = msg.message;
              state.progress = 100;
              console.log(`[${executionId.slice(0, 8)}] [warning] ${msg.message}`);
              emitToSubscribers(executionId, {
                progressUpdate: toExecutionEntity(state),
              });
              cleanupTmpFile(state);
              break;
            }
            case 'FAIL': {
              state.result = 'ERROR';
              state.resultMessage = msg.message;
              console.error(`[${executionId.slice(0, 8)}] [error] ${msg.message}`);
              emitToSubscribers(executionId, {
                progressUpdate: toExecutionEntity(state),
              });
              cleanupTmpFile(state);
              break;
            }
            default: {
              console.log(`[${executionId.slice(0, 8)}] [${msg.type}] ${msg.message}`);
            }
          }
        },
      );

      child.on('error', (err) => {
        state.result = 'ERROR';
        state.resultMessage = err.message;
        state.updatedAt = new Date().toISOString();
        emitToSubscribers(executionId, {
          progressUpdate: toExecutionEntity(state),
        });
        cleanupTmpFile(state);
      });

      child.on('exit', () => {
        state.childProcess = null;
        cleanupTmpFile(state);
      });

      return state;
    }

    function cleanupTmpFile(state: ExecutionState) {
      try {
        unlinkSync(state.tmpFile);
      } catch {
        // Already cleaned up
      }
    }

    function toExecutionEntity(state: ExecutionState) {
      return {
        _id: state._id,
        toolId: state.toolId,
        toolVersion: state.toolVersion,
        progress: state.progress,
        result: state.result,
        resultMessage: state.resultMessage,
        messages: state.messages,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        creatingUser: state.creatingUser,
      };
    }

    // ─── URL routing helpers ───────────────────────────────

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

    // ─── HTTP Server ───────────────────────────────────────

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
          const state = startExecution(componentId, body);
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
        const state = executions.get(executionId);
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
        const state = executions.get(executionId);
        if (!state) {
          sendJson(res, 404, { error: 'Execution not found' });
          return;
        }
        if (state.childProcess) {
          state.childProcess.kill();
          state.result = 'ERROR';
          state.resultMessage = 'Execution aborted by user';
          state.updatedAt = new Date().toISOString();
          emitToSubscribers(executionId, {
            progressUpdate: toExecutionEntity(state),
          });
        }
        sendJson(res, 200, toExecutionEntity(state));
        return;
      }

      // GET /api/processor/:componentId/progress — list executions for a component
      const listProgressMatch = pathname.match(
        /^\/api\/processor\/([^/]+)\/progress$/,
      );
      if (listProgressMatch && method === 'GET') {
        const componentId = listProgressMatch[1];
        const results: object[] = [];
        for (const state of executions.values()) {
          if (state.toolId === componentId) {
            results.push(toExecutionEntity(state));
          }
        }
        sendJson(res, 200, results);
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

    // ─── WebSocket server (Socket.IO over ws) ─────────────

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const { pathname } = parseUrl(req.url || '/');

      if (!pathname.startsWith('/socket.io/')) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', (ws: WebSocket) => {
      const sid = randomUUID().replace(/-/g, '').slice(0, 20);

      // EIO4 open packet
      const openPayload = JSON.stringify({
        sid,
        upgrades: [],
        pingInterval: 25000,
        pingTimeout: 20000,
        maxPayload: 1000000,
      });
      ws.send(`0${openPayload}`);

      // Socket.IO v4 connect packet for namespace "/"
      ws.send(`40{"sid":"${sid}"}`);

      let pingInterval: ReturnType<typeof setInterval> | null = null;

      const subscriber: SocketSubscriber = {
        executionId: '',
        send(event: string, data: unknown) {
          if (ws.readyState === WebSocket.OPEN) {
            const packet = JSON.stringify([event, data]);
            ws.send(`42${packet}`);
          }
        },
      };

      // EIO ping to keep alive
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('2');
        } else {
          cleanup();
        }
      }, 25000);

      function cleanup() {
        subscribers.delete(subscriber);
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      }

      ws.on('message', (raw: Buffer | string) => {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');

        // EIO pong
        if (text === '3') return;
        // EIO ping — respond with pong
        if (text === '2') { ws.send('3'); return; }

        // Socket.IO event: 42["eventName", data]
        if (text.startsWith('42')) {
          try {
            const arr = JSON.parse(text.slice(2));
            if (Array.isArray(arr) && arr[0] === 'executionSubscription') {
              const payload =
                typeof arr[1] === 'string' ? JSON.parse(arr[1]) : arr[1];
              subscriber.executionId = payload.executionId;
              subscribers.add(subscriber);
              console.log(`[local-server] WebSocket subscribed to execution ${payload.executionId.slice(0, 8)}...`);
            }
          } catch {
            // Ignore malformed packets
          }
        }
      });

      ws.on('close', cleanup);
      ws.on('error', (err) => {
        console.error('[local-server] WebSocket error:', err.message);
        cleanup();
      });
    });

    // ─── Start listening ───────────────────────────────────

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
      server.close();
      process.exit(0);
    });
  });

