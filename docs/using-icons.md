# Using Icons

## Icon registry rules

**All icons in a platform app must be declared in `globals.ts` and accessed through `AppManager`.** This is not optional.

The flow is always:
1. Declare the icon in `globals.ts` with a `UPPER_SNAKE_CASE` key
2. `app.ts` — the `App` type's `icons` field is typed as `(keyof typeof icons)[]`, which means any new key added to the registry is automatically reflected in the type — no manual update needed per icon, but this field must be present in the `App` type
3. Pass the registry to `app.init()` as `icons: appIcons`
4. Access icons elsewhere via `app.icons.KEY_NAME` (always through `getAppManager(components)`)

```ts
// ✗ Forbidden — inline icon string anywhere in the app
<bim-button icon="ic:round-warning"></bim-button>
grid.layouts = { Viewer: { icon: "ic:round-warning", template: `...` } }

// ✓ Correct — always via the registry
const app = getAppManager(components)
<bim-button icon=${app.icons.WARNING}></bim-button>
grid.layouts = { Viewer: { icon: app.icons.WARNING, template: `...` } }
```

## Before adding a new icon

Before declaring a new icon in `globals.ts`, check if an existing one in the registry already serves the purpose. Reuse an existing icon when it communicates the same intent — avoid registry bloat.

If no existing icon fits, add it to `globals.ts` first — then use it through `app.icons`.

## `globals.ts` shape

```ts
export const icons = {
  WARNING: "ic:round-warning",
  COLLISION: "fa7-solid:explosion",
}
```
