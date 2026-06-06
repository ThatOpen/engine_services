# Working on this That Open Platform project — Agent Guide

You're an AI assistant helping build/extend this project (a BIM app or cloud component) on the
That Open Platform. Read this first.

## Rules (always apply)
1. **All business logic lives in a BIM component** (`src/bim-components/`). `setups/` only wire;
   `ui-components/` only render; `main.ts` only boots. New logic → a new (or existing) component.
2. **Check engine components first** — `@thatopen/components` (`OBC`) / `@thatopen/components-front`
   (`OBF`) — before building anything custom.
3. **Propose a short plan and get the user's OK** before changing files.

## Where the full build guides live
The complete, up-to-date guides ship with the library. Read them from the installed package:
- `node_modules/@thatopen/services/AGENTS.md` — the router; **start here**
- `node_modules/@thatopen/services/docs/` — detailed guides (app wiring, layout, connecting logic
  to UI, building BIM/UI components, cloud components, publishing, icons, colors, …)
- `node_modules/@thatopen/services/CONTEXT.md` — library API reference (`PlatformClient` vs
  `EngineServicesClient`, permissions)

## Beta libraries
If you scaffold **another** app, first ask the user whether they have **beta access** and want the
latest features/progress. If yes, use `thatopen create <name> -t bim-beta` — it scaffolds on the
private `@thatopen-platform/*-beta` packages (the line the platform runs). Founding members have
permanent beta access; the beta packages are private, so the user's beta token must be configured
for `npm install`.

## This project
- `CONTEXT.md` (this folder) — the context for *this specific* project.
- `package.json` scripts — `npm run dev` (preview), `npm run login`, `npm run publish`.
