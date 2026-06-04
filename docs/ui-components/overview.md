# UI Component Creation

Guides and best practices for creating UI components with That Open Engine (BUI/OBC) — panels, tables, dropdowns, buttons, inputs, or any visual element.

## Working mode

Before doing anything else, **read [`./library-examples.md`](./library-examples.md) and fetch the `paths.json` for `engine_ui-components` to understand what BUI components are already available.**

Only after that, **propose an implementation plan and wait for the user's approval.**

The proposal must describe:
- Which templates will be created or modified
- What state (`State`) each template will need
- Whether any template needs an `onInstanceCreated` callback
- Whether it composes other existing templates

Only proceed with changes after the user explicitly confirms the plan. If the scope is unclear, ask first — do not assume.

---

## Creating a UI Component

### Step 1 — Define the component name

The component name is the source of truth. Everything else derives from it.

Given a name like *Files Section* or *Models List*, the full naming cascade is:

| Artifact | Convention | Example |
|---|---|---|
| Folder | kebab-case | `files-section/`, `models-list/` |
| Component identifier | camelCase | `filesSection`, `modelsList` |
| Types prefix | PascalCase | `FilesSection`, `ModelsList` |
| Template function | `{camelCase}Template` | `filesSectionTemplate` |
| Callback | `on{PascalCase}Created` | `onFilesSectionCreated` |

The identifier suffix describes what the component *is* from the consumer's perspective — typically the BUI element name:

| Identifier | Root element |
|---|---|
| `filesSection` | `<bim-panel-section>` |
| `collisionsTable` | `<bim-table>` |
| `modelsDropdown` | `<bim-dropdown>` |
| `actionsToolbar` | `<div>` |

> **Exception:** `<bim-panel-section>` uses the suffix `*Section`, not `*PanelSection`.

---

### Step 2 — Create the file structure

Each component lives in its own folder:

```
files-section/
  index.ts        → template, onInstanceCreated (if needed), re-exports ./src
  src/
    index.ts      → re-exports types and support files
    types.ts      → state types and any supporting types
```

The `src/` subfolder holds types and any support files the template needs — helpers, constants, sub-types, etc. If `index.ts` is growing too long, move the extra logic into `src/`.

---

### Step 3 — Define types in `src/types.ts`

Every component needs at minimum these types:

```ts
import * as OBC from "@thatopen/components"
import * as BUI from "@thatopen/ui"

export interface FilesSectionState {
  components: OBC.Components
  // ...additional state
}

export type FilesSectionComponent = BUI.StatefullComponent<FilesSectionState>
```

- **`{ComponentName}State`** — the reactive state passed to the template on every render. Must always include `components: OBC.Components`.
- **`{ComponentName}Component`** — type alias for `BUI.StatefullComponent<{ComponentName}State>`. Used to type the template function.

Additional types depend on the component. For example, tables also need `{ComponentName}Data` — which must be a `type` alias, not an `interface`, as `BUI.Table<T>` requires a type alias:

```ts
// ✗ Avoid — interface does not satisfy BUI.Table<T>
export interface MyTableData { Name: string }

// ✓ Correct
export type MyTableData = { Name: string }
```

#### `components` is the only entry point to the engine

Inside a template, any engine component must be accessed via `components.get()`. State must never receive component instances directly:

```ts
// ✗ Avoid — receiving a component instance directly
const myTemplate = (state: { highlighter: OBF.Highlighter }) => { ... }

// ✓ Correct — access everything through components
const myTemplate = ({ components }: FilesSectionState) => {
  const highlighter = components.get(OBF.Highlighter)
}
```

#### How much logic belongs in a template?

In the ideal case, a template is a thin facade: it reads state from BIM components via `components.get()` and triggers actions on them — nothing more.

In practice, some UI-level logic is fine to keep in the template:

- **Local coordination** — passing data from one sub-component to another within the same section
- **Transient UI state** — loading flags, intermediate form values before the user confirms
- **Orchestration** — calling several BIM components in sequence for a single user action

What doesn't belong in a template is **domain logic**: calculations, data transformations, business rules. If a template starts computing things beyond what's needed to render, that logic belongs in a BIM component instead.

