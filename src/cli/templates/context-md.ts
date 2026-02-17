/**
 * Generates CONTEXT.md content for scaffolded projects.
 *
 * This file is read by AI assistants (Claude, Copilot, Cursor, etc.)
 * to understand the project structure, available APIs, and patterns.
 */

export function getContextMdBim(): string {
  return `# ThatOpen BIM App

This is a BIM (Building Information Modeling) app built for the That Open Platform.
It runs in the browser inside the platform's iframe and has access to a 3D viewer,
UI components, and the platform API.

## How this app works

- **Entry point**: \`src/main.ts\` — runs as an IIFE when the platform loads the app.
- **Build output**: \`dist/bundle.js\` — a single IIFE file built by Vite.
- **Platform context**: The platform injects \`window.__THATOPEN_CONTEXT__\` with:
  - \`appId\` — this app's unique ID
  - \`projectId\` — the project this app belongs to
  - \`accessToken\` — Auth0 JWT for API calls
  - \`apiUrl\` — base URL for the That Open API

## Commands

\`\`\`bash
npm run dev        # Serve bundle for local dev inside the platform
npm run build               # Build dist/bundle.js
npm run login               # Authenticate with the platform (saves token locally)
npm run publish             # First publish — creates the app on the platform
npm run update              # Publish a new version of an existing app
\`\`\`

### Local development

Apps run inside the That Open Platform (platform.thatopen.com) within a project —
not as standalone websites. To develop locally:

1. Run \`npm run dev\` — this builds in watch mode and serves the bundle.
2. Open your project on the platform and click the debug button.
3. Live reload is enabled — save a file to rebuild automatically.

## Key libraries

| Package | Import | Purpose |
|---------|--------|---------|
| \`@thatopen/components\` | \`OBC\` | BIM engine — components, fragments, worlds |
| \`@thatopen/ui\` | \`BUI\` | UI web components (\`<bim-panel>\`, \`<bim-grid>\`, etc.) |
| \`three\` | \`THREE\` | 3D rendering engine |
| \`thatopen-services\` | \`EngineServicesClient\` | Platform API client + built-in components |

## Architecture pattern

\`\`\`
1. Create EngineServicesClient with platform context
2. Create OBC.Components instance
3. Init BUI.Manager
4. Load built-in components (AppManager, ViewportManager, etc.)
5. Create viewport(s) and UI elements
6. Configure AppManager with elements + layouts
7. Call app.init()
\`\`\`

## Built-in components

Built-in components are platform-hosted UI modules loaded at runtime via the API client.
They are fetched, evaluated, and registered with the OBC component system.

### Loading pattern

\`\`\`ts
import { AppManager, ViewportManager } from "thatopen-services";

await client.initBuiltInComponent(AppManager, components, { OBC, BUI });
await client.initBuiltInComponent(ViewportManager, components, { OBC, BUI, THREE, FRAGS });

const app = components.get(AppManager);
const viewports = components.get(ViewportManager);
\`\`\`

### AppManager — app shell with CSS grid layouts

Creates a grid-based layout system. Define named element slots and named layouts.
A sidebar for switching layouts appears automatically when multiple layouts exist.

\`\`\`ts
app.setup = {
  elements: {
    viewer: viewportElement,
    panel: panelFunction,    // Can be HTMLElement, () => BUI.TemplateResult, or { template, initialState }
  },
  layouts: {
    Viewer: { template: \\\`"viewer" 1fr / 1fr\\\` },
    Split: {
      template: \\\`"panel viewer" 1fr / 20rem 1fr\\\`,
      icon: "solar:settings-bold",
    },
  },
};
app.init();
\`\`\`

The \`template\` string uses CSS \`grid-template\` shorthand: \`"areas" rows / columns\`.

### ViewportManager — 3D viewport factory

Creates viewports with pre-configured world (scene, camera, renderer) and auto-initialized fragments.

\`\`\`ts
const viewports = components.get(ViewportManager);
const { element, world } = await viewports.create();
// element is an HTMLElement to place in a layout slot
// world has world.scene, world.camera, world.renderer
\`\`\`

### Other available built-in components

- **LoadModelButton** — button with dropdown for loading IFC/Fragment files
- **ViewerToolbar** — toolbar with Show/Hide, Focus, Isolate, Color controls
- **ModelsPanel** — panel listing loaded models with search and load button
- **ModelsDropdown** — dropdown selector for loaded models
- **ClassificationsList** — hierarchical IFC classification browser
- **ClashesList** — clash detection results table
- **ClippingsList** — clipping plane management panel
- **LengthMeasuringsList** / **AreaMeasuringsList** — measurement panels
- **ColorsPalette** — color picker for highlighting
- **HighlightersList** — highlight style manager
- **QtoComparisonList** — property quantity comparison table
- **QueriesHierarchy** — multi-level query browser
- **CustomViewLegend** — color legend overlay
- **ScreenshotAnnotator** — screenshot markup dialog

All follow the same pattern: \`await client.initBuiltInComponent(Component, components, globals)\`, then \`components.get(Component)\`.

## Loading a BIM model

\`\`\`ts
const fragments = components.get(OBC.FragmentsManager);

// From URL
const response = await fetch("https://example.com/model.frag");
const buffer = await response.arrayBuffer();
await fragments.core.load(buffer, { modelId: "my-model" });

// From platform storage
const fileResponse = await client.downloadFile(fileId);
const fileBuffer = await fileResponse.arrayBuffer();
await fragments.core.load(fileBuffer, { modelId: "my-model" });
\`\`\`

## EngineServicesClient API (commonly used in apps)

\`\`\`ts
const client = new EngineServicesClient(ctx.accessToken, ctx.apiUrl, { useBearer: true });

// Files
const files = await client.listFiles();
const file = await client.getFile(fileId);
const response = await client.downloadFile(fileId);
await client.createFile({ file: blob, name: "model.ifc", versionTag: "v1" });

// Folders
const folders = await client.listFolders();
await client.createFolder("My Folder");

// Execute cloud components
const { executionId } = await client.executeComponent(componentId, { param: "value" });
client.onExecutionProgress(executionId, (data) => {
  // data.progressUpdate — progress percentage
  // data.messageUpdate — status messages
});
\`\`\`

## Configuration

- \`.thatopen\` — local config (gitignored). Created by \`npm run login\`. Contains \`accessToken\`, \`apiUrl\`, and \`appId\` after first publish.
- \`vite.config.js\` — builds to IIFE format as \`dist/bundle.js\`. All dependencies are bundled.
`;
}

