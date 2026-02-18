import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read the library version from package.json so templates stay in sync. */
const libVersion: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export function getPackageJson(appName: string, template?: string): string {
  if (template === 'cloud') {
    const pkg: Record<string, unknown> = {
      name: appName,
      version: '1.0.0',
      private: true,
      scripts: {
        build: 'vite build',
        run: 'thatopen run',
        'local-server': 'thatopen local-server',
        login: 'thatopen login --local',
        publish: 'thatopen publish',
      },
      dependencies: {
        '@thatopen/components': '^3.3.1',
        'thatopen-services': `^${libVersion}`,
        three: '^0.182.0',
      } as Record<string, string>,
      devDependencies: {
        '@types/three': '^0.182.0',
        typescript: '^5.2.0',
        vite: '^5.2.0',
      } as Record<string, string>,
    };
    return JSON.stringify(pkg, null, 2);
  }

  const pkg: Record<string, unknown> = {
    name: appName,
    version: '1.0.0',
    private: true,
    scripts: {
      dev: 'thatopen serve',
      build: 'vite build',
      login: 'thatopen login --local',
      publish: 'thatopen publish',
    },
    devDependencies: {
      typescript: '^5.2.0',
      vite: '^5.2.0',
    } as Record<string, string>,
  };

  if (template === 'bim') {
    (pkg.dependencies as Record<string, string>) = {
      '@thatopen/components': '^3.3.1',
      '@thatopen/components-front': '^3.3.1',
      '@thatopen/fragments': '^3.3.1',
      '@thatopen/ui': '^3.3.3',
      '@thatopen/ui-obc': '^3.3.3',
      'thatopen-services': `^${libVersion}`,
      three: '^0.182.0',
    };
    (pkg.devDependencies as Record<string, string>)['@types/three'] = '^0.182.0';
  }

  return JSON.stringify(pkg, null, 2);
}
