export function getPackageJson(appName: string, template?: string): string {
  const pkg: Record<string, unknown> = {
    name: appName,
    version: '1.0.0',
    private: true,
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    devDependencies: {
      typescript: '^5.2.0',
      vite: '^5.2.0',
    } as Record<string, string>,
  };

  if (template === 'bim') {
    (pkg.dependencies as Record<string, string>) = {
      '@thatopen/components': '^3.3.1',
      '@thatopen/ui': '^3.3.3',
      'thatopen-services': '^0.6.1',
      three: '^0.182.0',
    };
  }

  return JSON.stringify(pkg, null, 2);
}