export function getContextMdDefault(): string {
  return `# ThatOpen App

This is an app built for the That Open Platform.
It runs in the browser inside the platform's iframe.

## How this app works

- **Entry point**: \`src/main.ts\` — runs as an IIFE when the platform loads the app.
- **Build output**: \`dist/bundle.js\` — a single IIFE file built by Vite.
- **Platform context**: The platform injects \`window.__THATOPEN_CONTEXT__\` with:
  - \`appId\` — this app's unique ID
  - \`projectId\` — the project this app belongs to
  - \`accessToken\` — Auth0 JWT for API calls
  - \`apiUrl\` — base URL for the That Open API
- **Mount point**: Your app renders into the \`#that-open-app\` element in \`index.html\`.

## Commands

\`\`\`bash
npm run dev        # Serve bundle for local dev inside the platform
npm run build               # Build dist/bundle.js
npm run login               # Authenticate with the platform (saves token locally)
npm run publish             # First publish — creates the app on the platform
npm run update              # Publish a new version of an existing app
\`\`\`

### Local development

Apps run inside the That Open Platform (platform.thatopen.com) within a project —
not as standalone websites. To develop locally:

1. Run \`npm run dev\` — this builds in watch mode and serves the bundle.
2. Open your project on the platform and click the debug button.
3. Live reload is enabled — save a file to rebuild automatically.

## Adding BIM capabilities

To add 3D BIM viewing, install the BIM dependencies:

\`\`\`bash
npm install @thatopen/components @thatopen/ui three thatopen-services
\`\`\`

Then follow the BIM app pattern:

\`\`\`ts
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { EngineServicesClient, AppManager, ViewportManager } from "thatopen-services";

const ctx = window.__THATOPEN_CONTEXT__!;
const client = new EngineServicesClient(ctx.accessToken, ctx.apiUrl, { useBearer: true });
const components = new OBC.Components();

BUI.Manager.init();

await client.initBuiltInComponent(AppManager, components, { OBC, BUI });
await client.initBuiltInComponent(ViewportManager, components, { OBC, BUI, THREE, FRAGS });

const viewports = components.get(ViewportManager);
const { element, world } = await viewports.create();
components.init();
\`\`\`

## EngineServicesClient API

If you install \`thatopen-services\`, you can make API calls:

\`\`\`ts
import { EngineServicesClient } from "thatopen-services";

const ctx = window.__THATOPEN_CONTEXT__!;
const client = new EngineServicesClient(ctx.accessToken, ctx.apiUrl, { useBearer: true });

// Files
const files = await client.listFiles();
const response = await client.downloadFile(fileId);

// Folders
const folders = await client.listFolders();
await client.createFolder("My Folder");

// Execute cloud components
const { executionId } = await client.executeComponent(componentId, { param: "value" });
\`\`\`

## Configuration

- \`.thatopen\` — local config (gitignored). Created by \`npm run login\`. Contains \`accessToken\`, \`apiUrl\`, and \`appId\` after first publish.
- \`vite.config.js\` — builds to IIFE format as \`dist/bundle.js\`. All dependencies are bundled.
`;
}

