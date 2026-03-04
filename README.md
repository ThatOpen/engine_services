# thatopen-services

Client library and CLI for building BIM apps and cloud components on the [That Open Platform](https://platform.thatopen.com).

## Quick Start

### Create a BIM app

```bash
# Install the services package globally
npm i thatopen-services -g
```

Then, create a brand new app repository:

```bash
npx thatopen create my-app
cd my-app
npm run dev

# Open your project on platform.thatopen.com and click the debug button
```

You can also scaffold in the current directory:

```bash
mkdir my-app && cd my-app
npx thatopen create .
npm run dev
```

### Create a cloud component

```bash
npx thatopen create my-component --template cloud
cd my-component
npm run run   # Build and test locally
```

### Templates

| Template | Command | What you get |
|----------|---------|--------------|
| `bim` (default) | `npx thatopen create my-app` | Three.js + BIM viewer + platform UI components |
| `default` | `npx thatopen create my-app --template default` | Minimal app showing platform context |
| `cloud` | `npx thatopen create my-component --template cloud` | Server-side Node.js component |

Use `npx thatopen create .` to scaffold in the current directory instead of creating a new one.

## What's in this package

- **Library** — `EngineServicesClient` for interacting with the That Open API (files, folders, apps, cloud components, executions, permissions)
- **CLI** — `thatopen` command for scaffolding and publishing
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
| `thatopen create <name> [--template bim\|default\|cloud]` | Scaffold a new project (use `.` for current directory) |
| `thatopen serve [--port N]` | Dev server (esbuild watch + serve bundle) |
| `thatopen login [--token T] [--local]` | Authenticate with the platform |
| `thatopen publish` | Build and publish to the platform |
| `thatopen run [--params '{}']` | Build and test a cloud component locally |

## App workflow

Apps run inside the That Open Platform (platform.thatopen.com) within a project. They are served inside the platform's iframe — not as standalone websites.

```bash
# 1. Create project (dependencies are installed automatically)
npx thatopen create my-app
cd my-app

# 2. Develop locally
npm run dev
# Open your project on the platform and click the debug button.
# Live reload is enabled — save a file to rebuild.

# 3. Authenticate
npm run login -- --token <your-token>

# 4. Publish
npm run publish
```

## Cloud component workflow

```bash
# 1. Create project (dependencies are installed automatically)
npx thatopen create my-component --template cloud
cd my-component

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

// Register all library globals once
client.setBuiltInGlobals({ OBC, OBF, BUI, CUI, THREE, FRAGS });

// Load built-in components — globals are automatically applied
await client.initBuiltInComponent(AppManager, components);
await client.initBuiltInComponent(ViewportManager, components);

const app = components.get(AppManager);
const viewports = components.get(ViewportManager);
const { element, world } = await viewports.create();
```

| Component | Purpose |
|-----------|---------|
| `AppManager` | App shell — CSS grid layout with sidebar for switching layouts |
| `ViewportManager` | Factory for 3D viewports with pre-configured world |
| `LoadModelButton` | Button + dropdown for loading IFC / Fragments files |
| `ViewerToolbar` | Toolbar with Show/Hide/Focus/Isolate and color palette |
| `ModelsPanel` | Panel listing loaded models with search and load button |
| `ModelsDropdown` | Dropdown selector listing loaded models |
| `ClassificationsList` | Hierarchical table of IFC classification data |
| `ClashesList` | Interactive clash detection results with highlighting |
| `ClippingsList` | Panel listing clipping planes with controls |
| `LengthMeasuringsList` | Panel listing length measurements with totals |
| `AreaMeasuringsList` | Panel listing area measurements with totals |
| `ColorsPalette` | Color picker with Highlighter style swatches |
| `HighlightersList` | Panel listing Highlighter styles with manage actions |
| `QtoComparisonList` | Side-by-side quantity comparison for two elements |
| `QueriesHierarchy` | Recursive multi-level query browser |
| `CustomViewLegend` | Color legend overlay |
| `ScreenshotAnnotator` | Modal for annotating screenshots via MarkerJS |

See `src/built-in/index.ts` for full API reference with config interfaces and `@example` blocks.

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

# Build and scaffold a test cloud component
npm run test:cli-build-component

# Run the test cloud component locally
npm run test:cli-run-component
```

### Publishing a new version

Publishing is handled automatically by CI when a PR with changesets is merged to `main`.

**1. Create a changeset (developer does this with their changes):**

```bash
yarn changeset
# Pick the bump type (patch / minor / major) and write a summary
# This creates a .changeset/<random-name>.md file — commit it with your PR
```

**2. Merge the PR to `main`:**

CI will automatically:
- Consume the changeset files
- Bump `package.json` version and update `CHANGELOG.md`
- Commit the version bump back to `main`
- Build and publish to npm

**Manual publishing (if CI is not available):**

```bash
yarn version           # Consume changesets, bump version
yarn build
yarn changeset publish
```

Keep in mind the importance of semver — don't release a major for non-breaking changes.
