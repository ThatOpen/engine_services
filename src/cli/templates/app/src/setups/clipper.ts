import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import type { ModeTool } from "./tool-mode";

/**
 * Section / clipping-planes tool. Wraps `OBC.Clipper` as a toolbar mode tool:
 *
 *  - double-click on the model → create a clip plane on the surface under the
 *    pointer (raycast; the plane's normal is the hit face normal),
 *  - drag the plane's arrow gizmo to move it along its normal (handled by the
 *    Clipper's built-in TransformControls while the mode is active),
 *  - Delete / Backspace → delete the plane under the cursor,
 *  - Shift + Delete / Shift + Backspace → clear ALL section planes.
 *
 * Clipping is applied through `renderer.three.clippingPlanes` with
 * `localClippingEnabled = true` (set by the SimpleRenderer), so the cut is
 * honored during the deferred pipeline's single capture render — no
 * deferred-lib change is needed. (Worth an explicit live check that the section
 * actually cuts geometry in deferred mode.)
 *
 * Leaving the mode keeps the existing section planes cutting the model (so a
 * section persists while navigating); it only stops creating/dragging new ones.
 */
export const clipper = (
  components: OBC.Components,
  world: OBC.World,
): ModeTool => {
  const clipperComp = components.get(OBC.Clipper);

  const canvas = (world.renderer as OBF.PostproductionRenderer | null)?.three
    .domElement;
  if (!canvas) {
    throw new Error("clipper setup: world has no renderer with a canvas");
  }

  const onDblClick = () => {
    void clipperComp.create(world);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Delete" && event.code !== "Backspace") return;
    if (event.shiftKey) {
      clipperComp.deleteAll();
    } else {
      // No-op when nothing is hovered (the Clipper raycasts for a plane).
      void clipperComp.delete(world);
    }
  };

  let active = false;

  return {
    label: "Section",
    icon: "mdi:scissors-cutting",
    activate() {
      if (active) return;
      active = true;
      clipperComp.enabled = true; // allow create + drag-to-move
      clipperComp.visible = true;
      canvas.addEventListener("dblclick", onDblClick);
      window.addEventListener("keydown", onKeyDown);
      canvas.style.cursor = "crosshair";
    },
    deactivate() {
      if (!active) return;
      active = false;
      // Stop creating / dragging, but keep the planes in the renderer's
      // clippingPlanes so the section stays cut while navigating.
      clipperComp.enabled = false;
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKeyDown);
      canvas.style.cursor = "";
    },
  };
};
