// description: "File metadata and versioning — get, update, and delete per-version metadata; list, archive, recover, and permanently delete versions."
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

  if (!PROJECT_ID) {
    console.log('Set PROJECT_ID in .env to run this example.');
    return;
  }

  // Create a test file to work with.
  const blob = new Blob([JSON.stringify({ test: true })], { type: 'application/json' });
  const fileName = `__example-test__-${Date.now()}.json`;
  const created = await client.createFile({ file: blob, name: fileName, versionTag: 'v1', projectId: PROJECT_ID });
  const fileId = created.item._id;
  console.log(`\nCreated test file: [${fileId}] ${created.item.name}`);

  // --- Get metadata (empty on a fresh version) ---
  // Returns {} when the version exists but has no metadata yet — not null or 404.
  const empty = await client.getFileVersionMetadata(fileId, 'v1');
  console.log(`\nMetadata on v1 (fresh): ${JSON.stringify(empty)}`);

  // --- Update metadata ---
  const updated = await client.updateFileVersionMetadata(fileId, 'v1', {
    discipline: 'structural',
    approved: 'true',
  });
  console.log(`\nUpdated metadata: ${JSON.stringify(updated)}`);

  // --- Get metadata (after update) ---
  const meta = await client.getFileVersionMetadata(fileId, 'v1');
  console.log(`\nMetadata on v1 (after update): ${JSON.stringify(meta)}`);

  // --- Upload a second version and set metadata on it ---
  const blobV2 = new Blob([JSON.stringify({ test: true, version: 2 })], { type: 'application/json' });
  await client.updateFile(fileId, { file: blobV2, versionTag: 'v2' });
  await client.updateFileVersionMetadata(fileId, 'v2', { discipline: 'architecture' });
  console.log('\nUploaded v2 with its own metadata.');

  // Metadata is per-version — each version holds its own independent metadata object.
  const metaV1 = await client.getFileVersionMetadata(fileId, 'v1');
  const metaV2 = await client.getFileVersionMetadata(fileId, 'v2');
  console.log(`\nv1 metadata: ${JSON.stringify(metaV1)}`);
  console.log(`v2 metadata: ${JSON.stringify(metaV2)}`);

  // --- List versions ---
  const versions = await client.listVersions(fileId);
  console.log(`\nVersions (${versions.length}):`);
  for (const v of versions) {
    console.log(`  [${v.tag}] created: ${v.createdAt}`);
  }

  // --- Archive a version ---
  // A version must be archived before it can be permanently deleted.
  await client.archiveVersion(fileId, 'v1');
  console.log('\nArchived v1.');

  const versionsAfterArchive = await client.listVersions(fileId, { archived: false });
  console.log(`Active versions after archiving v1: ${versionsAfterArchive.map(v => v.tag).join(', ')}`);

  // --- Recover a version ---
  await client.recoverVersion(fileId, 'v1');
  console.log('Recovered v1.');

  // --- Delete metadata ---
  await client.deleteFileVersionMetadata(fileId, 'v1');
  const afterDelete = await client.getFileVersionMetadata(fileId, 'v1');
  console.log(`\nMetadata on v1 after delete: ${JSON.stringify(afterDelete)}`);

  // --- Delete a version permanently ---
  // archiveVersion first is required — deleteVersion on an active version returns an error.
  await client.archiveVersion(fileId, 'v1');
  await client.deleteVersion(fileId, 'v1');
  console.log('\nPermanently deleted v1.');

  // --- Cleanup ---
  await client.archiveFile(fileId);
  console.log(`\nArchived test file [${fileId}] — account is clean.`);
}

main().catch(console.error);
