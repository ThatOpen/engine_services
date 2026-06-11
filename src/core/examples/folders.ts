// description: "Folder lifecycle — list, get, create nested folders, list files inside a folder, rename, download as ZIP, archive, and recover."
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
  const folders = await client.listFolders();
  console.log(`\nFound ${folders.length} folder(s):`);
  for (const folder of folders) {
    console.log(`  [${folder._id}] ${folder.name}`);
  }

  // --- Get ---
  if (folders.length > 0) {
    const detail = await client.getFolder(folders[0]._id);
    console.log('\nFirst folder detail:');
    console.log(JSON.stringify(detail, null, 2));
  }

  if (!PROJECT_ID) {
    console.log('\nSkipping create/update/download/archive — set PROJECT_ID in .env to run the full cycle.');
    return;
  }

  // --- Create (parent) ---
  const folderName = `__example-test__-${Date.now()}`;
  const parent = await client.createFolder(folderName, undefined, PROJECT_ID);
  console.log(`\nCreated folder: [${parent._id}] ${parent.name}`);

  // --- Create (nested) ---
  // parentId nests the folder inside another — omitting it creates a root-level folder.
  const child = await client.createFolder(`${folderName}-child`, parent._id, PROJECT_ID);
  console.log(`Created nested folder: [${child._id}] ${child.name}`);

  // --- List by parent ---
  // NOTE: listFolders({ parentFolderId }) returned 0 even after creating a child with that parentId.
  // The backend may not index parentFolderId for filtering, or the field name differs internally.
  const children = await client.listFolders({ parentFolderId: parent._id });
  console.log(`\nChildren of [${parent._id}]: ${children.length} folder(s)`);

  // --- List files inside a folder ---
  const filesInFolder = await client.listFiles({ folderId: parent._id });
  console.log(`Files inside folder: ${filesInFolder.length}`);

  // --- Update (rename) ---
  const renamed = await client.updateFolder(parent._id, { name: `${folderName}-renamed` });
  console.log(`\nRenamed to: ${renamed.name}`);

  // --- Download as ZIP ---
  const zip = await client.downloadFolder(parent._id);
  const buffer = await zip.arrayBuffer();
  console.log(`\nDownloaded folder ZIP: ${buffer.byteLength} bytes`);

  // --- Archive / Recover ---
  // archiveFolder is a soft-delete — recoverable with recoverFolder.
  // Archiving a parent does NOT archive its children automatically.
  await client.archiveFolder(child._id);
  console.log(`\nArchived child folder [${child._id}]`);

  await client.recoverFolder(child._id);
  console.log(`Recovered child folder [${child._id}]`);

  // Archive both to clean up.
  await client.archiveFolder(child._id);
  await client.archiveFolder(parent._id);
  console.log(`Re-archived folders — account is clean.`);
}

main().catch(console.error);
