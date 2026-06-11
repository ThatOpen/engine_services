# Building on the That Open Platform — Agent Guide

You are an AI assistant helping a user build a **BIM app** or **cloud component** on the
That Open Platform using **`@thatopen/services`** (the `thatopen` CLI + client library).

**Read this file first.** It states the rules you must follow, then routes you to the one
detailed doc for whatever you're doing. Open only the doc you need — don't load everything.

> This guide is tool-agnostic: it works with any AI (Claude, Codex, your own). All docs it
> references ship inside the `@thatopen/services` package under `docs/`.

---

## How to work

- 🚩 **BEFORE creating anything, ask the user about beta access — this is important.** Ask:
  *"Do you have That Open beta access? It gives you the latest libraries, features and progress —
  and it's what the platform currently runs. Do you want to use it?"* **If yes, scaffold with the
  `bim-beta` template** (`thatopen create <name> -t bim-beta`). Founding members have **permanent** beta
  access, so for them the answer is almost always yes. Using the matching library line avoids
  runtime errors against the platform. (Beta packages are private — the user needs their beta
  access token configured in npm, or `npm install` will fail.) See
  [docs/scaffolding.md](./docs/scaffolding.md).
- **New app or component?** The **first step is always the CLI** (`thatopen create`) — never
  hand-write the scaffold. See [docs/cli-setup.md](./docs/cli-setup.md) then
  [docs/scaffolding.md](./docs/scaffolding.md).
- **The scaffold is already a complete, working viewer** (model loading, spatial tree, properties).
  **Run it first** (`npm run dev`) to see it work, *then* extend it — don't rebuild a viewer from scratch.
- **Propose a short plan and get the user's OK** before changing files. If scope is unclear, ask.
- Prefer existing engine functionality over custom code (see rule 2).

## Hard rules (always apply)

1. **All business logic lives in a BIM component** (`src/bim-components/`).
   `setups/` only wire; `ui-components/` only render; `main.ts` only boots. Logic that doesn't
   fit an existing component → create a new one. Never put logic in a setup, template, or `main.ts`.
2. **Check engine components first** — `@thatopen/components` (`OBC`) and
   `@thatopen/components-front` (`OBF`) — before building anything custom.
3. **Platform built-ins** (`AppManager`, `ViewportsManager`, `UIManager`, …) come from
   `@thatopen/services` and are available after `client.setup()`. Don't reinvent them.

---

## What are you doing? → open the right doc

### Set up & ship
| Goal | Doc |
|---|---|
| Install the CLI + authenticate | [docs/cli-setup.md](./docs/cli-setup.md) |
| Scaffold a new app / component | [docs/scaffolding.md](./docs/scaffolding.md) |
| Preview the app inside the platform | [docs/previewing.md](./docs/previewing.md) |
| Publish an app or component | [docs/publishing.md](./docs/publishing.md) |

### Structure & wire an app
| Goal | Doc |
|---|---|
| Project structure, architecture rules, component tiers | [docs/app-architecture.md](./docs/app-architecture.md) |
| Boot / `app.ts` / `main.ts` / `client.setup()` | [docs/app-wiring.md](./docs/app-wiring.md) |
| Configure layout, add/reorganize grid sections | [docs/app-layout.md](./docs/app-layout.md) |
| Connect component logic to the UI | [docs/connect-logic-to-ui.md](./docs/connect-logic-to-ui.md) |
| Update a grid element's state at runtime | [docs/update-grid-elements.md](./docs/update-grid-elements.md) |
| Access the backend client / project data | [docs/access-backend-data.md](./docs/access-backend-data.md) |
| Register and use icons | [docs/using-icons.md](./docs/using-icons.md) |
| Declare and use colors | [docs/using-colors.md](./docs/using-colors.md) |

### Build a custom BIM component
Start at [docs/bim-components/overview.md](./docs/bim-components/overview.md) — conventions,
lifecycle (setup/cleanup), exposing events, observable/element collections, per-frame updates,
saving/restoring state, user-driven object creation.

### Build a UI component
Start at [docs/ui-components/overview.md](./docs/ui-components/overview.md) — rendering patterns,
section layout, data tables, inline forms, confirmation dialogs, display text, async actions.

### Cloud components & automations
[docs/cloud-components.md](./docs/cloud-components.md) — build / run locally / publish a cloud
component, the execution globals, and event-triggered automations.

---

## Reference (also shipped in this package)

- **Library API** — `PlatformClient` vs `EngineServicesClient`, the permissions contract, and the
  full method surface → [CONTEXT.md](./CONTEXT.md)
- **Built-in components API** — config interfaces, method signatures, `@example` blocks →
  `src/built-in/index.ts` (in the installed package, `node_modules/@thatopen/services/`)
