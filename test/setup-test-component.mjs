import { rmSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');
const tempDir = resolve(root, 'temp');
const componentDir = resolve(tempDir, 'test-component');

// Clean previous test component
try {
  rmSync(componentDir, { recursive: true, force: true });
} catch {
  // ignore if it doesn't exist
}

// Ensure temp folder exists
mkdirSync(tempDir, { recursive: true });

// Scaffold the cloud component
execSync(`node ${resolve(root, 'dist/cli.js')} create test-component -t cloud`, {
  cwd: tempDir,
  stdio: 'inherit',
});

// Link local thatopen-services so the test component uses the local build
execSync('npm link thatopen-services', {
  cwd: componentDir,
  stdio: 'inherit',
});

// Build the component so it's ready to run
execSync('npm run build', {
  cwd: componentDir,
  stdio: 'inherit',
});

console.log('');
console.log('Test component ready! Run:');
console.log('  npm run test:cli-run-component');
