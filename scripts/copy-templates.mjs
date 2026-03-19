import { cpSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', 'src', 'cli', 'templates');
const dest = join(__dirname, '..', 'dist', 'templates');

if (existsSync(dest)) {
  rmSync(dest, { recursive: true });
}
cpSync(src, dest, { recursive: true });
console.log('Templates copied to dist/templates/');
