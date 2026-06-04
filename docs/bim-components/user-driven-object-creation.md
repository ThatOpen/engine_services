# User-Driven Object Creation

## `OBC.Createable`

Implement when the component lets the user create objects in the scene through a multi-step interaction — click to start, click to confirm, Escape to cancel, click existing to delete.

The key characteristic is **statefulness between clicks**: `create()` is called on every user click, but the first click initiates the workflow and the second confirms it by calling `endCreation()` internally.

```ts
export class ActivityTracker extends OBC.Component implements OBC.Createable {
  private _temp: { isDragging: boolean; preview?: SomeObject } = {
    isDragging: false,
  };

  create = () => {
    if (!this.enabled) return;
    if (!this._temp.isDragging) {
      this._temp.isDragging = true;
      this._temp.preview = new SomeObject();
      return;
    }
    this.endCreation();
  };

  endCreation = () => {
    if (!this._temp.preview) return;
    this.list.add(this._temp.preview);
    this._temp.isDragging = false;
    this._temp.preview = undefined;
  };

  cancelCreation = () => {
    this._temp.isDragging = false;
    this._temp.preview?.dispose();
    this._temp.preview = undefined;
  };

  delete = () => {
    if (!this.world) return;
    const casters = this.components.get(OBC.Raycasters);
    const caster = casters.get(this.world);
    const intersect = caster.castRayToObjects([...this._boundingBoxes]);
    if (!intersect) return;
    // identify and remove the hit object from list
  };
}
```

Wire up the Escape key in the component's `enabled` setter so `cancelCreation()` fires automatically when the component is disabled mid-flow:

```ts
set enabled(value: boolean) {
  this._enabled = value;
  if (!value) this.cancelCreation();
}
```
