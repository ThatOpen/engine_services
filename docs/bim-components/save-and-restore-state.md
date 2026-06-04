# Save and Restore State

## `OBC.Serializable<D, S>`

Implement when the component must persist its state — to a file, to the cloud, or across sessions.

`D` is the runtime type, `S` is the serialized (JSON-safe) equivalent. Both are defined in `src/types.ts`. See [`./type-conventions.md`](./type-conventions.md) for the serialization patterns, including the `localId` → GUID conversion that must happen before storing any item references.

```ts
export class ActivityTracker extends OBC.Component
  implements OBC.Serializable<ActivityTrackerData, SerializedActivityTrackerData> {

  export(): SerializedActivityTrackerData {
    // convert runtime state to JSON-safe structure
  }

  import(data: SerializedActivityTrackerData) {
    // restore runtime state from serialized structure
  }
}
```
