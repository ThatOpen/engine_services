// description: "Cloud component lifecycle — list, get with versions, create, update, download bundle, archive, and recover."
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
  const components = await client.listComponents();
  console.log(`\nFound ${components.length} component(s):`);
  for (const c of components) {
    console.log(`  [${c._id}] ${c.name}`);
  }

  // --- Get ---
  if (components.length > 0) {
    const detail = await client.getComponent(components[0]._id, { showVersions: true });
    console.log('\nFirst component detail (with versions):');
    console.log(JSON.stringify(detail, null, 2));
  }

  if (!PROJECT_ID) {
    console.log('\nSkipping create/update/download/archive — set PROJECT_ID in .env to run the full cycle.');
    return;
  }

  // --- Create ---
  // componentProps is required for TOOL items — the backend rejects creation without it.
  // The file must be a valid ZIP produced by the thatopen CLI toolchain (`thatopen publish`).
  // Uploading a raw JS blob returns 422 — use a real built component ZIP here.
  const bundle = new Blob(['export async function main() { return { type: "SUCCESS", message: "ok" }; }'], { type: 'application/javascript' });
  const componentName = `__example-test__-${Date.now()}`;
  const created = await client.createComponent({
    file: bundle,
    name: componentName,
    versionTag: 'v1',
    projectId: PROJECT_ID,
    componentProps: { type: 'CLOUD', tier: 'FREE', isPublic: false },
  });
  console.log(`\nCreated component: [${created.item._id}] ${created.item.name}`);

  const componentId = created.item._id;

  // --- Update (rename) ---
  const renamed = await client.updateComponent(componentId, { name: `${componentName}-renamed` });
  console.log(`\nRenamed to: ${renamed.item?.name}`);

  // --- Update (new version) ---
  const bundleV2 = new Blob(['export async function main() { return { type: "SUCCESS", message: "v2" }; }'], { type: 'application/javascript' });
  const versioned = await client.updateComponent(componentId, {
    file: bundleV2,
    versionTag: 'v2',
    componentProps: { type: 'CLOUD', tier: 'FREE', isPublic: false },
  });
  console.log(`\nUploaded new version: ${versioned.version?.tag}`);

  // --- Download bundle ---
  // downloadComponentBundle extracts only the JS bundle from the ZIP — not the full archive.
  const bundleResponse = await client.downloadComponentBundle(componentId);
  const bundleText = await bundleResponse.text();
  console.log(`\nDownloaded bundle (latest): ${bundleText.slice(0, 80)}...`);

  const bundleV1Response = await client.downloadComponentBundle(componentId, { versionTag: 'v1' });
  const bundleV1Text = await bundleV1Response.text();
  console.log(`Downloaded bundle (v1): ${bundleV1Text.slice(0, 80)}...`);

  // --- Archive / Recover ---
  // archiveComponent is a soft-delete — recoverable with recoverComponent.
  await client.archiveComponent(componentId);
  console.log(`\nArchived component [${componentId}]`);

  await client.recoverComponent(componentId);
  console.log('Recovered component.');

  // Archive again to clean up.
  await client.archiveComponent(componentId);
  console.log(`Re-archived component — account is clean.`);
}

main().catch(console.error);
