# thatopen-services

Client library and CLI for the That Open Platform — a cloud platform for building BIM (Building Information Modeling) software.

## What this repo contains

1. **Library** (`src/core/client.ts`) — `EngineServicesClient`, a TypeScript API client for managing files, folders, apps, cloud components, and executions on the platform.
2. **CLI** (`src/cli/`) — The `thatopen` command-line tool for scaffolding and publishing apps and cloud components.
3. **Built-in components** (`src/built-in/`) — Type stubs for platform-provided UI components (AppManager, ViewportManager, etc.) that are fetched and evaluated at runtime.

## Project structure

```
src/
  core/client.ts          # EngineServicesClient — the main API class
  cli/
    commands/create.ts    # thatopen create — scaffolds new projects
    commands/serve.ts     # thatopen serve — dev server (esbuild watch + serve)
    commands/login.ts     # thatopen login — authenticate with the platform
    commands/publish.ts   # thatopen publish — build and upload to the platform
    commands/run.ts       # thatopen run — test cloud components locally
    templates/            # Template generators for scaffolded projects
    lib/                  # CLI helper utilities (config, certificates)
  built-in/index.ts       # Built-in component type stubs + runtime UUID constants
  types/                  # TypeScript type definitions (items, execution, etc.)
  index.ts                # Library entry point (re-exports everything)
```

## Build system

- **Library** builds to CommonJS (`dist/index.cjs.js`) + ESM (`dist/index.es.js`) + types (`dist/index.d.ts`) via Vite (`vite.config.mts`).
- **CLI** builds to a single `dist/cli.js` executable via Vite (`vite.config.cli.mts`). It bundles commander, jszip, and all library code.
- TypeScript strict mode is enabled.

### Commands

```bash
npm run build          # Full build (library + CLI)
npm run build:lib      # Library only
npm run build:cli      # CLI only
```

### Testing

```bash
npm run test:ui                   # Interactive browser test page
npm run test:cli-build-app        # Scaffold + build a test app
npm run test:cli-build-component  # Scaffold + build a test cloud component
npm run test:cli-run-component    # Run the test cloud component locally
```

### Publishing to npm

```bash
yarn create-version   # Build → changeset → version → publish
```

## Key concepts

### Apps vs Cloud Components

| | Apps | Cloud Components |
|---|---|---|
| **Runs in** | Browser (iframe on the platform) | Server (Node.js child process) |
| **Item type** | `APP` | `TOOL` |
| **Entry point** | Side effects in `main.ts` (renders UI) | `export async function main()` |
| **Context** | `window.__THATOPEN_CONTEXT__` provides `{ appId, projectId, accessToken, apiUrl }` | Globals: `thatOpenServices`, `executionParams`, `executionReporter`, `OBC`, `THREE`, `fs` |
| **Build output** | IIFE `dist/bundle.js` (all deps bundled) | IIFE `dist/bundle.js` (platform deps externalized) |
| **Template** | `bim` or `default` | `cloud` |

### Authentication

Two modes, controlled by `useBearer` in the constructor:
- **Query parameter** (default): Sends `accessToken` as a URL query param. Used with platform API tokens.
- **Bearer header** (`useBearer: true`): Sends as `Authorization: Bearer <token>`. Used with Auth0 JWTs inside platform apps.

### Built-in components

Built-in components are platform-hosted UI modules fetched at runtime. Usage pattern:

```ts
import { AppManager, ViewportManager } from "thatopen-services";

// Register all library globals once
client.setBuiltInGlobals({ OBC, OBF, BUI, CUI, THREE, FRAGS });

// Fetch, evaluate, and register with OBC — globals are automatically applied
await client.initBuiltInComponent(AppManager, components);
await client.initBuiltInComponent(ViewportManager, components);

// Use via OBC component system
const app = components.get(AppManager);
const viewports = components.get(ViewportManager);
```

Available built-in components:

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

Full API reference with config interfaces, method signatures, and `@example` blocks: `src/built-in/index.ts`.

### Configuration files

- **Global**: `~/.thatopen/config.json` — `{ accessToken, apiUrl }`
- **Local** (per project): `.thatopen` — `{ accessToken, apiUrl, appId?, componentId?, itemType? }`
- Local config takes priority. Created by `thatopen login --local`.

## API surface (EngineServicesClient)

### Files
- `listFiles(filters?)` / `getFile(id, props?)` / `createFile(data)` / `updateFile(id, data)`
- `archiveFile(id)` / `recoverFile(id)` / `downloadFile(id, params?)` / `getFileMetadata(id, params?)`

### Folders
- `listFolders(params?)` / `getFolder(id)` / `createFolder(name, parentId?)`
- `updateFolder(id, params)` / `archiveFolder(id)` / `recoverFolder(id)` / `downloadFolder(id)`

### Components
- `listComponents(params?)` / `getComponent(id, props?)` / `createComponent(data)` / `updateComponent(id, data)`
- `archiveComponent(id)` / `recoverComponent(id)` / `downloadComponent(id, params?)` / `downloadComponentBundle(id, params?)`

### Apps
- `listApps(params?)` / `createApp(data)` / `archiveApp(id)`
- `downloadApp(id, params?)` / `downloadAppBundle(id, params?)`

### Execution (cloud components)
- `executeComponent(componentId, params, versionTag?)` — triggers server-side execution, returns `{ executionId }`
- `abortExecution(executionId)` / `listExecutions(componentId)` / `getExecution(executionId)`
- `onExecutionProgress(executionId, callback)` — real-time WebSocket subscription

### Built-in components
- `setBuiltInGlobals(globals)` — registers globals once; subsequent `initBuiltInComponent` calls use them automatically
- `getBuiltInComponent(name)` — fetches JS bundle by name
- `initBuiltInComponent(component, components, globals?)` — fetches, evaluates, and registers (uses stored globals if `globals` omitted)

### Hidden files
- `createHiddenFile(file, parentId)` / `deleteHiddenFile(id)` / `getHiddenFile(id)`
- `downloadHiddenFile(id)` / `getHiddenFilesByParent(parentId)` / `deleteHiddenFilesByParent(parentId)`

### General
- `updateItem(id, params)` / `createVersion(id, file, tag, extraProps?, metadata?)`
- `getProjectData(projectId)` / `checkPermission(params)`

## CLI commands

```bash
thatopen create <name> [--template bim|default|cloud]   # Scaffold project + auto npm install
thatopen serve [--port N]                                # Dev server (esbuild watch + serve bundle)
thatopen login [--token T] [--api-url U] [--local]       # Authenticate
thatopen publish [--name N] [--version-tag T] [--skip-build] [--app-id ID | --component-id ID]
thatopen run [--params '{}'] [--skip-build]              # Test cloud component locally
thatopen local-server [--port N] [--skip-build]          # Local execution server (API-compatible)
```

## Dependencies

- **Runtime**: `dotenv`, `socket.io-client`
- **Peer** (optional): `@thatopen/components` ^3.3.1, `@thatopen/ui` ^3.3.3, `three` ^0.182.0
- **CLI bundled**: `commander`, `jszip`
