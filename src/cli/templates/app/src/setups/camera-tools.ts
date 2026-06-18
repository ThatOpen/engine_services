import * as THREE from "three";
import * as OBC from "@thatopen/components";

/**
 * Camera tools for the viewer toolbar. Returns controllers matching the
 * toolbar's integration contract:
 *  - `fitAll`  — ACTION: fit the camera to the whole loaded model.
 *  - `orthoToggle` — TOGGLE: switch the projection Perspective ⇄ Orthographic.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const firstWorld = (components: OBC.Components): any =>
  [...components.get(OBC.Worlds).list.values()][0];

export interface CameraTools {
  fitAll: { label: string; icon: string; run(): Promise<void> };
  orthoToggle: {
    label: string;
    icon: string;
    active(): boolean;
    activate(): Promise<void>;
    deactivate(): Promise<void>;
  };
}

export const cameraTools = (components: OBC.Components): CameraTools => {
  const fragments = components.get(OBC.FragmentsManager);

  return {
    fitAll: {
      label: "Zoom to fit",
      icon: "mdi:fit-to-page-outline",
      async run() {
        const controls = firstWorld(components)?.camera?.controls;
        if (!controls) return;
        // Union every loaded model's bounding box, then frame its sphere —
        // fitToSphere preserves the current view direction (no rotation snap).
        const box = new THREE.Box3();
        for (const model of fragments.list.values()) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = (model as any).box as THREE.Box3 | undefined;
          if (b && !b.isEmpty()) box.union(b);
        }
        if (box.isEmpty()) return;
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        await controls.fitToSphere(sphere, true);
      },
    },
    orthoToggle: {
      label: "Orthographic",
      icon: "mdi:angle-right",
      active() {
        return firstWorld(components)?.camera?.projection?.current === "Orthographic";
      },
      async activate() {
        await firstWorld(components)?.camera?.projection?.set?.("Orthographic");
      },
      async deactivate() {
        await firstWorld(components)?.camera?.projection?.set?.("Perspective");
      },
    },
  };
};
