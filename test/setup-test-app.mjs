import { rmSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '..');
const tempDir = resolve(root, 'temp');
const appDir = resolve(tempDir, 'test-app');

// Clean previous test app
try {
  rmSync(appDir, { recursive: true, force: true });
} catch {
  // ignore if it doesn't exist
}

// Ensure temp folder exists
mkdirSync(tempDir, { recursive: true });

// Scaffold the app
execSync(`node ${resolve(root, 'dist/cli.js')} create test-app`, {
  cwd: tempDir,
  stdio: 'inherit',
});

// Install dependencies
execSync('npm install', {
  cwd: appDir,
  stdio: 'inherit',
});

// Link local thatopen-services so the test app uses the local build
execSync('npm link thatopen-services', {
  cwd: appDir,
  stdio: 'inherit',
});

console.log('');
console.log('Test app ready! Run:');
console.log('  cd temp/test-app');
console.log('  thatopen dev');
