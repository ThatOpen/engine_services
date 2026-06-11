// description: "App lifecycle — list, get with versions, create, download bundle, and archive."
import { config } from 'dotenv';
import { resolve } from 'path';
import { EngineServicesClient } from '../client';

config({ path: resolve(__dirname, '.env') });

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const API_URL = process.env.API_URL;
const PROJECT_ID = process.env.PROJECT_ID;

if (!ACCESS_TOKEN || !API_URL) {
  throw new Error('ACCESS_TOKEN and API_URL are required in src/core/examples/.env');
}

async function main() {
  const client = new EngineServicesClient(ACCESS_TOKEN!, API_URL!);

  // --- List ---
  const apps = await client.listApps();
  console.log(`\nFound ${apps.length} app(s):`);
  for (const app of apps) {
    console.log(`  [${app._id}] ${app.name}`);
  }

  // --- Get ---
  if (apps.length > 0) {
    const detail = await client.listApps({ ShowVersions: true });
    console.log('\nFirst app detail (with versions):');
    console.log(JSON.stringify(detail[0], null, 2));
  }

  if (!PROJECT_ID) {
    console.log('\nSkipping create/download/archive — set PROJECT_ID in .env to run the full cycle.');
    return;
  }

  // --- Create ---
  // The file must be a valid ZIP produced by the thatopen CLI toolchain (`thatopen publish`).
  // Uploading an invalid or empty ZIP causes the server to close the connection — use a real built app ZIP here.
  // appProps is optional; omitting it uses platform defaults.
  const bundle = new Blob([''], { type: 'application/zip' });
  const appName = `__example-test__-${Date.now()}`;
  const created = await client.createApp({
    file: bundle,
    name: appName,
    versionTag: 'v1',
    projectId: PROJECT_ID,
  });
  console.log(`\nCreated app: [${created.item._id}] ${created.item.name}`);

  const appId = created.item._id;

  // --- Download bundle ---
  // downloadAppBundle extracts only the JS bundle from the ZIP — not the full archive.
  const bundleResponse = await client.downloadAppBundle(appId);
  const bundleText = await bundleResponse.text();
  console.log(`\nDownloaded bundle (latest): ${bundleText.slice(0, 80)}...`);

  // --- Archive ---
  // archiveApp is a soft-delete. Unlike files and components, there is no recoverApp method —
  // archived apps can only be managed via the platform UI.
  await client.archiveApp(appId);
  console.log(`\nArchived app [${appId}] — account is clean.`);
}

main().catch(console.error);
