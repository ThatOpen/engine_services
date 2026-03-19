# ThatOpen BIM App

This is a BIM (Building Information Modeling) app built for the That Open Platform.
It runs in the browser inside the platform's iframe and has access to a 3D viewer,
UI components, and the platform API.

## How this app works

- **Entry point**: `src/main.ts` — runs as an IIFE when the platform loads the app.
- **Build output**: `dist/bundle.js` — a single IIFE file built by Vite.
- **Platform context**: The platform injects `window.__THATOPEN_CONTEXT__` with:
  - `appId` — this app's unique ID
  - `projectId` — the project this app belongs to
  - `accessToken` — Auth0 JWT for API calls
  - `apiUrl` — base URL for the That Open API

## Commands

```bash
npm run dev        # Start dev server (esbuild watch + serve on :4000)
npm run build               # Build dist/bundle.js (Vite/Rollup production build)
npm run login               # Authenticate with the platform (saves token locally)
npm run publish             # Publish to the platform
```

### Local development

Apps run inside the That Open Platform (platform.thatopen.com) within a project —
not as standalone websites. To develop locally:

1. Run `npm run dev` — this watches source files with esbuild and serves the bundle on port 4000.
2. Open your project on the platform and click the debug button.
3. Live reload is enabled — save a file to rebuild automatically.

The dev server (`thatopen serve`) uses esbuild for near-instant incremental rebuilds.
**Important**: Do NOT run `vite`, `vite build --watch`, or `npx vite` directly for development.
Always use `npm run dev` which runs `thatopen serve` under the hood.

## Key libraries

| Package | Import | Purpose |
|---------|--------|---------|
| `@thatopen/components` | `OBC` | BIM engine — components, fragments, worlds |
| `@thatopen/components-front` | `OBF` | Front-end BIM components (Highlighter, measurements, etc.) |
| `@thatopen/fragments` | `FRAGS` | Fragment geometry format |
| `@thatopen/ui` | `BUI` | UI web components (`<bim-panel>`, `<bim-grid>`, etc.) |
| `@thatopen/ui-obc` | `CUI` | Pre-built OBC UI tables (used by ModelsPanel) |
| `three` | `THREE` | 3D rendering engine |
| `thatopen-services` | `EngineServicesClient` | Platform API client + built-in components |

## Architecture pattern

```
1. Create EngineServicesClient from platform context
2. Call client.setup(globals, ...builtIns) — creates OBC.Components,
  inits BUI, loads built-in components, calls components.init()
3. Create viewport(s) and UI elements
4. Configure AppManager with elements + layouts
5. Call app.init()
```

## Built-in components

Built-in components are platform-hosted UI modules loaded at runtime via the API client.
They are fetched, evaluated, and registered with the OBC component system.

| Component | Purpose |
|-----------|---------|
| **AppManager** | App shell — CSS grid layout system with sidebar for switching layouts |
| **ViewportsManager** | Factory for 3D viewports with pre-configured world (scene, camera, renderer) |
| **LoadModelButton** | Button + dropdown for loading IFC and Fragments files |
| **ViewerToolbar** | Toolbar with Show/Hide/Focus/Isolate actions and color palette |
| **ModelsPanel** | Panel listing loaded models with search bar and load button |
| **ModelsDropdown** | Dropdown selector listing loaded models |
| **ClassificationsList** | Hierarchical table of IFC classification data |
| **ClashesList** | Interactive clash detection results with click-to-highlight |
| **ClippingsList** | Panel listing clipping planes with enable/delete controls |
| **LengthMeasuringsList** | Panel listing length measurements with cumulative total |
| **AreaMeasuringsList** | Panel listing area measurements with area/perimeter totals |
| **ColorsPalette** | Color picker grid with custom input and Highlighter styles |
| **HighlightersList** | Panel listing Highlighter styles with manage/apply actions |
| **QtoComparisonList** | Side-by-side quantity comparison for two selected elements |
| **QueriesHierarchy** | Recursive multi-level query browser for IFC data |
| **CustomViewLegend** | Color legend overlay with colored circles and labels |
| **ScreenshotAnnotator** | Modal for annotating screenshots (arrows, text, freehand) via MarkerJS |

**Full API reference**: Each component has detailed JSDoc with `@example` blocks in the
`thatopen-services` package source (`src/built-in/index.ts`). Read that file for config
interfaces, method signatures, and code examples.

### Loading pattern

Use `setup` to create the component system and load built-in components in one call:

```ts
import { EngineServicesClient, AppManager, ViewportsManager } from "thatopen-services";

const client = EngineServicesClient.fromPlatformContext();

// Creates OBC.Components, inits BUI, loads built-ins, calls components.init()
const { components } = await client.setup(
  { OBC, OBF, BUI, CUI, THREE, FRAGS },
  AppManager, ViewportsManager,
);

const app = components.get(AppManager);
const viewports = components.get(ViewportsManager);
```

