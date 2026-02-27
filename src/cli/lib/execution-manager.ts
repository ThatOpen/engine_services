import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fork, ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildEngineScript } from './engine-script';

// ─── Types ────────────────────────────────────────────────────────

export type ExecutionResultType = 'SUCCESS' | 'ERROR' | 'WARNING';

export interface ExecutionMessage {
  _id: string;
  executionId: string;
  content: string;
  createdAt: string;
}

export interface ExecutionState {
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

export interface ExecutionEntity {
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
}

export type ExecutionEventListener = (executionId: string, data: unknown) => void;

// ─── Execution Manager ────────────────────────────────────────────

export class ExecutionManager {
  private executions = new Map<string, ExecutionState>();
  private listeners = new Set<ExecutionEventListener>();

  onExecutionEvent(listener: ExecutionEventListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(executionId: string, data: unknown) {
    for (const listener of this.listeners) {
      listener(executionId, data);
    }
  }

  getExecution(executionId: string): ExecutionState | undefined {
    return this.executions.get(executionId);
  }

  listExecutions(componentId: string): ExecutionEntity[] {
    const results: ExecutionEntity[] = [];
    for (const state of this.executions.values()) {
      if (state.toolId === componentId) {
        results.push(toExecutionEntity(state));
      }
    }
    return results;
  }

  abortExecution(executionId: string): ExecutionEntity | undefined {
    const state = this.executions.get(executionId);
    if (!state) return undefined;

    if (state.childProcess) {
      state.childProcess.kill();
      state.result = 'ERROR';
      state.resultMessage = 'Execution aborted by user';
      state.updatedAt = new Date().toISOString();
      this.emit(executionId, {
        progressUpdate: toExecutionEntity(state),
      });
    }

    return toExecutionEntity(state);
  }

  startExecution(
    componentId: string,
    executionParams: object,
    config: { bundlePath: string; accessToken: string; apiUrl: string; cwd: string },
  ): ExecutionState {
    const executionId = randomUUID();
    const now = new Date().toISOString();

    if (!existsSync(config.bundlePath)) {
      throw new Error(
        'Build output not found at dist/bundle.js. Wait for the initial build or run with --skip-build after building manually.',
      );
    }

    const bundleCode = readFileSync(config.bundlePath, 'utf-8');
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

    this.executions.set(executionId, state);

    const child = fork(tmpFile, [], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        NODE_PATH: join(config.cwd, 'node_modules'),
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
            this.emit(executionId, {
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
            this.emit(executionId, {
              progressUpdate: toExecutionEntity(state),
            });
            break;
          }
          case 'SUCCESS': {
            state.result = 'SUCCESS';
            state.resultMessage = msg.message;
            state.progress = 100;
            console.log(`[${executionId.slice(0, 8)}] [success] ${msg.message}`);
            this.emit(executionId, {
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
            this.emit(executionId, {
              progressUpdate: toExecutionEntity(state),
            });
            cleanupTmpFile(state);
            break;
          }
          case 'FAIL': {
            state.result = 'ERROR';
            state.resultMessage = msg.message;
            console.error(`[${executionId.slice(0, 8)}] [error] ${msg.message}`);
            this.emit(executionId, {
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
      this.emit(executionId, {
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
}

// ─── Helpers ──────────────────────────────────────────────────────

export function toExecutionEntity(state: ExecutionState): ExecutionEntity {
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

function cleanupTmpFile(state: ExecutionState) {
  try {
    unlinkSync(state.tmpFile);
  } catch {
    // Already cleaned up
  }
}
