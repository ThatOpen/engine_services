# ThatOpen Platform API Test Suite (Cloud Component)

This is a cloud component that exercises every EngineServicesClient endpoint from a
server-side context. It verifies that the platform API and runtime globals work correctly.

## How this component works

- **Entry point**: `src/main.ts` — exports `async function main()`.
- **Build output**: `dist/bundle.js` — an IIFE built by Vite with platform deps externalized.
- **Execution**: The platform (or `thatopen run` locally) calls `main()`.

## What it tests

| Group | Endpoints tested |
|-------|-----------------|
| **Runtime Globals** | thatOpenServices, executionParams, executionReporter, OBC, THREE, fs |
| **Folders** | createFolder, getFolder, listFolders, updateFolder, archiveFolder, recoverFolder, downloadFolder |
| **Files** | createFile, getFile, listFiles, downloadFile, getFileVersionMetadata, updateFileVersionMetadata, deleteFileVersionMetadata, updateFile, archiveFile, recoverFile |
| **Hidden Files** | createHiddenFile, getHiddenFile, getHiddenFilesByParent, downloadHiddenFile, deleteHiddenFile, deleteHiddenFilesByParent |
| **Icons** | uploadItemIcon, getItemIcon, removeItemIcon |
| **General Items** | updateItem, createVersion |
| **Components** | createComponent, getComponent, listComponents, updateComponent, downloadComponent, downloadComponentBundle, archiveComponent, recoverComponent |
| **Apps** | createApp, listApps, downloadApp, downloadAppBundle, archiveApp |
| **Execution** | executeComponent, getExecution, listExecutions, onExecutionProgress, abortExecution |
| **Built-in** | getBuiltInComponent |

## Running locally

```bash
npm run run            # Build and run once
npm run local-server   # Start local execution server
```

## Running on the platform

```bash
npm run login          # Authenticate
npm run publish        # Publish to the platform
```

Then execute via the platform UI or from another app:
```ts
const { executionId } = await client.executeComponent(componentId, {});
client.onExecutionProgress(executionId, (data) => { ... });
```

## Output

- **Progress**: Reported via `executionReporter` after each test group
- **Messages**: Each group logs individual test results (pass/fail/skip)
- **Return**: `{ type: "SUCCESS", message }` if all pass, `{ type: "WARNING", message }` if any fail

## Cleanup

All test resources (folders, files, components, apps, hidden files) are archived after tests.
The execution tests use the test component created in the Components test group.
