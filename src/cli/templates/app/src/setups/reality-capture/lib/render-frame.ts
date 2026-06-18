import * as THREE from "three";

// Shared floating-origin (RTC) state for the whole viewer.
//
// The precision stack: authoritative coordinates live in float64 (plain JS
// numbers). `origin` is a float64 world point near the camera. Every renderable
// (point node, splat) is placed at  worldAnchor - origin  computed in float64,
// then assigned to a float32 Object3D.position — which is small and safe. When
// the camera travels far, we rebase `origin` and shift everything, so GPU
// coordinates never grow large no matter the absolute world position.

export const POINT_LAYER = 1;
export const SPLAT_LAYER = 2;

export const frame = {
  // float64 render origin in world space
  origin: [0, 0, 0] as [number, number, number],
  pointSize: 3.0,
  edlStrength: 0.35,
  edlRadius: 1.4,
  edlOn: true,
};

// Place a point node at its FULL float64 world anchor. The recentering (origin
// subtraction) is done ONCE by pointContainer.position = -origin each frame — so
// world = -origin + anchor + localOffset = (worldPoint - origin), small + precise.
// (Do NOT subtract origin here too, or it gets subtracted twice.)
export function placeAtAnchor(obj: THREE.Object3D, anchor: [number, number, number]) {
  obj.position.set(anchor[0], anchor[1], anchor[2]);
  obj.updateMatrix();
}
