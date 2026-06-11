// description: "Hidden file lifecycle — create, get, list by parent, download, and delete."
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

  // Hidden files are always attached to a parent item — they have no standalone existence.
  // Create a parent file to work with.
  const parentBlob = new Blob([JSON.stringify({ test: true })], { type: 'application/json' });
  const parentName = `__example-test__-${Date.now()}.json`;
  const parent = await client.createFile({ file: parentBlob, name: parentName, versionTag: 'v1', projectId: PROJECT_ID });
  const parentId = parent.item._id;
  console.log(`\nCreated parent file: [${parentId}] ${parent.item.name}`);

  // --- Create hidden files ---
  const hiddenBlob1 = new Blob([JSON.stringify({ hidden: 1 })], { type: 'application/json' });
  const hiddenBlob2 = new Blob([JSON.stringify({ hidden: 2 })], { type: 'application/json' });

  const hidden1 = await client.createHiddenFile(hiddenBlob1, parentId);
  console.log(`\nCreated hidden file 1: [${hidden1.hiddenFileId}]`);

  const hidden2 = await client.createHiddenFile(hiddenBlob2, parentId);
  console.log(`Created hidden file 2: [${hidden2.hiddenFileId}]`);

  // --- Get ---
  const fetched = await client.getHiddenFile(hidden1.hiddenFileId);
  console.log(`\nHidden file 1 detail:`);
  console.log(JSON.stringify(fetched, null, 2));

  // --- List by parent ---
  const allHidden = await client.getHiddenFilesByParent(parentId);
  console.log(`\nHidden files attached to parent: ${allHidden.length}`);
  for (const h of allHidden) {
    console.log(`  [${h._id}]`);
  }

  // --- Download ---
  const response = await client.downloadHiddenFile(hidden1.hiddenFileId);
  const text = await response.text();
  console.log(`\nDownloaded hidden file 1: ${text}`);

  // --- Delete one ---
  await client.deleteHiddenFile(hidden1.hiddenFileId);
  console.log(`\nDeleted hidden file 1 [${hidden1.hiddenFileId}]`);

  // NOTE: getHiddenFilesByParent may still return deleted files immediately after deletion —
  // the backend list appears to be eventually consistent.
  const afterDelete = await client.getHiddenFilesByParent(parentId);
  console.log(`Hidden files remaining: ${afterDelete.length}`);

  // --- Delete all by parent ---
  // deleteHiddenFilesByParent removes all hidden files attached to the parent in one call.
  await client.deleteHiddenFilesByParent(parentId);
  console.log(`\nDeleted all remaining hidden files for parent [${parentId}]`);

  const afterDeleteAll = await client.getHiddenFilesByParent(parentId);
  console.log(`Hidden files remaining: ${afterDeleteAll.length}`);

  // --- Cleanup ---
  await client.archiveFile(parentId);
  console.log(`\nArchived parent file [${parentId}] — account is clean.`);
}

main().catch(console.error);
