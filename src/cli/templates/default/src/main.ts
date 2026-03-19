// ThatOpen App — Default Template
//
// This is a minimal app that runs inside the That Open Platform.
// It renders into the #that-open-app element in index.html.
//
// Platform context (client.context):
//   appId       — this app's unique identifier
//   projectId   — the project this app belongs to
//   accessToken — Auth0 JWT for API calls
//   apiUrl      — base URL for the That Open API
//
// To add BIM capabilities (3D viewer, model loading), install:
//   npm install @thatopen/components @thatopen/ui three thatopen-services
// Then see the "bim" template for the full pattern.

import { EngineServicesClient } from "thatopen-services";
import type { ThatOpenContext, ProjectData } from "thatopen-services";

declare global {
  interface Window {
    __THATOPEN_CONTEXT__?: ThatOpenContext;
  }
}

async function main() {
  const app = document.getElementById('that-open-app')!;

  // ─── Engine Services Client ───────────────────────────────────
  // Reads the auth context from window.__THATOPEN_CONTEXT__ (injected
  // by the platform) and creates a client with Bearer auth.
  const client = EngineServicesClient.fromPlatformContext();

  // ─── Project Data ───────────────────────────────────────────────
  // Fetches project data (users, roles, files, folders) in one call.
  let projectData: ProjectData | null = null;
  if (client.context.projectId) {
    try {
      projectData = await client.getProjectData(client.context.projectId);
    } catch (err) {
      console.warn("Could not fetch project data:", err);
    }
  }

  const projectTitle = projectData?.project.title || 'N/A';
  const userName = projectData?.currentUser?.user.fullName || 'N/A';
  const membersCount = projectData?.users.length ?? 0;
  const filesCount = projectData?.files.length ?? 0;

  // Render the app. Replace this with your own UI.
  app.innerHTML = `
    <div style="padding: 32px; font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6528e0; margin-bottom: 16px;">My ThatOpen App</h1>
      <p style="margin-bottom: 8px;"><strong>Project:</strong> ${projectTitle}</p>
      <p style="margin-bottom: 8px;"><strong>User:</strong> ${userName}</p>
      <p style="margin-bottom: 8px;"><strong>Members:</strong> ${membersCount}</p>
      <p style="margin-bottom: 8px;"><strong>Files:</strong> ${filesCount}</p>
      <p style="color: #888; margin-top: 24px;">Edit <code>src/main.ts</code> to start building your app.</p>
    </div>
  `;
}

main().catch(console.error);
