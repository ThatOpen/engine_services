// description: "Permission checks — single and batch permission verification using PlatformClient (requires user JWT, not API token)."
import { config } from 'dotenv';
import { resolve } from 'path';
import { PlatformClient } from '../platform-client';

config({ path: resolve(__dirname, '.env') });

const API_URL = process.env.API_URL;
const PROJECT_ID = process.env.PROJECT_ID;

// PlatformClient requires a user JWT — not the API token used by EngineServicesClient.
// To run this example:
//   1. Open the platform in your browser and log in.
//   2. Open DevTools → Network → click any /api request.
//   3. Copy the Authorization header value (without the "Bearer " prefix).
//   4. Set it as JWT in src/core/examples/.env.
const JWT = process.env.JWT;

if (!API_URL) {
  throw new Error('API_URL is required in src/core/examples/.env');
}

if (!JWT) {
  throw new Error(
    'JWT is required to run permissions.ts.\n' +
    'Get it from DevTools → Network → any /api request → Authorization header (without "Bearer ").\n' +
    'Set it as JWT in src/core/examples/.env.',
  );
}

if (!PROJECT_ID) {
  throw new Error('PROJECT_ID is required in src/core/examples/.env');
}

async function main() {
  // PlatformClient extends EngineServicesClient and forces useBearer: true.
  // It owns the JWT-only routes — checkPermission, checkPermissionBatch, getProject, getProjectData.
  // These routes are guarded server-side and are not reachable with an API token.
  const client = new PlatformClient(JWT!, API_URL!);

  // --- Single permission check ---
  const result = await client.checkPermission({
    resourceType: 'STORAGE',
    action: 'READ',
    projectId: PROJECT_ID,
  });
  console.log('\nSTORAGE:READ check:');
  console.log(`  hasPermission: ${result.hasPermission}`);
  // scope indicates HOW the permission was granted:
  //   'global'  — admin/owner bypass
  //   'project' — role-level grant on the project
  //   'entity'  — per-entity override
  //   'none'    — denied
  console.log(`  scope: ${result.scope}`);

  // --- Batch permission check ---
  // Evaluates multiple checks in a single round-trip — useful to hydrate
  // action visibility for many rows without N+1 calls.
  const checks = [
    { resourceType: 'STORAGE', action: 'READ', projectId: PROJECT_ID },
    { resourceType: 'STORAGE', action: 'WRITE', projectId: PROJECT_ID },
    { resourceType: 'STORAGE', action: 'DELETE', projectId: PROJECT_ID },
  ];
  const results = await client.checkPermissionBatch(checks);
  console.log('\nBatch permission check:');
  for (let i = 0; i < checks.length; i++) {
    const { resourceType, action } = checks[i];
    const { hasPermission, scope } = results[i];
    console.log(`  ${resourceType}:${action} → hasPermission: ${hasPermission}, scope: ${scope}`);
  }

  // --- Get project ---
  const project = await client.getProject(PROJECT_ID!);
  console.log('\nProject:');
  console.log(JSON.stringify(project, null, 2));

  // --- Get project data ---
  // getProjectData returns the full project snapshot: users, roles, files, folders.
  // User data is stripped of sensitive fields server-side.
  const data = await client.getProjectData(PROJECT_ID!);
  console.log('\nProject data (summary):');
  console.log(`  users: ${data.users?.length ?? 0}`);
  console.log(`  files: ${data.files?.length ?? 0}`);
  console.log(`  folders: ${data.folders?.length ?? 0}`);
}

main().catch(console.error);
