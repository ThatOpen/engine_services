import { Command } from 'commander';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';
import {
  requireResolvedConfig,
  readLocalConfig,
  updateLocalConfig,
} from '../lib/config';
import { createBundleZip } from '../lib/zip';
import { declarationsPath, readDeclarations } from '../lib/declarations';
import { EngineServicesClient } from '../../core/client';
import { RequestError } from '../../core/request-error';

export const publishCommand = new Command('publish')
  .description('Build and publish the project to the ThatOpen platform')
  .option('--name <name>', 'Project name (defaults to package.json name)')
  .option(
    '--version-tag <tag>',
    'Version tag (defaults to package.json version)',
  )
  .option('--app-id <id>', 'Existing app ID to publish a new version for')
  .option(
    '--component-id <id>',
    'Existing component ID to publish a new version for',
  )
  .option('--skip-build', 'Skip the build step')
  .option('--icon <path>', 'Path to an icon file (PNG, WebP, or ICO, max 512 KB)')
  .action(
    async (opts: {
      name?: string;
      versionTag?: string;
      appId?: string;
      componentId?: string;
      skipBuild?: boolean;
      icon?: string;
    }) => {
      const cwd = process.cwd();
      const config = requireResolvedConfig(cwd);
      const localConfig = readLocalConfig(cwd);

      // Determine project type from local config
      const isComponent = localConfig?.itemType === 'COMPONENT';

      // Resolve existing item ID: CLI flag > local config > none (new item)
      const appId = opts.appId || localConfig?.appId;
      const componentId = opts.componentId || localConfig?.componentId;
      const existingId = isComponent ? componentId : appId;

      // Read project package.json
      const pkgPath = join(cwd, 'package.json');
      if (!existsSync(pkgPath)) {
        console.error(
          'No package.json found. Run this from a ThatOpen project.',
        );
        process.exit(1);
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const projectName = opts.name || pkg.name || basename(cwd);
      const versionTag = opts.versionTag || pkg.version || '1.0.0';

      // Build
      if (!opts.skipBuild) {
        console.log('Building...');
        try {
          execSync('npm run build', { cwd, stdio: 'inherit' });
        } catch (err) {
          console.error('Build failed. Fix the errors above and try again.');
          process.exit(1);
        }
      }

      // Check build output
      const bundlePath = join(cwd, 'dist', 'bundle.js');
      if (!existsSync(bundlePath)) {
        console.error(
          'Build output not found at dist/bundle.js. Make sure your vite.config outputs dist/bundle.js.',
        );
        process.exit(1);
      }

      // Cloud components must declare their runtime parameters in a
      // `declarations.json` file at the project root. The file is shipped
      // alongside the bundle so the platform knows what parameters the
      // component accepts.
      let declarationsZipPath: string | undefined;
      if (isComponent) {
        try {
          readDeclarations(cwd);
        } catch (err) {
          console.error((err as Error).message);
          process.exit(1);
        }
        declarationsZipPath = declarationsPath(cwd);
      }

      // Create ZIP
      const zipPath = join(cwd, 'dist', 'bundle.zip');
      console.log('Creating bundle ZIP...');
      try {
        await createBundleZip(bundlePath, zipPath, declarationsZipPath);
      } catch (err) {
        console.error('Failed to create bundle ZIP:', (err as Error).message);
        process.exit(1);
      }

      // Read ZIP as a named File for the client
      const zipBuffer = readFileSync(zipPath);
      const zipFile = new File([zipBuffer], 'bundle.zip', {
        type: 'application/zip',
      });

      // Resolve icon: CLI flag > local config
      const iconPath = opts.icon || localConfig?.iconPath;

      // Upload
      const client = new EngineServicesClient(
        config.accessToken,
        config.apiUrl,
      );

      try {
        let itemId: string | undefined;

        if (isComponent) {
          itemId = await publishComponent(
            client,
            existingId,
            zipFile,
            projectName,
            versionTag,
            cwd,
          );
        } else {
          itemId = await publishApp(
            client,
            existingId,
            zipFile,
            projectName,
            versionTag,
            cwd,
          );
        }

        // Upload icon if specified
        if (iconPath && itemId) {
          await uploadIcon(client, itemId, iconPath, opts.icon, cwd);
        }

        console.log('Published successfully!');
      } catch (err) {
        if (err instanceof RequestError) {
          if (err.code === 'LIMIT_EXCEEDED') {
            console.error(err.message);
          } else if (err.status === 401) {
            console.error(
              'Authentication failed. Check your token with `thatopen login`.',
            );
          } else if (err.status === 403) {
            console.error(`Permission denied: ${err.message}`);
          } else {
            console.error('Upload failed:', err.message);
          }
        } else {
          const message = (err as Error).message || String(err);
          if (
            message.includes('fetch') ||
            message.includes('ECONNREFUSED')
          ) {
            console.error(
              'Could not connect to the platform. Is the API URL correct?',
            );
            console.error(`  API URL: ${config.apiUrl}`);
          } else {
            console.error('Upload failed:', message);
          }
        }
        process.exit(1);
      }
    },
  );

// ---------------------------------------------------------------------------
// App publishing (existing behavior)
// ---------------------------------------------------------------------------

async function publishApp(
  client: EngineServicesClient,
  appId: string | undefined,
  zipFile: File,
  name: string,
  versionTag: string,
  cwd: string,
): Promise<string | undefined> {
  if (appId) {
    // Auto-recover if the app was archived (deleted from UI)
    const existing = await client.getFile(appId);
    if (existing.archived) {
      console.log('App was archived. Recovering...');
      await client.recoverFile(appId);
    }

    console.log(
      `Publishing new version (${versionTag}) for app ${appId}...`,
    );
    const result = await client.createVersion(
      appId,
      zipFile,
      versionTag,
      {}, // extraProps required by backend for APP items
    );
    console.log('Version created:', JSON.stringify(result, null, 2));
    return appId;
  } else {
    console.log(`Publishing new app "${name}" (${versionTag})...`);
    const result = await client.createApp({
      file: zipFile,
      name,
      versionTag,
    });
    console.log('App created:', JSON.stringify(result, null, 2));

    // Auto-save appId to local config for future updates
    const newAppId = result.item?._id;
    if (newAppId) {
      updateLocalConfig({ appId: String(newAppId) }, cwd);
      console.log(`App ID saved to .thatopen (${newAppId})`);
    }
    return newAppId ? String(newAppId) : undefined;
  }
}

// ---------------------------------------------------------------------------
// Component publishing
// ---------------------------------------------------------------------------

async function publishComponent(
  client: EngineServicesClient,
  componentId: string | undefined,
  zipFile: File,
  name: string,
  versionTag: string,
  cwd: string,
): Promise<string | undefined> {
  const componentProps = {
    type: 'CLOUD' as const,
    tier: 'FREE' as const,
    executionEngineVersion: 'v1/thatOpenEngine',
  };

  if (componentId) {
    // Auto-recover if the component was archived (deleted from UI)
    const existing = await client.getComponent(componentId);
    if (existing.archived) {
      console.log('Component was archived. Recovering...');
      await client.recoverComponent(componentId);
    }

    console.log(
      `Publishing new version (${versionTag}) for component ${componentId}...`,
    );
    const result = await client.updateComponent(componentId, {
      file: zipFile,
      versionTag,
      componentProps,
    });
    console.log('Version created:', JSON.stringify(result, null, 2));
    return componentId;
  } else {
    console.log(
      `Publishing new cloud component "${name}" (${versionTag})...`,
    );
    const result = await client.createComponent({
      file: zipFile,
      name,
      versionTag,
      componentProps,
    });
    console.log('Component created:', JSON.stringify(result, null, 2));

    // Auto-save componentId to local config for future updates
    const newId = result.item?._id;
    if (newId) {
      updateLocalConfig({ componentId: String(newId) }, cwd);
      console.log(`Component ID saved to .thatopen (${newId})`);
    }
    return newId ? String(newId) : undefined;
  }
}

// ---------------------------------------------------------------------------
// Icon upload helper
// ---------------------------------------------------------------------------

const ICON_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
const ALLOWED_ICON_EXTENSIONS = Object.keys(ICON_MIME_TYPES);
const MAX_ICON_SIZE = 512 * 1024; // 512 KB

async function uploadIcon(
  client: EngineServicesClient,
  itemId: string,
  iconPath: string,
  cliIconFlag: string | undefined,
  cwd: string,
) {
  const resolvedPath = join(cwd, iconPath);

  if (!existsSync(resolvedPath)) {
    console.error(`Icon file not found: ${resolvedPath}`);
    return;
  }

  const ext = extname(resolvedPath).toLowerCase();
  if (!ALLOWED_ICON_EXTENSIONS.includes(ext)) {
    console.error(`Unsupported icon format "${ext}". Use PNG, WebP, or ICO.`);
    return;
  }

  const size = statSync(resolvedPath).size;
  if (size > MAX_ICON_SIZE) {
    console.error(`Icon too large (${Math.round(size / 1024)} KB). Maximum is 512 KB.`);
    return;
  }

  console.log('Uploading icon...');
  const iconBuffer = readFileSync(resolvedPath);
  const iconFile = new File([iconBuffer], basename(resolvedPath), {
    type: ICON_MIME_TYPES[ext],
  });
  await client.uploadItemIcon(itemId, iconFile);
  console.log('Icon uploaded.');

  // Save icon path to local config if provided via CLI flag
  if (cliIconFlag) {
    updateLocalConfig({ iconPath: iconPath }, cwd);
  }
}
