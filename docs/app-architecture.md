# App Architecture and Composition

## Architecture rule: logic lives only in BIM components

**All business logic in a platform app must live inside a BIM component** (`src/bim-components/`). This is not a convention — it is the architectural constraint of the platform.

| Layer | What belongs here | What does NOT belong here |
|---|---|---|
| `bim-components/` | State, events, async operations, data access, coordination logic | — |
| `setups/` | Event subscriptions, calling component methods, UI sync | Business logic, data processing, state |
| `ui-components/` | Rendering, layout, reading component state | Logic, API calls, mutations |
| `main.ts` | Boot sequence only | Any logic whatsoever |

If logic doesn't fit inside an existing BIM component, the answer is always to create a new one or extend an existing one — never to write it in a setup file, a template, or `main.ts`.

```ts
// ✗ Forbidden — logic in a setup file
export const mySetup = (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager)
  fragments.list.onItemSet.add(async (model) => {
    const data = await fetchSomething(model.uuid)  // ← logic here is wrong
    processData(data)
  })
}

// ✓ Correct — setup only wires; logic lives in the component
export const mySetup = (components: OBC.Components) => {
  const uis = getUIManager(components)
  const manager = components.get(MyManager)
  manager.onDataReady.add(() => uis.custom.get("myPanel").updateInstances())
}
```

---

## Component tiers in a platform app

Every platform app works with three tiers of components, all accessible via `components.get()`:

- **Engine components** — public, from `@thatopen/components` (OBC) and `@thatopen/components-front` (OBF). Always check these first before building custom logic.
- **Platform built-in components** — private components from `@thatopen/services` (e.g. `AppManager`, `UIManager`, `ViewportsManager`). Available after `client.setup()`, already wired up.
- **Custom components** — see the BIM-component and UI-component guides in `docs/`. Live in `src/bim-components/`, self-register in their constructor via `components.add()`.

---

## Project Structure

Every app has this shape under `src/`. To configure the app layout or add and reorganize sections in the grid, see [./app-layout.md](./app-layout.md).

```
src/
├── bim-components/   → custom OBC domain components
├── ui-components/    → BUI templates, barrel only
├── setups/           → initialization and wiring
├── app.ts            → typed app identity
├── globals.ts        → global constants (icons, tooltips, colors, etc.)
└── main.ts           → entry point
```

### `bim-components/`

Each custom OBC component lives in its own folder, built following the BIM-component guide in `docs/` (see [./bim-components/overview.md](./bim-components/overview.md)). The `index.ts` barrel re-exports every component class, its types, and its static `uuid` — this is the single import point for all custom domain logic throughout the app.

### `ui-components/`

Templates created following the UI-component guide in `docs/` (see [./ui-components/overview.md](./ui-components/overview.md)) are re-exported from the barrel. The `index.ts` is a **pure barrel** — only re-exports, nothing else. Registration of templates in the UIManager happens in `setups/ui-manager.ts`.

### `setups/`

One file per component being initialized. `ui-manager.ts` is always present as fixed boilerplate; all other files are custom wiring. See [./connect-logic-to-ui.md](./connect-logic-to-ui.md) for the full implementation reference. To update the state of a grid element at runtime from a setup or event handler, see [./update-grid-elements.md](./update-grid-elements.md).

### `app.ts` and `main.ts`

`app.ts` defines the app's typed shape and the `getAppManager` accessor. `main.ts` boots the platform — no business logic belongs here. See [./app-wiring.md](./app-wiring.md) for structure, `client.setup()`, and `componentSetups`. To access the backend client or project data (`app.client`, `app.projectData`), see [./access-backend-data.md](./access-backend-data.md).

### `globals.ts`

Contains the icon registry, color registry, and any other global constants. All icons must be declared here and accessed through `AppManager`. Colors are declared here and imported directly where needed. See [./using-icons.md](./using-icons.md) and [./using-colors.md](./using-colors.md) for details.

---

## See also

- [Connect logic to the UI](./connect-logic-to-ui.md) — register templates, sync views, etc.
- [Configure the app layout](./app-layout.md) — add or reorganize sections in the grid.
- [App wiring](./app-wiring.md) — boot the app, configure `app.ts`, `main.ts`, `client.setup()`, `componentSetups`.
- [Access backend data](./access-backend-data.md) — the backend client and project data (`app.client`, `app.projectData`).
- [Using icons](./using-icons.md) — register or use icons in the app.
- [Using colors](./using-colors.md) — declare or use global colors (highlighter, palette, etc.).
- [Update grid elements](./update-grid-elements.md) — update the state of a grid element at runtime.
- [Scaffolding a new app](./scaffolding.md) — scaffold a new app from scratch using the CLI.
- [Publishing an app](./publishing.md) — publish an app to the platform (login + publish).
- [CLI setup](./cli-setup.md) — install the CLI and authenticate with a platform token.
- [Previewing apps](./previewing.md) — preview the app during development inside the platform.
