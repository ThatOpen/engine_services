// description: "File lifecycle — list, get with versions, create, rename, upload new version, download by version, archive, and recover."
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
  const files = await client.listFiles();
  console.log(`\nFound ${files.length} file(s):`);
  for (const file of files) {
    console.log(`  [${file._id}] ${file.name}`);
  }

  // --- Get ---
  if (files.length > 0) {
    const detail = await client.getFile(files[0]._id, { showVersions: true });
    console.log('\nFirst file detail (with versions):');
    console.log(JSON.stringify(detail, null, 2));
  }

  if (!PROJECT_ID) {
    console.log('\nSkipping create/update/download/archive — set PROJECT_ID in .env to run the full cycle.');
    return;
  }

  // --- Create ---
  // projectId is required — the backend rejects uploads without one.
  const fileName = `__example-test__-${Date.now()}.json`;
  const blob = new Blob([JSON.stringify({ test: true })], { type: 'application/json' });
  const created = await client.createFile({ file: blob, name: fileName, versionTag: 'v1', projectId: PROJECT_ID });
  console.log(`\nCreated file: [${created.item._id}] ${created.item.name}`);

  const fileId = created.item._id;

  // --- Update (rename) ---
  const renamed = await client.updateFile(fileId, { name: `${fileName}-renamed` });
  console.log(`\nRenamed to: ${renamed.item?.name}`);

  // --- Update (new version) ---
  const blobV2 = new Blob([JSON.stringify({ test: true, version: 2 })], { type: 'application/json' });
  const versioned = await client.updateFile(fileId, { file: blobV2, versionTag: 'v2' });
  console.log(`\nUploaded new version: ${versioned.version?.tag}`);

  // --- Download ---
  // Without versionTag, always downloads the latest version — not necessarily the one from createFile.
  const response = await client.downloadFile(fileId);
  const text = await response.text();
  console.log(`\nDownloaded content (latest version): ${text}`);

  const responseV1 = await client.downloadFile(fileId, { versionTag: 'v1' });
  const textV1 = await responseV1.text();
  console.log(`Downloaded content (v1): ${textV1}`);

  // --- Archive / Recover ---
  // archiveFile is a soft-delete — the file can be recovered with recoverFile.
  await client.archiveFile(fileId);
  console.log(`\nArchived file [${fileId}]`);

  // recoverFile returns no body — confirm by re-fetching the file.
  await client.recoverFile(fileId);
  const recovered = await client.getFile(fileId);
  console.log(`Recovered file: ${recovered.name}`);

  // Archive again to leave the account clean.
  await client.archiveFile(fileId);
  console.log(`Re-archived test file [${fileId}] — account is clean.`);
}

main().catch(console.error);
