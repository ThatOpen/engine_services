import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import type { ModeTool } from "./tool-mode";

// Brand purple, matching the selection outline so measurements read as "ours".
const MEASURE_COLOR = 0x6528d7;

const canvasOf = (world: OBC.World): HTMLCanvasElement => {
  const canvas = (world.renderer as OBF.PostproductionRenderer | null)?.three
    .domElement;
  if (!canvas) {
    throw new Error("measurements setup: world has no renderer with a canvas");
  }
  return canvas;
};

/**
 * Length-measurement tool. Wraps `OBF.LengthMeasurement` as a toolbar mode tool:
 *
 *  - double-click places measurement points (snapping to vertices/edges); a
 *    dimension line + label is drawn between them,
 *  - Escape cancels the in-progress measurement (handled by the component),
 *  - Delete / Backspace → delete the measurement under the cursor,
 *  - Shift + Delete / Shift + Backspace → clear ALL measurements.
 *
 * Finished measurements persist when the mode is exited.
 */
export const lengthMeasurement = (
  components: OBC.Components,
  world: OBC.World,
): ModeTool => {
  const measurer = components.get(OBF.LengthMeasurement);
  measurer.world = world;
  measurer.color = new THREE.Color(MEASURE_COLOR);
  const canvas = canvasOf(world);

  const onDblClick = () => measurer.create();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Delete" && event.code !== "Backspace") return;
    if (event.shiftKey) {
      measurer.list.clear();
    } else {
      void measurer.delete();
    }
  };

  let active = false;

  return {
    label: "Measure length",
    icon: "mdi:ruler",
    activate() {
      if (active) return;
      active = true;
      measurer.enabled = true;
      canvas.addEventListener("dblclick", onDblClick);
      window.addEventListener("keydown", onKeyDown);
      canvas.style.cursor = "crosshair";
    },
    deactivate() {
      if (!active) return;
      active = false;
      measurer.cancelCreation(); // drop any half-finished measurement
      measurer.enabled = false;
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKeyDown);
      canvas.style.cursor = "";
    },
  };
};

/**
 * Area-measurement tool. Wraps `OBF.AreaMeasurement` as a toolbar mode tool:
 *
 *  - double-click adds polygon points; Enter closes/finalizes the polygon and
 *    shows the filled area + value,
 *  - Escape cancels the in-progress polygon (handled by the component),
 *  - Delete / Backspace → delete the area under the cursor,
 *  - Shift + Delete / Shift + Backspace → clear ALL areas.
 *
 * NOTE: the click-to-add-point vs. double-click-to-create flow is worth a live
 * check; tuned here to mirror the length tool's double-click entry.
 */
export const areaMeasurement = (
  components: OBC.Components,
  world: OBC.World,
): ModeTool => {
  const measurer = components.get(OBF.AreaMeasurement);
  measurer.world = world;
  measurer.color = new THREE.Color(MEASURE_COLOR);
  const canvas = canvasOf(world);

  const onDblClick = () => measurer.create();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      measurer.endCreation();
      return;
    }
    if (event.code !== "Delete" && event.code !== "Backspace") return;
    if (event.shiftKey) {
      measurer.list.clear();
    } else {
      void measurer.delete();
    }
  };

  let active = false;

  return {
    label: "Measure area",
    icon: "mdi:vector-square",
    activate() {
      if (active) return;
      active = true;
      measurer.enabled = true;
      canvas.addEventListener("dblclick", onDblClick);
      window.addEventListener("keydown", onKeyDown);
      canvas.style.cursor = "crosshair";
    },
    deactivate() {
      if (!active) return;
      active = false;
      measurer.cancelCreation();
      measurer.enabled = false;
      canvas.removeEventListener("dblclick", onDblClick);
      window.removeEventListener("keydown", onKeyDown);
      canvas.style.cursor = "";
    },
  };
};
