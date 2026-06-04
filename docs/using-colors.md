# Using Colors

## `globals.ts` shape

```ts
export const colors = {
  GREEN: "#00FF00",
  SOFT_BLUE: "#5B8CFF",
}
```

**Colors are always stored as full hex codes, including the `#`.** This is required because some systems (like the highlighter) use the string itself as a style identifier in addition to a color value.

## Rules

- No hardcoded inline colors — not in the highlighter, not in palettes, not in any component. Always imported from `globals.ts`.
- Before adding a new color, check whether an existing one already works.

## Example: highlighter

```ts
const highlighter = components.get(OBF.Highlighter)
if (!highlighter.styles.has(colors.GREEN)) {
  highlighter.styles.set(colors.GREEN, {
    color: new THREE.Color(colors.GREEN),
    renderedFaces: 1,
    opacity: 1,
    transparent: false,
  })
}
highlighter.highlightByID(colors.GREEN, modelIdMap)
```
