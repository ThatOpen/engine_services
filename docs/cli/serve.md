---
description: "Start a local dev server for a browser app. Uses esbuild in watch mode and serves the IIFE bundle on port 4000 with SSE live reload. To connect: open the project on dev.platform.thatopen.com, click the Local App icon, then Get Started."
---

## thatopen serve

Builds the app in watch mode and serves the IIFE bundle locally. On every save, esbuild rebuilds and the platform reloads the bundle automatically via SSE.

Does **not** open a browser tab — the app runs inside the platform iframe. Open your project on the platform, then click the debug button to connect it to the local server.

**Usage:**
```bash
thatopen serve [flags]
```

**Flags:**

- `--port <port>` — Port to serve the bundle on. Default: `4000`.

**Endpoints served:**

- `GET /bundle.js` — The compiled IIFE bundle.
- `GET /bundle.js.map` — Source map.
- `GET /events` — SSE stream for live reload.

**Example:**
```bash
thatopen serve
thatopen serve --port 4321
```

**Connecting the platform to your local server:**

1. Go to [https://dev.platform.thatopen.com](https://dev.platform.thatopen.com) and open a project (create one first if needed).
2. In the top right corner, click the **Local App** icon.
3. Click **Get Started**.

The platform loads the bundle from port 4000 and renders the app inside the project context, with full access to its models, data, and users. The dev server must be running before opening this URL — if nothing is served on port 4000, the platform will fail to load the app.

The resulting URL follows this pattern:
```
https://dev.platform.thatopen.com/dashboard/projects/{projectId}/apps/local-app
```
