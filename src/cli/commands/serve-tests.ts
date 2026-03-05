import { Command } from 'commander';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

export const serveTestsCommand = new Command('serve-tests')
  .argument(
    '<directory>',
    'Parent directory containing both projects',
  )
  .option('--app-name <name>', 'Name of the test app project', 'test-app')
  .option(
    '--component-name <name>',
    'Name of the test component project',
    'test-component',
  )
  .option('--app-port <port>', 'Port for the app bundle server', '4000')
  .option('--component-port <port>', 'Port for the component local server', '4001')
  .description(
    'Serve both the test app (thatopen serve) and the test component (thatopen local-server) in parallel',
  )
  .action(
    async (
      directory: string,
      opts: {
        appName: string;
        componentName: string;
        appPort: string;
        componentPort: string;
      },
    ) => {
      const parentDir = resolve(process.cwd(), directory);
      const bin = process.argv[1];

      const appDir = resolve(parentDir, opts.appName);
      const componentDir = resolve(parentDir, opts.componentName);

      console.log('Starting test suite servers...');
      console.log('');

      const children: ReturnType<typeof spawn>[] = [];

      // Helper: spawn a child with prefixed stdout/stderr
      function startProcess(
        label: string,
        cwd: string,
        args: string[],
      ) {
        const child = spawn(process.execPath, [bin, ...args], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const prefix = `[${label}]`;

        child.stdout.on('data', (data: Buffer) => {
          for (const line of data.toString().split('\n')) {
            if (line) console.log(`${prefix} ${line}`);
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          for (const line of data.toString().split('\n')) {
            if (line) console.error(`${prefix} ${line}`);
          }
        });

        child.on('exit', (code) => {
          console.log(`${prefix} exited with code ${code}`);
        });

        children.push(child);
      }

      // 1 — Component local-server (start first so it's ready when the app connects)
      startProcess('component', componentDir, [
        'local-server',
        '--port',
        opts.componentPort,
      ]);

      // 2 — App serve
      startProcess('app', appDir, ['serve', '--port', opts.appPort]);

      console.log(`[component] ${componentDir} → http://localhost:${opts.componentPort}`);
      console.log(`[app]       ${appDir} → http://localhost:${opts.appPort}`);
      console.log('');

      // Forward SIGINT to children
      process.on('SIGINT', () => {
        for (const child of children) {
          child.kill('SIGINT');
        }
        setTimeout(() => process.exit(0), 500);
      });
    },
  );
