# Expose Events

## `OBC.Event<T>`

Events are declared as `readonly` properties on the class. The type parameter `T` defines the payload — use `undefined` when there's nothing to pass.

Payload types are defined in `src/types.ts`, not inline, following the `{EventName}Payload` convention:

```ts
// src/types.ts
export type OperationCompletedPayload = { result: CalculationResult }

// index.ts
readonly onOperationCompleted = new OBC.Event<OperationCompletedPayload>();
```

**Triggering** — always after the fact, once the operation or change is done:

```ts
this.onOperationCompleted.trigger({ result });
this.onDisposed.trigger(undefined);
```

**Subscribing** — done externally by consumers:

```ts
const tracker = components.get(ActivityTracker);
tracker.onOperationCompleted.add(({ result }) => { ... });
```

---

## `onStateChanged` pattern

When a component has several reactive properties, a single `onStateChanged` event with a union payload is cleaner than one event per property:

```ts
readonly onStateChanged = new OBC.Event<("enabled" | "color" | "mode")[]>();

private _enabled = true;

get enabled() {
  return this._enabled;
}

set enabled(value: boolean) {
  this._enabled = value;
  this.onStateChanged.trigger(["enabled"]);
}
```

Consumers can inspect the payload to react only to the properties they care about:

```ts
tracker.onStateChanged.add((changed) => {
  if (changed.includes("color")) updateColorUI();
});
```

---

## `OBC.Eventable` and `EventManager`

Any component that exposes events must implement `OBC.Eventable` and use `EventManager`. Register every event in the constructor and call `events.reset()` in `dispose()`:

```ts
export class ActivityTracker extends OBC.Component implements OBC.Eventable {
  readonly onDisposed = new OBC.Event<undefined>();
  readonly onStateChanged = new OBC.Event<string[]>();

  readonly events = new OBC.EventManager();

  constructor(components: OBC.Components) {
    super(components);
    components.add(ActivityTracker.uuid, this);
    this.events.list.add(this.onDisposed);
    this.events.list.add(this.onStateChanged);
  }

  dispose() {
    this.events.reset();
  }
}
```
