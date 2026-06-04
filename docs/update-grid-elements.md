# Update Grid Elements

## When to use

`app.grid.updateComponent` pushes a state update to a specific named grid element. Use it when a BIM component event needs to refresh the state of a template-based section mounted in the grid.

This is different from `uis.custom.get(...).updateInstances()` — that re-renders all instances of a UIManager template regardless of where they're mounted. `updateComponent` targets a **specific grid slot by name**, which makes it the right choice when the element lives in the grid and you want precise, typed control over what state it receives.

---

## API

```ts
app.grid.updateComponent[componentName](updatedState)
```

- **`componentName`** — the element name as declared in the `App` type (e.g. `"qtosSection"`)
- **`updatedState`** — partial state; only the provided fields are merged

The call is fully typed: the accepted state shape is inferred from the `{ComponentName}GridElement` type in `app.ts`.

---

## Where to call it

In a setup file (`setups/{custom}.ts`), in response to a BIM component event:

```ts
// setups/qto-manager.ts
export const qtoManager = (components: OBC.Components) => {
  const app = getAppManager(components)
  const qtoManager = components.get(QtoManager)

  qtoManager.onResultsChanged.add((results) => {
    app.grid.updateComponent["qtosSection"]({ results })
  })
}
```

Never call `updateComponent` from inside a template function — templates receive state passively and should not trigger updates themselves.

---

## Type safety

Because `app.grid` is typed via the `App` type in `app.ts`, TypeScript knows which names are valid and what state shape each one accepts. Passing an unknown name or a mismatched state shape produces a type error at the call site.