You can also load components individually if needed:

```ts
// Batch load (parallel)
await client.initBuiltInComponents(components, AppManager, ViewportsManager);

// Or one at a time
await client.initBuiltInComponent(AppManager, components);
```

### Required globals per component

| Component | Globals to pass | Extra npm packages needed |
|-----------|----------------|--------------------------|
| AppManager | `{ OBC, BUI }` | — |
| ViewportsManager | `{ OBC, BUI, THREE, FRAGS }` | — |
| LoadModelButton | `{ OBC, BUI }` | — |
| ModelsDropdown | `{ OBC, BUI }` | — |
| ModelsPanel | `{ OBC, BUI, CUI }` | `@thatopen/ui-obc` |
| ViewerToolbar | `{ OBC, OBF, BUI, THREE }` | `@thatopen/components-front` |
| ColorsPalette | `{ OBC, OBF, BUI }` | `@thatopen/components-front` |
| ClashesList | `{ OBC, OBF, BUI, THREE }` | `@thatopen/components-front` |
| ClassificationsList | `{ OBC, OBF, BUI }` | `@thatopen/components-front` |
| ClippingsList | `{ OBC, BUI }` | — |
| HighlightersList | `{ OBC, OBF, BUI }` | `@thatopen/components-front` |
| LengthMeasuringsList | `{ OBC, OBF, BUI, THREE }` | `@thatopen/components-front` |
| AreaMeasuringsList | `{ OBC, OBF, BUI, THREE }` | `@thatopen/components-front` |
| QtoComparisonList | `{ OBC, OBF, BUI }` | `@thatopen/components-front` |
| QueriesHierarchy | `{ OBC, OBF, BUI }` | `@thatopen/components-front` |
| CustomViewLegend | `{ OBC, BUI }` | — |
| ScreenshotAnnotator | `{ OBC, BUI, MARKERJS }` | `@markerjs/markerjs3` |

### Global abbreviations

```ts
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";   // needed for Toolbar, Highlighters, Clashes, etc.
import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";              // needed for ModelsPanel
import * as THREE from "three";
import * as FRAGS from "@thatopen/fragments";
import * as MARKERJS from "@markerjs/markerjs3";      // needed for ScreenshotAnnotator
```

### AppManager — app shell with CSS grid layouts

Creates a grid-based layout system. Define named element slots and named layouts.
A sidebar for switching layouts appears automatically when multiple layouts exist.

```ts
const Layouts = ["Viewer", "Split"];
const Elements = ["viewer", "panel"];

await app.init({
  client,
  icons: undefined, // pass Record<K, string> when using typed App interface with icon keys
  grid: (grid: BUI.Grid<Layouts, Elements>) => {
    grid.elements = {
      viewer: viewportElement,
      panel: panelFunction, // Can be HTMLElement, () => BUI.TemplateResult, or { template, initialState }
    };
    grid.layouts = {
      Viewer: { template: `"viewer" 1fr / 1fr` },
      Split: {
        template: `"panel viewer" 1fr / 20rem 1fr`,
        icon: "solar:settings-bold",
      },
    };
  },
});
```

The `template` string uses CSS `grid-template` shorthand: `"areas" rows / columns`.

### ViewportsManager — 3D viewport factory

Creates viewports with pre-configured world (scene, camera, renderer) and auto-initialized fragments.

```ts
const viewports = components.get(ViewportsManager);
const { element, world } = await viewports.create();
// element is an HTMLElement to place in a layout slot
// world has world.scene, world.camera, world.renderer
```

## Loading a BIM model

```ts
const fragments = components.get(OBC.FragmentsManager);

// From URL
const response = await fetch("https://example.com/model.frag");
const buffer = await response.arrayBuffer();
await fragments.core.load(buffer, { modelId: "my-model" });

// From platform storage
const fileResponse = await client.downloadFile(fileId);
const fileBuffer = await fileResponse.arrayBuffer();
await fragments.core.load(fileBuffer, { modelId: "my-model" });
```

## EngineServicesClient API (commonly used in apps)

```ts
// Recommended: auto-reads window.__THATOPEN_CONTEXT__ and sets useBearer: true
const client = EngineServicesClient.fromPlatformContext();
console.log(client.context.projectId); // access the platform context

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

// Test against a local cloud component (requires thatopen local-server running in the component project)
client.localServerUrl = "http://localhost:4001";
const local = await client.executeComponent("any-id", { param: "value" });
client.localServerUrl = null; // reset to use the cloud API
```

## Configuration

- `.thatopen` — local config (gitignored). Created by `npm run login`. Contains `accessToken`, `apiUrl`, and `appId` after first publish.
- `vite.config.js` — builds to IIFE format as `dist/bundle.js`. All dependencies are bundled.
