import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const createTestsCommand = new Command('create-tests')
  .argument(
    '<directory>',
    'Parent directory for both projects (required to prevent accidental deletion)',
  )
  .option('--app-name <name>', 'Name of the test app project', 'test-app')
  .option(
    '--component-name <name>',
    'Name of the test component project',
    'test-component',
  )
  .description(
    'Scaffold both a test app (--template test) and a test cloud component (--template cloud-test)',
  )
  .action(
    async (
      directory: string,
      opts: { appName: string; componentName: string },
    ) => {
      const parentDir = resolve(process.cwd(), directory);
      const bin = process.argv[1]; // path to the thatopen CLI entry point

      // Clean up previous test suite if it exists
      if (existsSync(parentDir)) {
        console.log(`Removing existing directory "${directory}"...`);
        rmSync(parentDir, { recursive: true, force: true });
      }
      mkdirSync(parentDir, { recursive: true });

      console.log('Creating test suite...');
      console.log('');

      // 1 ── Test App
      console.log(`── Creating test app "${opts.appName}" ──`);
      const appResult = spawnSync(
        process.execPath,
        [bin, 'create', opts.appName, '-t', 'test'],
        { cwd: parentDir, stdio: 'inherit' },
      );
      if (appResult.status !== 0) {
        process.exit(appResult.status ?? 1);
      }

      console.log('');

      // 2 ── Test Cloud Component
      console.log(`── Creating test component "${opts.componentName}" ──`);
      const compResult = spawnSync(
        process.execPath,
        [bin, 'create', opts.componentName, '-t', 'cloud-test'],
        { cwd: parentDir, stdio: 'inherit' },
      );
      if (compResult.status !== 0) {
        process.exit(compResult.status ?? 1);
      }

      console.log('');
      console.log('Test suite ready!');
      console.log('');
      console.log('Quick start:');
      console.log(
        `  1. cd ${opts.componentName} && npm run run   # Run the test component locally`,
      );
      console.log(
        `  2. cd ${opts.appName} && npm run dev          # Start the test app`,
      );
      console.log('');
    },
  );
