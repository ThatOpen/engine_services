# Confirmation Dialog

The standard way to ask the user to confirm a destructive or irreversible action is a `contextMenuTemplate` on a `bim-button`. The menu opens lazily when clicked and contains Confirm / Cancel buttons.

## Setup

`contextMenuTemplate` must always be assigned via `BUI.ref` — never inline in `BUI.html`:

```ts
const onBtnCreated = (e?: Element) => {
  if (!e) return
  const btn = e as BUI.Button
  btn.contextMenuTemplate = () => {
    const onConfirm = async ({ target }: { target: BUI.Button }) => {
      target.loading = true
      await doSomething()
      target.loading = false
      BUI.ContextMenu.removeMenus()
    }

    const onCancel = () => {
      BUI.ContextMenu.removeMenus()
    }

    return BUI.html`
      <bim-context-menu>
        <bim-button @click=${onConfirm} label="Confirm"></bim-button>
        <bim-button @click=${onCancel} label="Cancel"></bim-button>
      </bim-context-menu>
    `
  }
}

return BUI.html`<bim-button ${BUI.ref(onBtnCreated)} icon="delete"></bim-button>`
```

## Closing the menu

Call `BUI.ContextMenu.removeMenus()` after the action completes (or is cancelled) to dismiss the popup. Without it, the menu stays open after the user clicks.
