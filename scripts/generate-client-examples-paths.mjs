import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(import.meta.dirname, '..');
const EXAMPLES_DIR = join(ROOT, 'src/core/examples');
const OUTPUT = join(ROOT, 'docs/client/paths.json');

const files = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith('.ts') && !f.startsWith('.'));

const entries = [];

for (const file of files.sort()) {
  const content = readFileSync(join(EXAMPLES_DIR, file), 'utf-8');
  const match = content.match(/^\/\/\s*description:\s*"([^"]+)"/m);
  if (!match) {
    console.warn(`  warn: no description comment in ${file} — skipping`);
    continue;
  }
  entries.push({
    path: relative(ROOT, join(EXAMPLES_DIR, file)).replace(/\\/g, '/'),
    description: match[1],
  });
}

import { mkdirSync, existsSync } from 'fs';
const outDir = join(ROOT, 'docs/client');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

writeFileSync(OUTPUT, JSON.stringify(entries, null, 2) + '\n');
console.log(`Generated ${OUTPUT} with ${entries.length} entries.`);
