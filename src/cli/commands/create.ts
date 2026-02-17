import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getIndexHtml } from '../templates/index-html';
import { getMainTs } from '../templates/main-js';
import { getMainBim } from '../templates/main-bim';
import { getMainCloud } from '../templates/main-cloud';
import { getViteConfig } from '../templates/vite-config';
import { getPackageJson } from '../templates/package-json';
import { writeLocalConfig } from '../lib/config';

const TEMPLATES = ['default', 'bim', 'cloud'] as const;
type Template = (typeof TEMPLATES)[number];

function getMainSource(template: Template): string {
  switch (template) {
    case 'bim':
      return getMainBim();
    case 'cloud':
      return getMainCloud();
    default:
      return getMainTs();
  }
}

export const createCommand = new Command('create')
  .argument('<project-name>', 'Name of the project to create')
  .option('-t, --template <template>', `Template (${TEMPLATES.join(', ')})`, 'bim')
  .description('Scaffold a new ThatOpen app or cloud component project')
  .action(async (projectName: string, opts: { template: string }) => {
    const template = opts.template as Template;

    if (!TEMPLATES.includes(template)) {
      console.error(`Unknown template "${opts.template}". Available: ${TEMPLATES.join(', ')}`);
      process.exit(1);
    }

    const isCloud = template === 'cloud';
    const projectKind = isCloud ? 'cloud component' : 'app';

    const targetDir = resolve(process.cwd(), projectName);

    if (existsSync(targetDir)) {
      console.error(`Directory "${projectName}" already exists.`);
      process.exit(1);
    }

    console.log(`Creating ThatOpen ${projectKind} "${projectName}" (template: ${template})...`);

    mkdirSync(targetDir, { recursive: true });
    mkdirSync(join(targetDir, 'src'));

    // Cloud components don't need index.html
    if (!isCloud) {
      writeFileSync(join(targetDir, 'index.html'), getIndexHtml());
    }

    writeFileSync(join(targetDir, 'src', 'main.ts'), getMainSource(template));
    writeFileSync(join(targetDir, 'vite.config.js'), getViteConfig(template));
    writeFileSync(join(targetDir, 'package.json'), getPackageJson(projectName, template));
    writeFileSync(
      join(targetDir, '.gitignore'),
      'node_modules\ndist\n*.zip\n.thatopen\n',
    );

    // Write itemType marker for cloud projects so publish/run know the project type
    if (isCloud) {
      writeLocalConfig(
        { accessToken: '', apiUrl: '', itemType: 'COMPONENT' },
        targetDir,
      );
    }

    console.log('');
    console.log(`  Created ./${projectName}`);
    console.log('');
    console.log('  Next steps:');
    console.log(`    cd ${projectName}`);
    console.log('    npm install');
    if (isCloud) {
      console.log('    npm run login -- --token <token>     # Authenticate');
      console.log('    npm run run                          # Test locally');
      console.log('    npm run publish                      # First publish');
      console.log('    npm run update                       # Publish new version');
    } else {
      console.log('    npm run dev                          # Start local dev server');
      console.log('    npm run login -- --token <token>     # Authenticate');
      console.log('    npm run publish                      # First publish (saves app ID)');
      console.log('    npm run update                       # Publish new version');
    }
    console.log('');
  });
