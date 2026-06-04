# BIM Component Creation

Architecture, patterns, and step-by-step guide for creating BIM components with That Open Engine (OBC/OBF) — the domain-logic layer that wraps fragments, IFC data, measurements, selections, or any non-UI behavior.

## Working mode

Before doing anything else, **read [`./library-examples.md`](./library-examples.md) and fetch the `paths.json` for both `engine_components` and `engine_fragment` in parallel.** Review all descriptions to understand what the engine already provides before forming any opinion about what needs to be built.

Only after that, **propose an implementation plan and wait for the user's approval.**

The proposal must describe:
- Whether the need is covered by an existing engine component (consume via `components.get()`)
- Whether existing components can be composed to cover it
- Only if neither applies: which new component(s) will be created, what properties, events, and public methods it will expose, and whether it needs lifecycle, serialization, render loop, or interactive creation interfaces

Only proceed with changes after the user explicitly confirms the plan. If the scope is unclear, ask first — do not assume.

---

## What is a BIM Component?

That Open Engine is the collection of packages that power the app: `@thatopen/components`, `@thatopen/components-front`, `@thatopen/fragments`, `@thatopen/ui`, and `@thatopen/ui-obc`. BIM components are built on top of this ecosystem.

A BIM component is a class that extends `OBC.Component` and encapsulates domain logic — IFC queries, calculations, data management, fragment operations, etc. It exposes that logic through a clean, event-driven interface that UI templates and other components can consume.

### The engine works with Fragments

That Open Engine does not work with IFC STEP files directly. It works with **Fragments** — an open binary format (`.frag`) built for performance: a 2 GB IFC file becomes ~80 MB, loads in seconds at 60fps in the browser.

The runtime representation of a loaded model is a `FragmentsModel`. Its data schema usually mirrors the IFC SCHEMA (local IDs map to IFC express IDs, the spatial structure parallels IFC hierarchy, properties follow IFC attributes and relations), but it is not IFC STEP — it is Fragments. Any component that queries elements, reads properties, or operates on geometry works through the `FragmentsModel` API.

For loading models, querying elements, or reading properties, fetch the relevant example from [`./library-examples.md`](./library-examples.md) before writing any implementation code.

### When to create one

Create a BIM component when custom domain logic is needed.

After reviewing the `paths.json` descriptions fetched in the working mode step:

- If an existing component covers the need → consume it via `this.components.get()` and fetch its example. Do not reimplement.
- If existing components can be composed to cover it → compose them, fetching the relevant examples as building blocks.
- Only if the need is genuinely not covered → propose creating a custom component.

Custom components can themselves consume built-in components via `this.components.get()`, so examples remain useful even when building something new.

---

## Step 1 — Define the component

Names should be short but descriptive. Use PascalCase for both folder and class, matching exactly:

| Artifact | Convention | Example |
|---|---|---|
| Folder | PascalCase | `ActivityTracker/` |
| Class | PascalCase | `ActivityTracker` |
| Types prefix | PascalCase matching class | `ActivityTrackerConfig`, `ActivityTrackerResult` |

Use the `Manager` suffix when the component creates instances of something or governs a broad concern — consistent with `FragmentsManager`, `Classifier`, etc. For focused, single-responsibility components, omit it.

---

## Step 2 — Create the file structure

```
ActivityTracker/
  index.ts        → class definition + re-exports ./src
  src/
    index.ts      → re-exports types and support files
    types.ts      → interfaces, type aliases, enums
    SpotElevation.ts → auxiliary class (if needed)
```

Only one class per component extends `OBC.Component` — the main one in `index.ts`. Any other classes the component defines or instantiates are plain TypeScript classes that live in `src/` alongside `types.ts`, and never extend `OBC.Component`.

---

## Step 3 — Implement the class in `index.ts`

### Skeleton

Every component needs a unique, hardcoded static UUID — a fixed string literal defined once and never changed. The constructor must call `super(components)` and register the instance with `components.add(UUID, this)` so it becomes globally retrievable via `components.get(ActivityTracker)`.

Before writing the implementation, read [`./coding-conventions.md`](./coding-conventions.md) for naming rules, backing fields, and async patterns that apply throughout the class.

```ts
import * as OBC from "@thatopen/components"

export class ActivityTracker extends OBC.Component {
  static readonly uuid = "1b43361b-ef43-4207-9c40-dbed37bec0b6" as const;

  enabled = true;

  constructor(components: OBC.Components) {
    super(components);
    components.add(ActivityTracker.uuid, this);
  }
}

export * from "./src"
```

### Interfaces

OBC defines capability interfaces that components can implement to stay consistent with each other and with the engine. Pick the resource that matches your need:

| I need... | Resource |
|---|---|
| Initialize the component with config, or clean up resources when it's destroyed | [`./setup-and-cleanup.md`](./setup-and-cleanup.md) |
| Save and restore state across sessions | [`./save-and-restore-state.md`](./save-and-restore-state.md) |
| Run logic on every frame of the render loop | [`./per-frame-updates.md`](./per-frame-updates.md) |
| Implement a flow where the user creates objects in the scene step by step | [`./user-driven-object-creation.md`](./user-driven-object-creation.md) |
| Expose events or react to state changes | [`./expose-events.md`](./expose-events.md) |

### Accessing other components

Resolve dependencies at call time — never store component instances as fields as it may create memory leaks:

```ts
const fragments = this.components.get(OBC.FragmentsManager);
const highlighter = this.components.get(OBF.Highlighter);
```

---

## Step 4 — Define types in `src/types.ts`

Types are defined in parallel as the class needs them, not upfront. All typing for the component lives here — domain interfaces, event payloads, serialized types — so there is a single place to look.

See [`./type-conventions.md`](./type-conventions.md) for common patterns (runtime vs serialized types, generics, etc.).

---

## Step 5 — Export from the barrel

Re-export the component from the project's barrel index so it's accessible from a single import point:

```ts
export * from "./ActivityTracker"
```

---

## Wiring up

Instantiating the component and connecting it to engine events is not the component's responsibility — that belongs in external initialization code. The constructor should never call other components. See [`../app-wiring.md`](../app-wiring.md) for how this is done.

---

## See also

- [`./library-examples.md`](./library-examples.md) — Find official usage examples and discover what the engine provides
- [`./element-collections.md`](./element-collections.md) — Represent or combine element collections across components
- [`./observable-collections.md`](./observable-collections.md) — Store component-internal data with reactive notifications
- [`./expose-events.md`](./expose-events.md) — Expose events for other components or the UI to react to
- [`./setup-and-cleanup.md`](./setup-and-cleanup.md) — Initialize the component with config or clean up resources on destroy
- [`./save-and-restore-state.md`](./save-and-restore-state.md) — Persist and restore state across sessions
- [`./per-frame-updates.md`](./per-frame-updates.md) — Run logic on every frame of the render loop
- [`./user-driven-object-creation.md`](./user-driven-object-creation.md) — Let the user create objects in the scene step by step
- [`./type-conventions.md`](./type-conventions.md) — Define component types (runtime vs serialized, generics)
- [`./coding-conventions.md`](./coding-conventions.md) — Code conventions (naming, backing fields, async)
