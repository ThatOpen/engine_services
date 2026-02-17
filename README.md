# thatopen-services

Client library and CLI for building BIM apps and cloud components on the [That Open Platform](https://platform.thatopen.com).

## Quick Start

### Create a BIM app

```bash
npx thatopen create my-app
cd my-app
npm install
npm run dev

# Open your project on platform.thatopen.com and click the debug button
```

### Create a cloud component

```bash
npx thatopen create my-component --template cloud
cd my-component
npm install
npm run run   # Build and test locally
```

### Templates

| Template | Command | What you get |
|----------|---------|--------------|
| `bim` (default) | `npx thatopen create my-app` | Three.js + BIM viewer + platform UI components |
| `default` | `npx thatopen create my-app --template default` | Minimal app showing platform context |
| `cloud` | `npx thatopen create my-component --template cloud` | Server-side Node.js component |

## What's in this package

- **Library** — `EngineServicesClient` for interacting with the That Open API (files, folders, apps, cloud components, executions, permissions)
- **CLI** — `thatopen` command for scaffolding, developing, and publishing
- **Built-in component types** — TypeScript stubs for platform-hosted UI components (AppManager, ViewportManager, etc.)

## Library usage

```typescript
import { EngineServicesClient } from 'thatopen-services';

const client = new EngineServicesClient(accessToken, apiUrl);

// Files
const files = await client.listFiles();
await client.createFile({ file: blob, name: "model.ifc", versionTag: "v1" });
const response = await client.downloadFile(fileId);

// Folders
const folders = await client.listFolders();
await client.createFolder("My Folder");

// Cloud component execution
const { executionId } = await client.executeComponent(componentId, { param: "value" });
client.onExecutionProgress(executionId, (data) => {
  console.log(data.progressUpdate, data.messageUpdate);
});
```

Inside platform apps, use the Auth0 JWT from the platform context:

```typescript
const ctx = window.__THATOPEN_CONTEXT__; // { appId, projectId, accessToken, apiUrl }
const client = new EngineServicesClient(ctx.accessToken, ctx.apiUrl, { useBearer: true });
```

## CLI commands

| Command | Description |
|---------|-------------|
| `thatopen create <name> [--template bim\|default\|cloud]` | Scaffold a new project |
| `thatopen dev [--platform]` | Start local dev server |
| `thatopen login [--token T] [--local]` | Authenticate with the platform |
| `thatopen publish` | Build and publish to the platform |
| `thatopen run [--params '{}']` | Build and test a cloud component locally |

## App workflow

Apps run inside the That Open Platform (platform.thatopen.com) within a project. They are served inside the platform's iframe — not as standalone websites.

```bash
# 1. Create and install
npx thatopen create my-app
cd my-app && npm install

# 2. Develop locally
npm run dev
# Open your project on the platform and click the debug button.
# Live reload is enabled — save a file to rebuild.

# 3. Authenticate
npm run login -- --token <your-token>

# 4. Publish (first time creates the app, saves app ID)
npm run publish

# 5. Update (subsequent publishes)
npm run update
```

## Cloud component workflow

```bash
# 1. Create and install
npx thatopen create my-component --template cloud
cd my-component && npm install

# 2. Run locally
npm run run

# 3. Pass parameters
npx thatopen run --params '{"inputFile": "model.ifc"}'

# 4. Authenticate and publish
npm run login -- --token <your-token>
npm run publish
```

Cloud components export an `async function main()` that runs on the server. The execution engine provides globals:

| Global | Purpose |
|--------|---------|
| `thatOpenServices` | Authenticated `EngineServicesClient` |
| `executionParams` | Parameters passed by the caller |
| `executionReporter` | `{ message(msg), progress(pct) }` for live feedback |
| `OBC` | `@thatopen/components` — BIM engine |
| `THREE` | `three` — 3D math and geometry |
| `fs` | Node.js filesystem |

## Built-in components

Platform-hosted UI components loaded at runtime:

```typescript
import { AppManager, ViewportManager } from "thatopen-services";

await client.initBuiltInComponent(AppManager, components, { OBC, BUI });
await client.initBuiltInComponent(ViewportManager, components, { OBC, BUI, THREE, FRAGS });

const app = components.get(AppManager);
const viewports = components.get(ViewportManager);
const { element, world } = await viewports.create();
```

Available: `AppManager`, `ViewportManager`, `LoadModelButton`, `ViewerToolbar`, `ModelsPanel`, `ModelsDropdown`, `ClassificationsList`, `ClashesList`, `ClippingsList`, `LengthMeasuringsList`, `AreaMeasuringsList`, `ColorsPalette`, `HighlightersList`, `QtoComparisonList`, `QueriesHierarchy`, `CustomViewLegend`, `ScreenshotAnnotator`.

## Config files

| File | Scope | Contains |
|------|-------|----------|
| `~/.thatopen/config.json` | Global | `accessToken`, `apiUrl` |
| `.thatopen` (project root) | Per-project (gitignored) | `accessToken`, `apiUrl`, `appId` or `componentId` |

The CLI checks the local `.thatopen` first, then falls back to the global config.

---

## Development (working on this repo)

### Setup

```bash
npm install
npm run build        # Builds both library and CLI
```

### Build commands

```bash
npm run build          # Full build (library + CLI)
npm run build:lib      # Library only
npm run build:cli      # CLI only
```

### Testing the CLI locally

```bash
# Link the CLI globally so `thatopen` points to this repo
npm link

# Build CLI and scaffold a test app
npm run test:cli-build-app

# Serve the test app in platform mode
npm run test:cli-serve-app

# Build and scaffold a test cloud component
npm run test:cli-build-component

# Run the test cloud component locally
npm run test:cli-run-component
```

### Publishing a new version

```bash
yarn create-version
```

This runs: build → changeset → version → publish to npm. Keep in mind the importance of semver (don't release a major for non-breaking changes). Make sure you have the proper npm token.
