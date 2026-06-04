# Async Actions

## Async button handler

When a button triggers an async operation, set `target.loading = true` at the start and `false` when done — including in error paths:

```ts
const onClick = async ({ target }: { target: BUI.Button }) => {
  target.loading = true
  try {
    await doSomething()
  } finally {
    target.loading = false
  }
}
```

Always restore `target.loading = false` in error paths. If an exception is thrown and loading is not reset, the button stays stuck in the loading state.
