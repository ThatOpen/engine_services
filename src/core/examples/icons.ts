// description: "Item icon management — upload, download, and remove icons on any item (file, app, or component)."
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

  // Create a test file to attach an icon to.
  const blob = new Blob([JSON.stringify({ test: true })], { type: 'application/json' });
  const fileName = `__example-test__-${Date.now()}.json`;
  const created = await client.createFile({ file: blob, name: fileName, versionTag: 'v1', projectId: PROJECT_ID });
  const itemId = created.item._id;
  console.log(`\nCreated test file: [${itemId}] ${created.item.name}`);

  // --- Upload icon ---
  // Accepted formats: PNG, WebP, or ICO — max 512 KB.
  // uploadItemIcon replaces any existing icon; there is no separate "update icon" method.
  const iconPng = generateMinimalPng();
  const updated = await client.uploadItemIcon(itemId, iconPng);
  console.log(`\nUploaded icon. iconFileId: ${updated.iconFileId}, mimeType: ${updated.iconMimeType}`);

  // --- Download icon ---
  const iconResponse = await client.getItemIcon(itemId);
  const iconBuffer = await iconResponse.arrayBuffer();
  console.log(`\nDownloaded icon: ${iconBuffer.byteLength} bytes`);

  // --- Remove icon ---
  const removed = await client.removeItemIcon(itemId);
  console.log(`\nRemoved icon. iconFileId: ${removed.iconFileId ?? 'null'}`);

  // --- Cleanup ---
  await client.archiveFile(itemId);
  console.log(`\nArchived test file [${itemId}] — account is clean.`);
}

// Generates the smallest valid PNG (1x1 transparent pixel) as a Blob.
function generateMinimalPng(): Blob {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, // bit depth=8, colorType=6 (RGBA)
    0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, // IHDR CRC + IDAT chunk
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, // IDAT data (zlib compressed)
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, // IDAT CRC
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, // IEND chunk
    0x60, 0x82,
  ]);
  return new Blob([bytes], { type: 'image/png' });
}

main().catch(console.error);
