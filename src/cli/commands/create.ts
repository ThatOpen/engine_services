import { Command } from 'commander';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, renameSync, cpSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { updateLocalConfig } from '../lib/config';
import { BETA_ALIASES } from '../lib/beta';
import { configureBetaNpmrc } from '../lib/npmrc';

const TEMPLATES = ['app', 'cloud-component'] as const;
type Template = (typeof TEMPLATES)[number];

/** Read the library version from package.json so templates stay in sync. */
const libVersion: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const templatesDir = join(__dirname, '..', 'src', 'cli', 'templates');

export const createCommand = new Command('create')
  .argument('<project-name>', 'Name of the project to create (use "." for current directory)')
  .option('-t, --template <template>', `Template (${TEMPLATES.join(', ')})`, 'app')
  .option('--beta', 'Use beta engine libraries (@thatopen-platform/*-beta)')
  .description('Scaffold a new ThatOpen app or cloud component project')
  .action(async (projectName: string, opts: { template: string; beta?: boolean }) => {
    const template = opts.template as Template;

    if (!TEMPLATES.includes(template)) {
      console.error(`Unknown template "${opts.template}". Available: ${TEMPLATES.join(', ')}`);
      process.exit(1);
    }

    const isCloud = template === 'cloud-component';
    const projectKind = isCloud ? 'cloud component' : 'app';
    const useCurrentDir = projectName === '.';

    const targetDir = useCurrentDir
      ? process.cwd()
      : resolve(process.cwd(), projectName);

    const packageName = useCurrentDir
      ? basename(process.cwd())
      : projectName;

    if (!useCurrentDir && existsSync(targetDir)) {
      console.error(`Directory "${projectName}" already exists.`);
      process.exit(1);
    }

    console.log(`Creating ThatOpen ${projectKind} "${packageName}" (template: ${template}${opts.beta ? ', beta' : ''})...`);

    if (!useCurrentDir) {
      mkdirSync(targetDir, { recursive: true });
    }
    mkdirSync(join(targetDir, 'src'), { recursive: true });

    // ── Shared files ─────────────────────────────────────────────
    const sharedDir = join(templatesDir, 'shared');
    copyFileSync(join(sharedDir, '_gitignore'), join(targetDir, '.gitignore'));
    copyFileSync(join(sharedDir, 'AGENTS.md'), join(targetDir, 'AGENTS.md'));
    copyFileSync(join(sharedDir, 'CLAUDE.md'), join(targetDir, 'CLAUDE.md'));

    // ── Template-specific files ───────────────────────────────────
    const templateDir = join(templatesDir, template);
    cpSync(templateDir, targetDir, { recursive: true });

    // Cloud: rename _thatopen → .thatopen
    if (isCloud) {
      renameSync(join(targetDir, '_thatopen'), join(targetDir, '.thatopen'));
    }

    // ── Replace placeholders in package.json ─────────────────────
    const pkgPath = join(targetDir, 'package.json');
    const pkgContent = readFileSync(pkgPath, 'utf-8')
      .replace(/\{\{PROJECT_NAME\}\}/g, packageName)
      .replace(/\{\{VERSION\}\}/g, libVersion)
      .replace(/"@thatopen\/services": "file:[^"]*"/, `"@thatopen/services": "^${libVersion}"`);
    writeFileSync(pkgPath, pkgContent);

    // ── Beta: swap packages and mark .thatopen ────────────────────
    if (opts.beta) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      for (const [stable, beta] of Object.entries(BETA_ALIASES)) {
        if (pkg.dependencies?.[stable] !== undefined) {
          delete pkg.dependencies[stable];
          pkg.dependencies[beta] = 'latest';
        }
      }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
      updateLocalConfig({ beta: true }, targetDir);
    }

    // ── Beta: authenticate private installs via .npmrc ───────────
    if (opts.beta) {
      await configureBetaNpmrc(targetDir);
    }

    // Install dependencies automatically
    console.log('');
    console.log('Installing dependencies...');
    try {
      execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
    } catch {
      console.error('Failed to install dependencies. Run `npm install` manually.');
    }

    console.log('');
    console.log(useCurrentDir ? '  Project ready!' : `  Created ./${projectName}`);
    console.log('');
    console.log('  Next steps:');
    if (!useCurrentDir) {
      console.log(`    cd ${projectName}`);
    }
    if (isCloud) {
      console.log('    npm run login -- --token <token>     # Authenticate');
      console.log('    npm run run                          # Test locally');
      console.log('    npm run publish                      # Publish to the platform');
    } else {
      console.log('    npm run dev                          # Start dev server + open in platform');
      console.log('    npm run login -- --token <token>     # Authenticate');
      console.log('    npm run publish                      # Publish to the platform');
    }
    console.log('');
  });
