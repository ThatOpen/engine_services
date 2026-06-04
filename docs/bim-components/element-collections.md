# Element Collections

`OBC.ModelIdMap` is the only acceptable way to reference a collection of elements in a `FragmentsModel`. Any method that operates on items — highlighting, hiding, filtering, calculating — takes or returns a `ModelIdMap`.

---

## `OBC.ModelIdMap`

Maps a model ID to a `Set` of local IDs:

```ts
// Shape: { [modelId: string]: Set<number> }
const items: OBC.ModelIdMap = {
  "model-a": new Set([1, 2, 3]),
  "model-b": new Set([7, 8]),
};

// Iterating
for (const [modelId, localIds] of Object.entries(items)) {
  const model = fragments.list.get(modelId);
  for (const localId of localIds) { ... }
}
```

---

## `OBC.ModelIdDataMap<T>`

Associates data of type `T` per item — a `DataMap<string, DataMap<number, T>>`. Used when a component stores per-item state:

```ts
const progress: OBC.ModelIdDataMap<{ startDate: Date }> = new FRAGS.DataMap();

// Write
let byLocalId = progress.get("model-a");
if (!byLocalId) {
  byLocalId = new FRAGS.DataMap();
  progress.set("model-a", byLocalId);
}
byLocalId.set(42, { startDate: new Date() });

// Read
const itemProgress = progress.get("model-a")?.get(42);
```

---

## `OBC.ModelIdMapUtils`

Static utility class for operating on `ModelIdMap` collections. Use it to combine, filter, compare, and serialize selections rather than implementing those operations manually:

```ts
import * as OBC from "@thatopen/components"

// Combine two selections
const combined = OBC.ModelIdMapUtils.join([selectionA, selectionB]);

// Remove deselected items from current selection
OBC.ModelIdMapUtils.remove(current, deselected);

// Guard before processing
if (OBC.ModelIdMapUtils.isEmpty(items)) return;

// Serialize for storage (Set<number> → number[])
const raw = OBC.ModelIdMapUtils.toRaw(items);

// Restore from storage
const restored = OBC.ModelIdMapUtils.fromRaw(raw);
```
