# Rendering Patterns

Common patterns that apply across all BUI components.

## Lit and LitElement

All components in `@thatopen/ui` are Web Components built with [Lit](https://lit.dev/) and extend `LitElement`. Since `BUI.html` is Lit's `html` tagged template, the full Lit template syntax applies — property bindings, boolean attributes, event listeners, directives, etc.

## requestUpdate()

Reassigning a reactive property (like `table.data`) automatically schedules a re-render. **Mutating a property in place** does not — call `requestUpdate()` manually in those cases:

```ts
// Reassignment → automatic update
table.data = newData

// In-place mutation → manual update required
table.data.push(newRow)
table.requestUpdate()
```

## BUI.ref

`BUI.ref(callback)` provides an imperative reference to an element inside a `BUI.html` template. The callback is called once the element is mounted in the DOM:

```ts
// Initialization
const onTableCreated = (e?: Element) => {
  if (!e) return
  const table = e as BUI.Table<MyTableData>
  table.loadFunction = async () => { ... }
  table.loadData(true)
}

return BUI.html`<bim-table ${BUI.ref(onTableCreated)}></bim-table>`
```

```ts
// Capture
let input: BUI.TextInput | undefined

const onInputCreated = (e?: Element) => {
  if (!(e instanceof BUI.TextInput)) return
  input = e
}

return BUI.html`
  <bim-text-input ${BUI.ref(onInputCreated)}></bim-text-input>
  <bim-button @click=${() => console.log(input?.value)}></bim-button>
`
```

## Creating Elements

When an element must be created imperatively outside of `BUI.html`, use `BUI.Component.create` instead of `document.createElement`:

```ts
// ✗ Avoid
const button = document.createElement("bim-button")

// ✓ Correct
const button = BUI.Component.create(() => BUI.html`<bim-button label="Click me"></bim-button>`)
```

## Visual State with data-active

Use `toggleAttribute("data-active")` to reflect an element's active/inactive state visually:

```ts
target.toggleAttribute("data-active")           // toggle
target.toggleAttribute("data-active", true)     // force active
target.toggleAttribute("data-active", false)    // force inactive
```

## Event Handlers

```ts
return BUI.html`
  <bim-text-input @input=${onSearch}></bim-text-input>
  <bim-button @click=${onClick}></bim-button>
`
```

## BUI.Manager.newRandomId()

Use when a template needs to associate DOM elements by ID. Since templates can be instantiated multiple times, hardcoded IDs would cause collisions:

```ts
const inputId = BUI.Manager.newRandomId()

return BUI.html`
  <label for=${inputId}>Name</label>
  <input id=${inputId} type="text" />
`
```

## Triggering re-renders from inside a template (update)

`BUI.StatefullComponent` receives an optional second parameter `update`:

```ts
export const myTemplate: BUI.StatefullComponent<MyState> = (state, update) => {
  const onAdd = () => {
    doSomething()
    update()              // re-render with same state
    update({ count: 5 }) // re-render with partial state change
  }
}
```

Avoid calling `update` in response to changes that themselves trigger another `update` — this causes an infinite render loop.

## Role-based rendering

When content depends on a user role or any runtime condition, use an optional variable before the `return`:

```ts
let actionArea: BUI.TemplateResult | undefined
if (userHasPermission) {
  actionArea = BUI.html`<bim-button label="Run Action" @click=${onRun}></bim-button>`
}

return BUI.html`
  <bim-panel-section label="...">
    ${content}
    ${actionArea}
  </bim-panel-section>
`
```
