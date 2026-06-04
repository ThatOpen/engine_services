# Per-Frame Updates

## `OBC.Updateable`

Implement when the component needs to execute logic on every frame — animating objects, polling state, updating visual feedback.

```ts
export class ActivityTracker extends OBC.Component implements OBC.Updateable {
  readonly onBeforeUpdate = new OBC.Event<undefined>();
  readonly onAfterUpdate = new OBC.Event<undefined>();

  update(delta?: number) {
    this.onBeforeUpdate.trigger(undefined);
    // per-frame logic
    this.onAfterUpdate.trigger(undefined);
  }
}
```

The component is driven externally — a world or a setup file calls `update()` each frame. The component never drives itself.
