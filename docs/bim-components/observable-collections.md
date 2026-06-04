# Observable Collections

`FRAGS.DataMap` and `FRAGS.DataSet` are lifecycle-aware extensions of `Map` and `Set`. The only difference from their native counterparts is that they emit events when items are added or removed, making the collection observable.

Use `DataMap` when there is a clear key to identify each item. Use `DataSet` when the item itself is the identifier. `DataMap` is the default choice in most cases.

---

## `FRAGS.DataMap<K, V>`

### Declaration

The primary collection of a component is conventionally named `list`:

```ts
import * as FRAGS from "@thatopen/fragments"

readonly list = new FRAGS.DataMap<string, SpotElevation>();
```

### Reactive events

```ts
this.list.onItemSet.add(({ key, value }) => {
  // called after an item is added
});

this.list.onBeforeDelete.add(({ key, value }) => {
  // called before an item is removed — use to clean up resources
});

this.list.onItemDeleted.add(({ key }) => {
  // called after an item is removed
});
```

### Get-or-create

When inserting into a `DataMap` where the entry may not exist yet, use a get-or-create pattern:

```ts
let entry = this.list.get(key);
if (!entry) {
  entry = new SpotElevation();
  this.list.set(key, entry);
}
entry.doSomething();
```

### Guard

A guard runs before every `set()` call and can block the insertion by returning `false`:

```ts
this.list.guard = (key, value) => {
  return value.isValid;
};
```

---

## `FRAGS.DataSet<T>`

Same API as `DataMap` but without keys — the item itself is the identifier:

```ts
readonly list = new FRAGS.DataSet<SpotElevation>();

this.list.onItemSet.add(({ value }) => { ... });
this.list.onBeforeDelete.add(({ value }) => { ... });
```

---

## Collections of auxiliary class instances

When a component manages instances of its own auxiliary classes, cleanup typically happens in `onBeforeDelete`:

```ts
this.list.onBeforeDelete.add(({ value: spotElevation }) => {
  spotElevation.dispose();
});
```
