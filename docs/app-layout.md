# Configure App Layout

## Grid element constraint

Every entry in `grid.elements` must be a single `bim-panel-section`. This is a hard constraint of the platform — the grid only knows how to host panel sections, not arbitrary HTML containers.

**Correct:** one `grid.elements` entry = one `bim-panel-section`
**Wrong:** a UI component that returns a `<div>` wrapping multiple `<bui-panel-section>` elements used as a grid entry

If you need multiple sections in one area, register each section separately in `grid.elements` and group them using `panel:` or `tabs:` in the grid template — never wrap them in a container component.

```ts
// ✗ Wrong — MyDashboard returns <div><bui-panel-section>...</bui-panel-section><bui-panel-section>...</bui-panel-section></div>
grid.elements = {
  dashboard: { template: uis.custom.get("myDashboard").template, initialState: { components } },
}

// ✓ Correct — each section is its own grid element; grouping happens in the template
grid.elements = {
  stats:  { template: uis.custom.get("statsSection").template,  initialState: { components } },
  charts: { template: uis.custom.get("chartsSection").template, initialState: { components } },
}
// Then in the layout template:
// "panel:right(stats,charts) viewer" 1fr / 22rem 1fr
```

---

## Grid sync rules

Any change to the grid requires updates in multiple places. Never update one without the others.

**Adding or removing a layout:**
1. `app.ts` → first argument of `BUI.Grid<[layouts], ...>`
2. `main.ts` → `grid.layouts` (add/remove the definition) and `grid.layout` if it was the initial layout

**Adding or removing an element:**
1. `app.ts` → second argument of `BUI.Grid<..., [elements]>`
2. `main.ts` → `grid.elements`, `grid.areaGroups` (if applicable), and any layout templates that reference it

**Renaming an element** — the name originates in the component, so the change cascades outward:
1. Rename the folder in `ui-components/` (kebab-case of the new name)
2. Update all internal identifiers: types (`{ComponentName}State`, `{ComponentName}Component`, `{ComponentName}GridElement`), functions (`{camelCase}Template`, `on{PascalCase}Created`)
3. Update the `ui-components/index.ts` barrel to point to the renamed folder
4. `app.ts` → second argument of `BUI.Grid` reflects the new `{ComponentName}GridElement`
5. `main.ts` → `grid.elements` and all layout templates that use that area name

---

## Defining layouts

```ts
grid.layouts = {
  Viewer: {
    template: `"viewer" 1fr / 1fr`,
  },
  Quantities: {
    icon: app.icons.QUANTITY,
    template: `
      "qtos viewer" 1fr
      /40rem 1fr
    `,
  },
}
grid.layout = "Collider"
```

---

## Special area tokens

```
{groupType}:{areaName}(elementA, elementB)
```

There are two group types: `tabs` and `panel`.

### `tabs:` — one element at a time

Shows one element at a time with tab switchers. The user picks which section is visible. Supports nested sub-groups:

```
tabs:{areaName}({groupName}[elementA, elementB], elementC)
```

```ts
Collider: {
  icon: appIcons.COLLISION,
  template: `
    "tabs:left(group[collider,qtos],collider) viewer" 1fr
    /30rem 1fr
  `,
}
```

`areaGroups` options for `tabs:`: `switchersCompact` or `switchersFull`.

### `panel:` — all elements stacked vertically

Stacks all elements and keeps them all visible simultaneously, scrollable as a single panel. Use when sections are related and should all be visible at once (e.g. an inspector with multiple info sections):

```ts
app: {
  template: `
    "tabs:left viewport panel:right" 1fr
    / 22rem 1fr 20rem
  `,
}
```

`areaGroups` options for `panel:`: `label` to give the panel a title.

### Choosing between `tabs:` and `panel:`

- Use `tabs:` when sections are **alternatives** — the user focuses on one at a time
- Use `panel:` when sections are **complementary** — the user needs all of them visible together

---

## `grid.elements` and `grid.areaGroups`

```ts
grid.elements = {
  viewer: viewport,
  qtos: {
    template: uis.custom.get("qtosSection").template,
    initialState: { components },
    label: "Quantities",
  },
}

grid.areaGroups = {
  left:  { switchersFull: true },
  right: { label: "Inspector" },
  group: { label: "Configuration", icon: appIcons.APPLY },
}
```

> **Grouping sections always happens at the grid level.** To group, combine, or stack panel sections together, the answer is always `tabs:` or `panel:` in the grid template — never nesting one section inside another in the template code.
