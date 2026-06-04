# Panel Section Layout

## Composition mental model

A panel section has zones that follow a natural sequence reflecting how the user processes the panel: first they act on the context (controls), then understand the current state (messages), then operate on the selected item (toolbar), then see the data (main content), and finally execute high-impact actions (bottom).

```
<bim-panel-section label="..." icon="..." fixed?>
  [controls bar]      ← search or selector + action buttons
  [status messages]   ← conditional bim-labels (warn, success, info)
  [actions toolbar]   ← bim-toolbar when there are many actions on the active item
  [main content]      ← table, list, or sub-component
  [primary actions]   ← 1-2 high-impact buttons at the bottom
</bim-panel-section>
```

Not all zones are always present. This sequence is a guide, not a mandatory template — if the panel's content breaks that flow in a way that improves the experience, propose the layout that makes the most sense and explain the reasoning.

### Forbidden nesting

Inside a `<bim-panel-section>` it is **never** valid to place:

- Another `<bim-panel-section>`
- A `<bim-panel>`

This mistake is most tempting when the user asks to "group" sections. The correct answer is **not** nesting — it is creating independent templates. A template does not decide how it is grouped with others; that is the consumer's responsibility. If the content truly belongs in one section, use the existing internal zones (`controls bar`, `toolbar`, `main content`). If it needs to be split into multiple sections, each section is its own independent template.

---

## Controls bar

Always a `<div style="display: flex; gap: 0.5rem;">`. There are two main variants:

**Search** — when the user filters over a list or table:
```ts
return BUI.html`
  <bim-panel-section label="Elements">
    <div style="display: flex; gap: 0.5rem;">
      <bim-text-input @input=${onSearch} vertical placeholder="Search..."></bim-text-input>
      <bim-button icon=${icons.ADD} @click=${onCreate}></bim-button>
    </div>
    ${table}
  </bim-panel-section>
`
```

**Selector** — when the user picks the active item from a dropdown. The gap is tighter (`0.25rem`) because the dropdown already takes most of the width:
```ts
return BUI.html`
  <bim-panel-section label="Proposals">
    <div style="display: flex; gap: 0.25rem;">
      ${proposalsDropdown}
      <bim-button icon=${icons.ADD} @click=${onCreate}></bim-button>
    </div>
    ${content}
  </bim-panel-section>
`
```

Action buttons in the controls bar are always icon-only (`icon=` without `label=`). The search `<bim-text-input>` always has `vertical` and `debounce="200"`.

---

## Status messages

Conditional `<bim-label>` elements that appear between the controls and the content to communicate the state of the active item — warnings, confirmations, relevant info. Built as optional variables:

```ts
let statusMessage: BUI.TemplateResult | undefined
if (item?.status === "sent") {
  statusMessage = BUI.html`<bim-label>This item has been sent and can't be modified.</bim-label>`
}

return BUI.html`
  <bim-panel-section label="...">
    ${controls}
    ${statusMessage}
    ${content}
  </bim-panel-section>
`
```

---

## Actions toolbar

When there are many actions on the active item (more than 3-4 buttons), use `<bim-toolbar>` with `<bim-toolbar-section>` instead of a plain flex div. The toolbar goes after the status messages and before the main content:

```ts
const toolbar = BUI.html`
  <bim-toolbar style="border: 1px solid var(--bim-ui_bg-contrast-20);">
    <bim-toolbar-section>
      ${addItemBtn}
      <bim-button style="flex: 0" icon=${icons.SELECT} @click=${onSelect}></bim-button>
      <bim-button style="flex: 0" icon=${icons.DELETE} @click=${onDelete}></bim-button>
    </bim-toolbar-section>
  </bim-toolbar>
`
```

Buttons inside the toolbar always have `style="flex: 0"` to prevent them from stretching.

---

## Conditional content

When the panel content changes completely based on state (e.g. "select something first" vs. showing data), assign to a variable before the `return`:

```ts
let content: BUI.TemplateResult
if (hasSelection) {
  content = BUI.html`<bim-table ...></bim-table>`
} else {
  content = BUI.html`<bim-label>Select an element to see its data.</bim-label>`
}

return BUI.html`
  <bim-panel-section label="...">
    ${controls}
    ${content}
  </bim-panel-section>
`
```