export function getContextMdCloud(): string {
  return `# ThatOpen Cloud Component

This is a cloud component for the That Open Platform.
It runs on the server as a Node.js process, triggered via the platform API.

## How this component works

- **Entry point**: \`src/main.ts\` — must export an \`async function main()\`.
- **Build output**: \`dist/bundle.js\` — an IIFE built by Vite with platform deps externalized.
- **Execution**: The platform (or \`thatopen run\` locally) wraps the bundle in an execution engine that provides globals and calls \`main()\`.

## Commands

\`\`\`bash
npm run build      # Build dist/bundle.js
npm run run        # Build and run locally (uses thatopen run)
npm run login      # Authenticate with the platform (saves token locally)
npm run publish    # First publish — creates the component on the platform
npm run update     # Publish a new version of an existing component
\`\`\`

To pass parameters when running locally:

\`\`\`bash
npx thatopen run --params '{"inputFile": "model.ifc", "threshold": 0.5}'
\`\`\`

## Globals available at runtime

The execution engine injects these into scope — do NOT import them:

| Global | Type | Purpose |
|--------|------|---------|
| \`thatOpenServices\` | \`EngineServicesClient\` | Authenticated API client (can manage files, trigger other components, etc.) |
| \`executionParams\` | \`Record<string, any>\` | Parameters passed by the caller |
| \`executionReporter\` | \`{ message(msg), progress(pct) }\` | Send live status updates and progress percentage |
| \`OBC\` | \`@thatopen/components\` | BIM engine — components, fragments, worlds |
| \`THREE\` | \`three\` | 3D math and geometry utilities |
| \`WEBIFC\` | \`web-ifc\` | Low-level IFC parser (may not be available) |
| \`fs\` | Node.js \`fs\` | Filesystem access |

### TypeScript declarations

These are already declared in \`src/main.ts\`. Keep them there for type checking:

\`\`\`ts
declare const thatOpenServices: import("thatopen-services").EngineServicesClient;
declare const executionParams: Record<string, any>;
declare const executionReporter: {
  message(msg: string): void;
  progress(pct: number): void;
};
declare const OBC: typeof import("@thatopen/components");
declare const THREE: typeof import("three");
declare const fs: typeof import("fs");
\`\`\`

## Return value

\`main()\` must return an object with \`type\` and \`message\`:

\`\`\`ts
return { type: "SUCCESS", message: "Processed 42 elements" };
// type: "SUCCESS" | "FAIL" | "WARNING"
\`\`\`

## Common patterns

### Processing an IFC file from platform storage

\`\`\`ts
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
\`\`\`

### Uploading results back to the platform

\`\`\`ts
const resultBlob = new Blob([JSON.stringify(results)], { type: "application/json" });
await thatOpenServices.createFile({
  file: resultBlob,
  name: "results.json",
  versionTag: "v1",
  parentFolderId: executionParams.outputFolderId,
});
\`\`\`

### Using the EngineServicesClient

The \`thatOpenServices\` global is a pre-authenticated \`EngineServicesClient\`:

\`\`\`ts
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
\`\`\`

## Build configuration

- \`vite.config.js\` builds to IIFE format.
- Platform dependencies (\`@thatopen/components\`, \`three\`, \`web-ifc\`, \`thatopen-services\`, \`fs\`, \`path\`, \`crypto\`, \`os\`) are **externalized** — they are provided by the execution engine at runtime.
- The build output has a footer \`var main = ThatOpenComponent.main;\` so the engine can find the entry point.

## Configuration

- \`.thatopen\` — local config (gitignored). Created by \`npm run login\`. Contains \`accessToken\`, \`apiUrl\`, \`itemType: "COMPONENT"\`, and \`componentId\` after first publish.
`;
}
