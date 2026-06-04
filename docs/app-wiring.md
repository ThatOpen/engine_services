# App Wiring

## `app.ts` — App Identity

Defines the app's typed shape and the typed accessor for `AppManager`. The `App` type uses `GridElement` types exported from `ui-components/`:

```ts
import * as OBC from "@thatopen/components"
import * as BUI from "@thatopen/ui"
import { AppManager } from "@thatopen/services"
import { icons } from "./globals"
import { FilesSectionGridElement, QtosSectionGridElement } from "./ui-components"

export type App = {
  icons: (keyof typeof icons)[]
  grid: BUI.Grid<
    ["Viewer", "Quantities", "Collider"],
    [
      "viewer",
      FilesSectionGridElement,
      QtosSectionGridElement,
    ]
  >
}

export const getAppManager = (components: OBC.Components) =>
  components.get(AppManager<App>)
```

`getAppManager` is the **only** valid way to access `AppManager` in an app. Never use `components.get(AppManager)` directly — it drops the `App` type parameter and loses all type information about the app's icons, grid layout, and grid elements.

```ts
// ✗ Avoid — loses the App type
const app = components.get(AppManager)

// ✓ Correct — fully typed
const app = getAppManager(components)
```

### Grid element types

- Raw elements → typed as a string literal: `"viewer"`
- Template-based sections → typed as `{ComponentName}GridElement`, defined in the component's `src/types.ts` and exported through `ui-components/index.ts`

```ts
// ui-components/files-section/src/types.ts
export type FilesSectionGridElement = {
  name: "filesSection"
  state: FilesSectionState
}
```

---

## `main.ts` — Entry Point

`main.ts` boots the platform and calls `app.init()`. No business logic belongs here.

```ts
async function main() {
  const client = EngineServicesClient.fromPlatformContext()

  const { components } = await client.setup(
    { OBC, OBF, BUI, CUI, THREE, FRAGS },
    { uuid: ViewportsManager.uuid },
    { uuid: AppManager.uuid },
    { uuid: UIManager.uuid },
  ) as { components: OBC.Components }

  await viewportsManager(components)
  const viewports = components.get(ViewportsManager)
  // @ts-ignore
  const { element: viewport } = [...viewports._instances.values()][0]

  const app = getAppManager(components)
  await app.init({
    client,
    icons: appIcons,
    componentSetups: { ... },
    grid: (grid) => { ... },
  })
}

main().catch(console.error)
```

### `client.setup()` — Platform initialization

- **First argument** — libraries object (`OBC`, `OBF`, `BUI`, `CUI`, `THREE`, `FRAGS`, etc.)
- **Subsequent arguments** — `{ uuid }` for each platform built-in component needed. Always present: `ViewportsManager`, `AppManager`, `UIManager`

Custom components (from `bim-components/`) do not need to be listed here — they self-register via `components.add()` in their constructor.

---

## `componentSetups` in `app.init()`

```ts
componentSetups: {
  core: [uiManager, fragmentsManager, highlighter, ifcLoader],
  lazy: [
    { uuid: MyComponent.uuid, fn: myComponentSetup },
  ]
}
```

**`core`** — runs before the grid mounts, in parallel. `uiManager` always goes here. Other engine component setups (fragments, highlighter, IFC loader) also typically go here.

**`lazy`** — runs the first time the corresponding component is instantiated. The `uuid` is imported from the `bim-components/` barrel. Use for custom components that can be loaded on demand.

The `uuid` of each custom component — a static property defined on the class — is imported from the `bim-components/` barrel when referencing it in `lazy`:

```ts
import { MyComponent } from "../bim-components"

componentSetups: {
  lazy: [
    { uuid: MyComponent.uuid, fn: myComponentSetup },
  ]
}
```

When it's not obvious whether a custom component should be `core` or `lazy`, **decide based on whether the component is needed at boot or only on demand.**
