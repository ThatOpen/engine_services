# ThatOpen App

This is an app built for the That Open Platform.
It runs in the browser inside the platform's iframe.

## How this app works

- **Entry point**: `src/main.ts` — runs as an IIFE when the platform loads the app.
- **Build output**: `dist/bundle.js` — a single IIFE file built by Vite.
- **Platform context**: The platform injects `window.__THATOPEN_CONTEXT__` with:
  - `appId` — this app's unique ID
  - `projectId` — the project this app belongs to
  - `accessToken` — Auth0 JWT for API calls
  - `apiUrl` — base URL for the That Open API
- **Mount point**: Your app renders into the `#that-open-app` element in `index.html`.

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

## Adding BIM capabilities

To add 3D BIM viewing, install the BIM dependencies:

```bash
npm install @thatopen/components @thatopen/ui three thatopen-services
```

Then follow the BIM app pattern:

```ts
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import { EngineServicesClient, AppManager, ViewportManager } from "thatopen-services";

const client = EngineServicesClient.fromPlatformContext();
const { components } = await client.setup(
  { OBC, OBF, BUI, CUI, THREE, FRAGS },
  AppManager, ViewportManager,
);

const viewports = components.get(ViewportManager);
const { element, world } = await viewports.create();
```

## EngineServicesClient API

If you install `thatopen-services`, you can make API calls:

```ts
import { EngineServicesClient } from "thatopen-services";

const client = EngineServicesClient.fromPlatformContext();

// Files
const files = await client.listFiles();
const response = await client.downloadFile(fileId);

// Folders
const folders = await client.listFolders();
await client.createFolder("My Folder");

// Execute cloud components
const { executionId } = await client.executeComponent(componentId, { param: "value" });
```

## Configuration

- `.thatopen` — local config (gitignored). Created by `npm run login`. Contains `accessToken`, `apiUrl`, and `appId` after first publish.
- `vite.config.js` — builds to IIFE format as `dist/bundle.js`. All dependencies are bundled.
