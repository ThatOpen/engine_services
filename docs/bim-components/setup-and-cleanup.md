# Setup and Cleanup

Two interfaces govern a component's lifecycle: `OBC.Configurable` for one-time initialization before use, and `OBC.Disposable` for cleanup when the component is destroyed.

---

## `OBC.Configurable<TManager, TConfig>`

Implement when the component requires one-time initialization. This separates construction (cheap, no side effects) from setup (resolves dependencies, applies config, registers event listeners).

```ts
export interface ActivityTrackerConfig {
  color: THREE.Color;
  autoColorize: boolean;
}

export class ActivityTracker extends OBC.Component
  implements OBC.Configurable<ActivityTrackerConfigManager, ActivityTrackerConfig> {

  isSetup = false;
  readonly onSetup = new OBC.Event<undefined>();

  protected _defaultConfig: ActivityTrackerConfig = {
    color: new THREE.Color("#6528d7"),
    autoColorize: false,
  };

  setup(config?: Partial<ActivityTrackerConfig>) {
    if (this.isSetup) return;
    const fullConfig = { ...this._defaultConfig, ...config };
    // apply config, resolve dependencies...
    this.isSetup = true;
    this.onSetup.trigger(undefined);
  }
}
```

The `if (this.isSetup) return` guard ensures setup only runs once. The constructor must never call other components — that belongs in `setup()`.

---

## `OBC.Disposable`

Implement when the component holds resources that must be explicitly released — Three.js geometries and materials, event subscriptions to external components, workers.

```ts
export class ActivityTracker extends OBC.Component implements OBC.Disposable {
  readonly onDisposed = new OBC.Event<undefined>();

  dispose() {
    // 1. Release Three.js resources
    this._mesh?.geometry.dispose();
    this._material.dispose();

    // 2. Reset all events (if OBC.Eventable is also implemented)
    this.events.reset();

    // 3. Signal disposal — always last
    this.onDisposed.trigger(undefined);
  }
}
```

`onDisposed` must be triggered at the end of `dispose()`, after all cleanup is done.
