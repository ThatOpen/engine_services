# Inline Form (Context Menu)

To let the user create or edit an entity without leaving the current view, place a `<bim-panel-section fixed>` acting as a form inside a `contextMenuTemplate`. The form opens as a popup anchored to the trigger button.

```ts
const onBtnCreated = (e?: Element) => {
  if (!e) return
  const btn = e as BUI.Button
  btn.contextMenuTemplate = () => {
    const onSubmit = async ({ target }: { target: BUI.Button }) => {
      const section = target.parentElement as BUI.PanelSection
      section.valueTransform = {
        name: (value: string) => value.trim(),
        description: (value: string) => value.trim() || undefined,
      }
      const data = section.value as { name: string; description?: string }
      target.loading = true
      await doSomething(data)
      target.loading = false
      BUI.ContextMenu.removeMenus()
    }

    return BUI.html`
      <bim-context-menu style="padding: 0; max-height: none;">
        <bim-panel-section style="width: 16rem;" label="New Item" fixed>
          <bim-text-input vertical name="name" label="Name"></bim-text-input>
          <bim-text-input vertical name="description" type="area" label="Description"></bim-text-input>
          <bim-button @click=${onSubmit} label="Create"></bim-button>
        </bim-panel-section>
      </bim-context-menu>
    `
  }
}

return BUI.html`<bim-button ${BUI.ref(onBtnCreated)} label="New Item"></bim-button>`
```

## Rules

- `contextMenuTemplate` must be assigned via `BUI.ref`, never inline in `BUI.html`.
- Inputs inside the form require the `name` attribute for `section.value` to pick them up.
- The `<bim-panel-section>` acting as a form always has `fixed` so it can't be collapsed.
- Use `section.valueTransform` to sanitize or coerce values before reading them.
- Call `BUI.ContextMenu.removeMenus()` after a successful submit to close the popup.
