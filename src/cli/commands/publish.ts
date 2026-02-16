import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import {
  requireResolvedConfig,
  readLocalConfig,
  updateLocalConfig,
} from '../lib/config';
import { createBundleZip } from '../lib/zip';
import { EngineServicesClient } from '../../core/client';

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
  .action(
    async (opts: {
      name?: string;
      versionTag?: string;
      appId?: string;
      componentId?: string;
      skipBuild?: boolean;
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

      // Create ZIP
      const zipPath = join(cwd, 'dist', 'bundle.zip');
      console.log('Creating bundle ZIP...');
      try {
        await createBundleZip(bundlePath, zipPath);
      } catch (err) {
        console.error('Failed to create bundle ZIP:', (err as Error).message);
        process.exit(1);
      }

      // Read ZIP as Blob for the client
      const zipBuffer = readFileSync(zipPath);
      const zipBlob = new Blob([zipBuffer]);

      // Upload
      const client = new EngineServicesClient(
        config.accessToken,
        config.apiUrl,
      );

      try {
        if (isComponent) {
          await publishComponent(
            client,
            existingId,
            zipBlob,
            projectName,
            versionTag,
            cwd,
          );
        } else {
          await publishApp(
            client,
            existingId,
            zipBlob,
            projectName,
            versionTag,
            cwd,
          );
        }

        console.log('Published successfully!');
      } catch (err) {
        const message = (err as Error).message || String(err);
        if (message.includes('401') || message.includes('403')) {
          console.error(
            'Authentication failed. Check your token with `thatopen login`.',
          );
        } else if (
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
  zipBlob: Blob,
  name: string,
  versionTag: string,
  cwd: string,
) {
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
      zipBlob,
      versionTag,
      {}, // extraProps required by backend for APP items
    );
    console.log('Version created:', JSON.stringify(result, null, 2));
  } else {
    console.log(`Publishing new app "${name}" (${versionTag})...`);
    const result = await client.createApp({
      file: zipBlob,
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
  }
}

// ---------------------------------------------------------------------------
// Component publishing
// ---------------------------------------------------------------------------

async function publishComponent(
  client: EngineServicesClient,
  componentId: string | undefined,
  zipBlob: Blob,
  name: string,
  versionTag: string,
  cwd: string,
) {
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
      file: zipBlob,
      versionTag,
      componentProps,
    });
    console.log('Version created:', JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Publishing new cloud component "${name}" (${versionTag})...`,
    );
    const result = await client.createComponent({
      file: zipBlob,
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
  }
}
