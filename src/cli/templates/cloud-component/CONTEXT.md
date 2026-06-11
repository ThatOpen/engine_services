# ThatOpen Cloud Component

This is a cloud component for the That Open Platform.
It runs on the server as a Node.js process, triggered via the platform API.

## How this component works

- **Entry point**: `src/main.ts` — must export an `async function main()`.
- **Parameter schema**: `declarations.json` — the list of parameters this component accepts. Bundled next to the code so the platform, the UI, and `thatopen run` know what to pass in.
- **Build output**: `dist/bundle.js` — an IIFE built by Vite with `@thatopen/services` externalized.
- **Execution**: The platform (or `thatopen run` locally) wraps the bundle in an execution engine that provides globals and calls `main()`.

## Parameters (`declarations.json`)

Every cloud component declares its runtime parameters in a root-level `declarations.json` file. The CLI includes this file in the zip at publish time, and the platform refuses to publish a component without it. It's a plain JSON array of `{ id, label, type }` entries:

```json
[
  { "id": "projectName", "label": "Project Name", "type": "string" },
  { "id": "iterations", "label": "Number of Iterations", "type": "number" }
]
```

- `id` — the key users read off `executionParams` inside `main()`.
- `label` — human-readable name shown to the user on the platform's execution form.
- `type` — `"string"` or `"number"` (the only supported types for now).

**Rule:** `declarations.json` and `src/main.ts` must stay in sync. When you add, remove, or rename a parameter in one, update the other. `thatopen publish` fails if `declarations.json` is missing, and `thatopen run --params '{...}'` warns if the keys or types don't match the schema.

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
import { EngineServicesClient } from "@thatopen/services";

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

The execution engine injects **exactly these four** into scope — do NOT import them, do NOT assume anything else is available:

| Global | Type | Purpose |
|--------|------|---------|
| `thatOpenServices` | `EngineServicesClient` | Authenticated API client (files, folders, components, executions) |
| `executionParams` | `Record<string, any>` | User-supplied parameters (shape defined in `declarations.json`) |
| `executionContext` | `{ projectId?, executionId, toolId, toolVersion }` | Platform-supplied run context. Use `executionContext.projectId` to scope operations to the project the component was launched from. Undefined when run outside a project context. |
| `executionReporter` | `{ message(msg), error(msg), progress(pct) }` | Send live status updates, error lines, and a numeric progress percentage to the execution UI |

Libraries like `@thatopen/components`, `three`, `web-ifc`, or Node's `fs` are **not** available as globals. If you need them, `import` them the normal way and let the bundler include them in `dist/bundle.js`. The execution environment is a plain Node.js process with no special additions beyond the four globals above.

### TypeScript declarations

Already declared in `src/main.ts`. Keep them there for type checking:

```ts
declare const thatOpenServices: import("@thatopen/services").EngineServicesClient;
declare const executionParams: Record<string, unknown>;
declare const executionContext: {
  projectId?: string;
  executionId: string;
  toolId: string;
  toolVersion: string;
};
declare const executionReporter: {
  message(msg: string): void;
  error(msg: string): void;
  progress(pct: number): void;
};
```

## Return value

`main()` must return an object with `type` and `message`:

```ts
return { type: "SUCCESS", message: "Processed 42 elements" };
// type: "SUCCESS" | "FAIL" | "WARNING"
```

## Common patterns

### Scoping uploads to the launching project

```ts
export async function main() {
  const projectId = executionContext?.projectId;
  if (!projectId) {
    return { type: "FAIL", message: "This component must be launched from a project" };
  }

  const blob = new Blob(["hello"], { type: "text/plain" });
  await thatOpenServices.createFile({
    file: blob,
    name: "hello.txt",
    versionTag: "v1",
    projectId,
  });

  return { type: "SUCCESS", message: "Uploaded into the project" };
}
```

### Processing a file from platform storage

```ts
export async function main() {
  const { fileId } = executionParams;

  executionReporter.message("Downloading file...");
  const response = await thatOpenServices.downloadFile(fileId as string);
  const buffer = await response.arrayBuffer();

  executionReporter.progress(50);
  // ... process the buffer ...
  executionReporter.progress(100);

  return { type: "SUCCESS", message: "Done" };
}
```

### Triggering another cloud component

```ts
const { executionId } = await thatOpenServices.executeComponent(otherComponentId, { param: "value" });
const result = await thatOpenServices.getExecution(executionId);
```

### Listing resources inside a project

Pass `projectId` to the list methods to enumerate a specific project's
resources. The backend enforces project-scoped permissions — the token
running your component must have `STORAGE:READ` (or the relevant role)
on that project; otherwise the call is rejected with `403`. A missing
`projectId` still works and lists items in the caller's personal scope.

```ts
const projectId = executionContext?.projectId;
if (projectId) {
  const files = await thatOpenServices.listFiles({ projectId });
  const folders = await thatOpenServices.listFolders({ projectId });
  // listApps / listComponents / listExecutions all accept projectId too
}
```

### Gating an action with a permission check

```ts
const { hasPermission, scope } = await thatOpenServices.checkPermission({
  resourceType: "STORAGE",
  action: "WRITE",
  projectId: executionContext?.projectId,
});
if (!hasPermission) {
  return { type: "FAIL", message: "Caller cannot write to this project" };
}
// scope is 'global' | 'project' | 'entity' | 'none' — useful when you
// want the UI to know *why* a permission was granted. checkPermissionBatch
// accepts a list of checks in a single round-trip.
```

## Build configuration

- `vite.config.js` builds to IIFE format.
- Only `@thatopen/services` is externalized — the wrapper provides it at runtime via `require()`. Everything else (including any third-party npm dependency you install) is bundled into `dist/bundle.js`.
- The build output has a footer `var main = ThatOpenComponent.main;` so the engine can find the entry point as a top-level `main` variable.

## Configuration

- `.thatopen` — local config (gitignored). Created by `npm run login`. Contains `accessToken`, `apiUrl`, `itemType: "COMPONENT"`, and `componentId` after first publish.
