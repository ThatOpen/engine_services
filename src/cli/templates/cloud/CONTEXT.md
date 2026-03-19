# ThatOpen Cloud Component

This is a cloud component for the That Open Platform.
It runs on the server as a Node.js process, triggered via the platform API.

## How this component works

- **Entry point**: `src/main.ts` — must export an `async function main()`.
- **Build output**: `dist/bundle.js` — an IIFE built by Vite with platform deps externalized.
- **Execution**: The platform (or `thatopen run` locally) wraps the bundle in an execution engine that provides globals and calls `main()`.

## Commands

```bash
npm run build          # Build dist/bundle.js
npm run run            # Build and run locally (one-shot execution via thatopen run)
npm run local-server   # Start local execution server (API-compatible with EngineServicesClient)
npm run login          # Authenticate with the platform (saves token locally)
npm run publish        # Publish to the platform
```

To pass parameters when running locally:

```bash
npx thatopen run --params '{"inputFile": "model.ifc", "threshold": 0.5}'
```

### Local execution server

The local server (`npm run local-server`) starts an HTTP + WebSocket server that implements
the same execution API as the cloud. This lets apps using `EngineServicesClient` test against
local component code without publishing:

```bash
npm run local-server                     # Start on default port 4001
npx thatopen local-server --port 5000    # Custom port
```

Then in your app or test script:

```ts
import { EngineServicesClient } from "thatopen-services";

const client = new EngineServicesClient(token, apiUrl, {
  localServerUrl: "http://localhost:4001",
});

const { executionId } = await client.executeComponent("any-id", { param: "value" });
client.onExecutionProgress(executionId, (data) => {
  console.log(data.progressUpdate?.progress);
});
```

The server watches source files and auto-rebuilds — changes are picked up on the next execution.

## Globals available at runtime

The execution engine injects these into scope — do NOT import them:

| Global | Type | Purpose |
|--------|------|---------|
| `thatOpenServices` | `EngineServicesClient` | Authenticated API client (can manage files, trigger other components, etc.) |
| `executionParams` | `Record<string, any>` | Parameters passed by the caller |
| `executionReporter` | `{ message(msg), progress(pct) }` | Send live status updates and progress percentage |
| `OBC` | `@thatopen/components` | BIM engine — components, fragments, worlds |
| `THREE` | `three` | 3D math and geometry utilities |
| `WEBIFC` | `web-ifc` | Low-level IFC parser (may not be available) |
| `fs` | Node.js `fs` | Filesystem access |

### TypeScript declarations

These are already declared in `src/main.ts`. Keep them there for type checking:

```ts
declare const thatOpenServices: import("thatopen-services").EngineServicesClient;
declare const executionParams: Record<string, any>;
declare const executionReporter: {
  message(msg: string): void;
  progress(pct: number): void;
};
declare const OBC: typeof import("@thatopen/components");
declare const THREE: typeof import("three");
declare const fs: typeof import("fs");
```

## Return value

`main()` must return an object with `type` and `message`:

```ts
return { type: "SUCCESS", message: "Processed 42 elements" };
// type: "SUCCESS" | "FAIL" | "WARNING"
```

## Common patterns

### Processing an IFC file from platform storage

```ts
export async function main() {
  const { fileId } = executionParams;

  executionReporter.message("Downloading file...");
  const response = await thatOpenServices.downloadFile(fileId);
  const buffer = await response.arrayBuffer();

  executionReporter.message("Processing model...");
  executionReporter.progress(25);

  const components = new OBC.Components();
  // ... process the model ...

  executionReporter.progress(100);
  return { type: "SUCCESS", message: "Done" };
}
```

### Uploading results back to the platform

```ts
const resultBlob = new Blob([JSON.stringify(results)], { type: "application/json" });
await thatOpenServices.createFile({
  file: resultBlob,
  name: "results.json",
  versionTag: "v1",
  parentFolderId: executionParams.outputFolderId,
});
```

### Using the EngineServicesClient

The `thatOpenServices` global is a pre-authenticated `EngineServicesClient`:

```ts
// Files
const files = await thatOpenServices.listFiles();
const response = await thatOpenServices.downloadFile(fileId);
await thatOpenServices.createFile({ file: blob, name: "output.ifc", versionTag: "v1" });

// Folders
const folders = await thatOpenServices.listFolders();
await thatOpenServices.createFolder("Results");

// Trigger another cloud component
const { executionId } = await thatOpenServices.executeComponent(otherComponentId, { param: "value" });
const result = await thatOpenServices.getExecution(executionId);
```

## Build configuration

- `vite.config.js` builds to IIFE format.
- Platform dependencies (`@thatopen/components`, `three`, `web-ifc`, `thatopen-services`, `fs`, `path`, `crypto`, `os`) are **externalized** — they are provided by the execution engine at runtime.
- The build output has a footer `var main = ThatOpenComponent.main;` so the engine can find the entry point.

## Configuration

- `.thatopen` — local config (gitignored). Created by `npm run login`. Contains `accessToken`, `apiUrl`, `itemType: "COMPONENT"`, and `componentId` after first publish.
