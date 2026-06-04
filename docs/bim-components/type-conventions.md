# Type Conventions

All types for a component live in `src/types.ts` — domain interfaces, event payloads, serialized equivalents — so there is a single place to look.

---

## Runtime vs serialized

Components that implement `OBC.Serializable` need two versions of their data types: a runtime version that uses rich TypeScript types, and a serialized version that is JSON-safe.

The serialized type is named `Serialized{TypeName}`:

```ts
// Runtime — uses Map, Set, Date, THREE.Color
export interface Activity {
  index: number;
  name: string;
  color: THREE.Color;
  items: OBC.ModelIdMap;
  dates: Set<string>;
}

// Serialized — JSON-safe equivalent
export interface SerializedActivity {
  index: number;
  name: string;
  color: string;             // THREE.Color → hex string
  items: [string, number[]][]; // ModelIdMap → tuple array
  dates: string[];           // Set → array
}
```

Conversion happens inside `export()` and `import()` (see [`./save-and-restore-state.md`](./save-and-restore-state.md)).

---

## Generics that require `type`, not `interface`

Some OBC and FRAGS generics enforce that their type parameter is a `type` alias. Passing an `interface` causes a TypeScript error. When in doubt, prefer `type` for types used as generic parameters:

```ts
// ✗ Fails — interface not assignable to the generic constraint
export interface ActivityData { name: string; value: number }
const list = new FRAGS.DataMap<string, ActivityData>(); // error

// ✓ Correct
export type ActivityData = { name: string; value: number }
const list = new FRAGS.DataMap<string, ActivityData>();
```
