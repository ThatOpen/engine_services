import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { readLocalConfig, updateLocalConfig } from '../lib/config';
import { BETA_ALIASES } from '../lib/beta';
import { configureBetaNpmrc } from '../lib/npmrc';

export const swapCommand = new Command('swap')
  .description('Toggle between stable public and beta engine libraries')
  .option('--beta', 'Switch to beta libraries')
  .option('--stable', 'Switch to stable public libraries')
  .action(async (opts: { beta?: boolean; stable?: boolean }) => {
    const cwd = process.cwd();

    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) {
      console.error('No package.json found. Run this from a ThatOpen project.');
      process.exit(1);
    }

    const currentlyBeta = readLocalConfig(cwd)?.beta === true;

    let targetBeta: boolean;
    if (opts.beta && opts.stable) {
      console.error('Cannot use --beta and --stable together.');
      process.exit(1);
    } else if (opts.beta) {
      targetBeta = true;
    } else if (opts.stable) {
      targetBeta = false;
    } else {
      targetBeta = !currentlyBeta;
    }

    if (targetBeta === currentlyBeta) {
      console.log(`Already using ${currentlyBeta ? 'beta' : 'stable'} libraries. Nothing to do.`);
      return;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    if (targetBeta) {
      for (const [stable, beta] of Object.entries(BETA_ALIASES)) {
        if (pkg.dependencies?.[stable] !== undefined) {
          delete pkg.dependencies[stable];
          pkg.dependencies[beta] = 'latest';
        }
      }
    } else {
      const cliPkg = JSON.parse(
        readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'),
      );
      for (const [stable, beta] of Object.entries(BETA_ALIASES)) {
        if (pkg.dependencies?.[beta] !== undefined) {
          delete pkg.dependencies[beta];
          pkg.dependencies[stable] =
            cliPkg.devDependencies?.[stable] ?? 'latest';
        }
      }
    }

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    updateLocalConfig({ beta: targetBeta }, cwd);

    console.log(`Switched to ${targetBeta ? 'beta' : 'stable'} libraries.`);

    // Beta packages are private — write an authenticated .npmrc before install.
    if (targetBeta) {
      await configureBetaNpmrc(cwd);
    }

    console.log('');
    console.log('Installing dependencies...');
    try {
      execSync('npm install', { cwd, stdio: 'inherit' });
    } catch {
      console.error('Failed to install dependencies. Run `npm install` manually.');
    }
  });
