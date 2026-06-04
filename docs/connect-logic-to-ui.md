# Connect Logic to UI

Setup files are the bridge between custom BIM components (logic) and the platform UI. This is where event subscriptions, UI sync, and component wiring live — not in the component itself.

## Structure

```
setups/
├── index.ts          → barrel (always present)
├── ui-manager.ts     → fixed boilerplate (always present)
└── {custom}.ts       → one per custom BIM component
```

One file per component being initialized. Each file exports a single function that receives `components: OBC.Components`.

---

## `setups/ui-manager.ts` — Fixed boilerplate

This is where all UI templates get registered in the platform (see the UI-component guide in `docs/`: [./ui-components/overview.md](./ui-components/overview.md)). The file always has this shape — the content changes (which templates are registered), but the structure never does.

### `CustomUIs` type

Maps every UI template to its element type and state. Add one entry per registered template:

```ts
export type CustomUIs = {
  filesSection: { type: BUI.PanelSection; state: FilesSectionState }
  collisionsTable: { type: BUI.Table<CollisionsTableData>; state: CollisionsTableState }
  // one entry per registered template
}
```

### `getUIManager` — typed accessor

The typed accessor for `UIManager`. Defined here because `CustomUIs` lives here. Used everywhere else in `setups/` to interact with the UI registry — never access `UIManager` directly:

```ts
export const getUIManager = (components: OBC.Components) =>
  components.get(UIManager<CustomUIs>)
```

`getUIManager` is the **only** valid way to access `UIManager` in an app. Never use `components.get(UIManager)` directly — it drops the `CustomUIs` type parameter and loses all type information about the registered templates.

```ts
// ✗ Avoid — loses the CustomUIs type
const uis = components.get(UIManager)

// ✓ Correct — fully typed
const uis = getUIManager(components)
```

### `uiManager` setup function

Registers each template and its optional `onInstanceCreated` callback, exported from the UI component:

```ts
export const uiManager = (components: OBC.Components) => {
  const uis = getUIManager(components)
  uis.registerTemplate("filesSection", {
    template: filesSectionTemplate,
    onInstanceCreated: onFilesSectionCreated
  })
  uis.registerTemplate("collisionsTable", {
    template: collisionsTableTemplate
  })
}
```

### Composing UI components

Templates can embed other registered components by creating instances via `uis.custom.get()`:

```ts
export const filesSectionTemplate: FilesSectionComponent = (state) => {
  const uis = state.components.get(UIManager)
  const [modelsList] = uis.custom.get("modelsList").create(state)
  return BUI.html`
    <bim-panel-section label="Files">
      ${modelsList}
    </bim-panel-section>
  `
}
```

### Keeping UIs in sync with `updateInstances()`

To push a state update to all existing instances of a template, call `updateInstances()` from within a setup file — typically in response to engine events:

```ts
const updateUIs = () => uis.custom.get("modelsList").updateInstances()
fragments.list.onItemSet.add(updateUIs)
fragments.list.onItemDeleted.add(updateUIs)
```

---

## Custom setup files

Each setup file is the bridge between a custom BIM component and the platform (see the BIM-component guide in `docs/`: [./bim-components/overview.md](./bim-components/overview.md)). This is where wiring lands: event listeners, UI updates, and configuration go here — not in the component's constructor.

```ts
// setups/qto-manager.ts
export const qtoManager = (components: OBC.Components) => {
  const uis = getUIManager(components)
  const qtoManager = components.get(QtoManager)

  qtoManager.onStateChanged.add((states) => {
    if (!states.includes("value")) return
    uis.custom.get("qtosTable").updateInstances()
  })
}
```
