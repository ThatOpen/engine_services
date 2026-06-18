import * as OBC from "@thatopen/components";
import type { ClipperTool } from "./clipper-tool";
import type { MeasurementTool } from "./measurement-tool";

/**
 * Unified "Objects" outliner API (W2's new panel). Enumerates every created clip
 * plane and every measurement as a flat list of {@link InstanceRow}s with
 * per-instance HIDE / DISABLE / DELETE, so W2 can render rows without knowing
 * about the individual Clipping / Measurement tools.
 *
 * Shapes are owned here and produced by each tool's `instances()`; this module
 * just merges them and fans the two tools' change events into one.
 */
export type InstanceKind = "clip" | "measurement";

export interface InstanceRow {
  /** Stable id (plane id for clips; per-measurement id) — use as the row key. */
  id: string;
  kind: InstanceKind;
  /** "Clip plane" | "Length" | "Area" | "Angle". */
  type: string;
  /** User-facing row label (includes the measured value for measurements). */
  label: string;
  /** Currently shown in the scene. */
  visible: boolean;
  /** Clip planes only: whether the plane is actively cutting. `undefined` for measurements. */
  enabled?: boolean;
  /** Show/hide this instance without deleting it. */
  setVisible(on: boolean): void;
  /** Clip planes only: toggle the cut on/off (present only when `enabled` is defined). */
  setEnabled?(on: boolean): void;
  /** Permanently remove this instance. */
  remove(): void;
}

export interface InspectionInstances {
  /** Snapshot of all clip planes + measurements, in that order. */
  list(): InstanceRow[];
  /** Fires whenever the set or state of instances changes (re-query `list()`). */
  readonly onChanged: OBC.Event<void>;
}

/**
 * A toolbar action W2 wires into the new "Inspection" tab. Each `activate()`
 * routes through the toolModeManager (exclusive — entering one exits any other
 * tool). W2 drives the Select button + active highlighting via
 * `toolModeManager.selectMode()` / `getActiveId()` / `onActiveChanged`; each
 * action's own `isActive()` is provided for convenience.
 */
export interface InspectionAction {
  id: string;
  label: string;
  /** mdi icon name (e.g. "mdi:ruler"). */
  icon: string;
  activate(): void;
  isActive(): boolean;
}

/**
 * Inspection toolbar actions: clip plane + the measurement types/modes. Order is
 * the toolbar order. measure-edge/face reuse Length/Area with a forced sub-mode;
 * measure-length/area are the plain "free" modes (isActive distinguishes them by
 * sub-mode). Volume is a distinct measurer.
 */
export const inspectionActions = (
  clipperTool: ClipperTool,
  measurementTool: MeasurementTool,
): InspectionAction[] => {
  const m = measurementTool;
  const isMeasure = (mode: string, sub: string) =>
    m.getMode() === mode && m.getSubMode() === sub;
  return [
    {
      id: "clip-plane",
      label: "Clip plane",
      icon: "mdi:scissors-cutting",
      activate: () => clipperTool.setPlacing(true),
      isActive: () => clipperTool.isPlacing(),
    },
    {
      id: "measure-length",
      label: "Length",
      icon: "mdi:ruler",
      activate: () => m.setMode("length", "free"),
      isActive: () => isMeasure("length", "free"),
    },
    {
      id: "measure-area",
      label: "Area",
      icon: "mdi:vector-polygon",
      activate: () => m.setMode("area", "free"),
      isActive: () => isMeasure("area", "free"),
    },
    {
      id: "measure-angle",
      label: "Angle",
      icon: "mdi:angle-acute",
      activate: () => m.setMode("angle"),
      isActive: () => m.getMode() === "angle",
    },
    {
      id: "measure-edge",
      label: "Edge",
      icon: "mdi:vector-line",
      activate: () => m.setMode("length", "edge"),
      isActive: () => isMeasure("length", "edge"),
    },
    {
      id: "measure-face",
      label: "Face",
      icon: "mdi:vector-square",
      activate: () => m.setMode("area", "face"),
      isActive: () => isMeasure("area", "face"),
    },
    {
      id: "volume",
      label: "Volume",
      icon: "mdi:cube-outline",
      activate: () => m.setMode("volume"),
      isActive: () => m.getMode() === "volume",
    },
  ];
};

export const inspectionInstances = (
  clipperTool: ClipperTool,
  measurementTool: MeasurementTool,
): InspectionInstances => {
  const onChanged = new OBC.Event<void>();
  clipperTool.onChanged.add(() => onChanged.trigger());
  measurementTool.onChanged.add(() => onChanged.trigger());
  return {
    list: () => [...clipperTool.instances(), ...measurementTool.instances()],
    onChanged,
  };
};