The guiding question: *does this logic exist because the UI needs it, or because the domain requires it?* If the domain requires it, move it to a BIM component. See [`../connect-logic-to-ui.md`](../connect-logic-to-ui.md) for how UI templates connect to BIM components.

---

### Step 4 — Implement the template in `index.ts`

### Rules

- **Always prefer BUI components over native HTML elements.** Before using `<select>`, `<input>`, `<button>`, `<dialog>`, etc., use the `paths.json` descriptions fetched in the working mode step to identify what's available. If you need the full list of available elements, fetch https://raw.githubusercontent.com/ThatOpen/engine_ui-components/refs/heads/main/packages/core/src/components/index.ts. Before implementing any BUI component, check [`./library-examples.md`](./library-examples.md) for an official example of the element you're working with — it's the best starting point for correct usage patterns. See [`./rendering-patterns.md`](./rendering-patterns.md) for general rendering patterns. For displaying and updating text dynamically, see [`./display-text.md`](./display-text.md).
- **Never use `<table>`.** The only acceptable element for tabular data is `<bim-table>`. A `<bim-table>` must always be its own standalone UI component — never defined inline inside another template. The consuming template instantiates the table component and composes it in. See [`./data-table.md`](./data-table.md) for how to build a table component.
- **For async actions** (loading states, async button handlers, etc.), see [`./async-actions.md`](./async-actions.md). **Before triggering a destructive or irreversible action**, always ask the user to confirm — see [`./confirmation-dialog.md`](./confirmation-dialog.md).
- **Do not configure element properties inside the template** that a consumer might want to override after instantiation — they will be reset on every render. Use `onInstanceCreated` instead.
- **Never nest sections.** If the user asks to group content, create independent templates — one per section. See [`./sections-layout.md`](./sections-layout.md).

#### Template

A `{ComponentName}Component` function that receives the current state and returns a `BUI.html` tagged template. Re-runs on every state update.

```ts
export const filesSectionTemplate: FilesSectionComponent = ({ components }) => {
  return BUI.html`<bim-panel-section></bim-panel-section>`
}
```

#### `onInstanceCreated` — one-time setup

Called once when an instance is created. Use it for imperative, one-time configuration: event listeners, fixed element properties, etc. For building a create/edit form anchored to a button, see [`./inline-form.md`](./inline-form.md).

Receives the tuple `[element, updateFn, componentUtils]`:

- `element` — the created HTML element
- `updateFn` — triggers a re-render with a partial state update
- `componentUtils` — provides `getCurrentState()`, which always returns fresh state. Use it inside closures to avoid stale state captures:

```ts
export const onFilesSectionCreated = (
  [section, update, { getCurrentState }]: [
    BUI.PanelSection,
    BUI.UpdateFunction<FilesSectionState>,
    BUI.ComponentUtils<FilesSectionState>
  ]
) => {
  section.addEventListener("click", () => {
    const { components } = getCurrentState() // always fresh state
    const highlighter = components.get(OBF.Highlighter)
    // ...
  })
}
```

---

### Step 5 — Export from the barrel

Re-export the component from the project's barrel index so it's accessible from a single import point:

```ts
export * from "./files-section"
```

When planning a new UI component, **always consider breaking it into smaller, reusable templates** rather than building a single monolithic one. Discuss the granularity with the developer — but the default stance is to favor small, composable units.

---

## See also

- [`./library-examples.md`](./library-examples.md) — Find official usage examples and discover what BUI provides
- [`./data-table.md`](./data-table.md) — Display data in a table, load columns, group rows
- [`./sections-layout.md`](./sections-layout.md) — Organize the layout of a panel section (zones, toolbar, status messages)
- [`./inline-form.md`](./inline-form.md) — Create or edit an entity in a popup form anchored to a button
- [`./confirmation-dialog.md`](./confirmation-dialog.md) — Ask for confirmation before a destructive or irreversible action
- [`./async-actions.md`](./async-actions.md) — Handle an async action with loading state on a button
- [`./rendering-patterns.md`](./rendering-patterns.md) — General rendering patterns (BUI.ref, requestUpdate, data-active)
- [`./display-text.md`](./display-text.md) — Display text, update text dynamically, `bim-label` vs `.label`
