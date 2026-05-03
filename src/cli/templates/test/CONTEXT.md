# ThatOpen Platform API Test Suite (App)

This is a test app that exercises every EngineServicesClient endpoint to verify the
That Open Platform is working correctly. It runs in the browser inside the platform's
iframe and renders a test results dashboard.

## How this app works

- **Entry point**: `src/main.ts` — an IIFE loaded by the platform.
- **Build output**: `dist/bundle.js` — built by Vite.
- **Platform context**: The platform injects `window.__THATOPEN_CONTEXT__` with
  `appId`, `projectId`, `accessToken`, and `apiUrl`.
- **Mount point**: Renders into `#that-open-app` in `index.html`.

## What it tests

The test suite covers every API group in EngineServicesClient:

| Group | Endpoints tested |
|-------|-----------------|
| **Context & Auth** | Validates all context fields are present |
| **Projects** | getProject, getProjectData, checkPermission |
| **Folders** | createFolder, getFolder, listFolders, updateFolder, archiveFolder, recoverFolder, downloadFolder |
| **Files** | createFile, getFile, listFiles, downloadFile, getFileVersionMetadata, updateFileVersionMetadata, deleteFileVersionMetadata, updateFile, archiveFile, recoverFile |
| **Hidden Files** | createHiddenFile, getHiddenFile, getHiddenFilesByParent, downloadHiddenFile, deleteHiddenFile, deleteHiddenFilesByParent |
| **Icons** | uploadItemIcon, getItemIcon, removeItemIcon |
| **General Items** | updateItem, createVersion |
| **Components** | createComponent, getComponent, listComponents, updateComponent, downloadComponent, downloadComponentBundle, archiveComponent, recoverComponent |
| **Apps** | createApp, listApps, downloadApp, downloadAppBundle, archiveApp |
| **Execution** | executeComponent, getExecution, listExecutions, onExecutionProgress, abortExecution |
| **Built-in** | getBuiltInComponent |

## Running

1. Publish to the platform: `npm run publish`
2. Open the app in a project on the platform
3. Click **Run All Tests**
4. Review the pass/fail results

## Commands

```bash
npm run dev        # Start dev server
npm run build      # Build dist/bundle.js
npm run login      # Authenticate with the platform
npm run publish    # Publish to the platform
```

## Cleanup

The test suite creates temporary folders, files, components, apps, and hidden files
during execution. All test resources are archived (soft-deleted) after tests complete.
The execution tests use the test component created in the Components test group.
