# Display Text

Always use `<bim-label>` for all text content inside templates.

## Static text

```ts
return BUI.html`<bim-label>Fixed text</bim-label>`
```

## Dynamic text (template interpolation)

```ts
return BUI.html`<bim-label>${someText}</bim-label>`
```

## Updating text imperatively

Use `.textContent` to update a `bim-label` from outside the template. Never use `.label` — that property belongs to other components (`bim-button`, `bim-option`, etc.), not to `bim-label`:

```ts
const label = section.querySelector("bim-label")!
label.textContent = "Updated text"  // ✓ correct
label.label = "Updated text"        // ✗ avoid — .label is not a property of bim-label
```

## The label attribute belongs to other components

`label` is an attribute/property of interactive components that display a text caption alongside an icon or control:

```ts
// ✓ correct — label attribute on button, option, etc.
BUI.html`<bim-button label="Confirm"></bim-button>`
BUI.html`<bim-option label="Model A"></bim-option>`
BUI.html`<bim-text-input label="Name" vertical></bim-text-input>`

// ✗ avoid — label is not a property of bim-label
BUI.html`<bim-label label="Some text"></bim-label>`
```
