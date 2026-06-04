# Coding Conventions

General coding conventions that apply across all BIM components.

---

## No shorthand property declaration in constructors

Declare properties explicitly on the class body. Never use TypeScript's constructor shorthand (`public`, `private`, `readonly` parameter modifiers):

```ts
// ✗ Avoid
constructor(public position: THREE.Vector3) {}

// ✓ Correct
position: THREE.Vector3;

constructor(position: THREE.Vector3) {
  this.position = position;
}
```

---

## Private member naming

Private **properties** use an underscore prefix. Private **methods** do not:

```ts
// Properties — underscore prefix
private _enabled = true;
private _mesh: THREE.Mesh | null = null;

// Methods — no prefix
private setupEvents() { ... }
private calculateResult() { ... }
```

---

## Backing fields with getter/setter

When a property needs to trigger side effects on assignment — firing an event, propagating a value to Three.js objects — use a private backing field with a public getter/setter:

```ts
private _visible = true;

get visible() {
  return this._visible;
}

set visible(value: boolean) {
  this._visible = value;
  for (const mesh of this._meshes) {
    mesh.visible = value;
  }
  this.onStateChanged.trigger(["visible"]);
}
```

---

## Throw in late-initialization getters

When a property only exists after `setup()` or another explicit initialization step, the getter throws a descriptive error rather than returning `undefined`. This makes the missing initialization obvious at the call site:

```ts
private _data: Data | null = null;

get data() {
  if (!this._data) {
    throw new Error("ActivityTracker: call setup() before accessing data.");
  }
  return this._data;
}
```

---

## `interface` vs `type`

Use `interface` for object shapes that may be extended or implemented by other classes. Use `type` for everything else — unions, primitive aliases, computed types, and tuples:

```ts
// ✓ interface — extendable object shape
export interface ActivityConfig {
  color: THREE.Color;
  autoColorize: boolean;
}

// ✓ type — union
export type ActivityStatus = "notStarted" | "inProgress" | "completed";

// ✓ type — primitive alias
export type ActivityId = string;

// ✓ type — tuple / computed
export type SerializedMap = [string, number[]][];
```

---

## Prefer `DataMap` and `DataSet` over native `Map` and `Set`

When storing collections inside a component, always use `FRAGS.DataMap` and `FRAGS.DataSet` instead of the native `Map` and `Set`. They have an identical API but additionally emit lifecycle events (`onItemSet`, `onBeforeDelete`, `onItemDeleted`) that other parts of the app can react to.

See [`./observable-collections.md`](./observable-collections.md) for usage patterns.

---

## `async/await` over `.then()/.catch()`

Always prefer `async/await` for asynchronous code. It is more readable and consistent with the rest of the codebase:

```ts
// ✗ Avoid
this.loadModel(buffer).then((model) => {
  this.process(model);
}).catch((err) => {
  console.error(err);
});

// ✓ Correct
async loadAndProcess(buffer: ArrayBuffer) {
  const model = await this.loadModel(buffer);
  await this.process(model);
}
```
