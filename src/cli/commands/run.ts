import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, fork } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { requireResolvedConfig } from '../lib/config';
import { buildEngineScript } from '../lib/engine-script';

export const runCommand = new Command('run')
  .description('Build and run a cloud component locally')
  .option(
    '--params <json>',
    'Execution parameters as JSON string',
    '{}',
  )
  .option('--skip-build', 'Skip the build step')
  .action(
    async (opts: {
      params: string;
      skipBuild?: boolean;
    }) => {
      const cwd = process.cwd();
      const config = requireResolvedConfig(cwd);

      // Parse execution params
      let executionParams: object;
      try {
        executionParams = JSON.parse(opts.params);
      } catch {
        console.error('Invalid JSON for --params.');
        process.exit(1);
      }

      // Build
      if (!opts.skipBuild) {
        console.log('Building...');
        try {
          execSync('npm run build', { cwd, stdio: 'inherit' });
        } catch {
          console.error('Build failed. Fix the errors above and try again.');
          process.exit(1);
        }
      }

      // Read bundle
      const bundlePath = join(cwd, 'dist', 'bundle.js');
      if (!existsSync(bundlePath)) {
        console.error(
          'Build output not found at dist/bundle.js. Run `npm run build` first.',
        );
        process.exit(1);
      }

      const bundleCode = readFileSync(bundlePath, 'utf-8');

      // Create temp engine script with inlined bundle
      const engineScript = buildEngineScript(
        bundleCode,
        config.accessToken,
        config.apiUrl,
        executionParams,
      );

      const tmpFile = join(tmpdir(), `thatopen-run-${randomUUID()}.js`);
      writeFileSync(tmpFile, engineScript);

      console.log('Running cloud component...\n');

      // Fork as child process (mirrors backend ProcessorService behavior)
      const startTime = Date.now();
      const child = fork(tmpFile, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
          ...process.env,
          NODE_PATH: join(cwd, 'node_modules'),
        },
      });

      const cleanup = () => {
        try {
          unlinkSync(tmpFile);
        } catch {
          // Temp file may already be cleaned up
        }
      };

      child.on('message', (msg: { type: string; message: string }) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        switch (msg.type) {
          case 'MESSAGE':
            console.log(`[${elapsed}s] [message] ${msg.message}`);
            break;
          case 'PROGRESS':
            console.log(`[${elapsed}s] [progress] ${msg.message}%`);
            break;
          case 'SUCCESS':
            console.log(`\n[${elapsed}s] [success] ${msg.message}`);
            cleanup();
            process.exit(0);
            break;
          case 'WARNING':
            console.warn(`\n[${elapsed}s] [warning] ${msg.message}`);
            cleanup();
            process.exit(0);
            break;
          case 'FAIL':
            console.error(`\n[${elapsed}s] [error] ${msg.message}`);
            cleanup();
            process.exit(1);
            break;
          default:
            console.log(`[${elapsed}s] [${msg.type}] ${msg.message}`);
        }
      });

      child.on('error', (err) => {
        console.error('Failed to start component process:', err.message);
        cleanup();
        process.exit(1);
      });

      child.on('exit', (code) => {
        cleanup();
        if (code !== null && code !== 0) {
          console.error(`\nComponent process exited with code ${code}`);
          process.exit(code);
        }
      });
    },
  );
