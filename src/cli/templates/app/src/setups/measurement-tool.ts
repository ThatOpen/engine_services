import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import { toolModeManager, type ManagedTool } from "./tool-mode-manager";
import type { InstanceRow } from "./inspection";

/**
 * Measurement TOOL (logic only; the UI lives in measurement-panel.ts).
 *
 * Drives the three OBF measurers — Length (point-to-point), Area (polygon) and
 * Angle (3-point) — as exclusive MODES:
 *  - pick a mode → that measurer is enabled and a viewport double-click places
 *    points (Length: 2 pts; Area: N pts, Enter to close; Angle: 3 pts),
 *  - Escape cancels the in-progress measurement, Delete removes the one under the
 *    cursor (Shift+Delete clears all).
 *
 * SNAPPING (the thing that makes dimensions reliable vs eyeballed) is the
 * library's vertex/edge/face snapper, on for all three classes by default; the
 * panel can toggle each class. The snapper resolves the nearest snap target under
 * the cursor (vertices win ties), which is exactly what we want for precise picks.
 *
 * Exposes aggregated rows (type + value + units) over all three lists, plus
 * onChanged/onModeChanged so the panel re-renders.
 */
export type MeasureMode = "none" | "length" | "area" | "angle" | "volume";
export type SnapKind = "point" | "line" | "face";

export type LengthUnit = "mm" | "cm" | "m" | "km";
export type AreaUnit = "mm2" | "cm2" | "m2" | "km2";
export type AngleUnit = "deg" | "rad";

/** Snapshot for W2's merged Settings panel (measurement section). */
export interface MeasurementSettings {
  color: string; // "#rrggbb" — applied to all measurement types
  units: { length: LengthUnit; area: AreaUnit; angle: AngleUnit };
  /** Valid unit options per type (for the dropdowns). */
  unitOptions: { length: string[]; area: string[]; angle: string[] };
  rounding: number; // decimal places
  snaps: Record<SnapKind, boolean>;
  visible: boolean;
  /** Line width (px) for Length/Area fat lines. (Angle is 1px until its arc is converted.) */
  thickness: number;
}

export interface MeasurementRow {
  key: string;
  type: string;
  text: string; // e.g. "5.25 m"
  remove(): void;
}

export interface MeasurementTool {
  readonly onChanged: OBC.Event<void>;
  readonly onModeChanged: OBC.Event<void>;
  /**
   * Activate a measurement type. `subMode` forces the measurer's creation mode —
   * "edge" for Length (snap to edges), "face" for Area (measure a face) — so the
   * toolbar's measure-edge / measure-face actions reuse Length/Area with the right
   * mode. Defaults each measurer back to "free" when omitted.
   */
  setMode(mode: MeasureMode, subMode?: string): void;
  /** Current measurer sub-mode (e.g. "edge"/"face"/"free"), for action isActive(). */
  getSubMode(): string;
  getMode(): MeasureMode;
  rows(): MeasurementRow[];
  /** Per-measurement rows for the Objects outliner (W2): hide / delete. */
  instances(): InstanceRow[];
  clearAll(): void;
  setVisible(on: boolean): void;
  isVisible(): boolean;
  getSnaps(): Record<SnapKind, boolean>;
  setSnap(kind: SnapKind, on: boolean): void;
  // ── Settings (W2 Settings panel) ──
  getMeasurementSettings(): MeasurementSettings;
  setColor(hex: string): void;
  setUnits(type: "length" | "area" | "angle", value: string): void;
  setRounding(decimals: number): void;
  /** Line width (px) for Length/Area fat lines. */
  setThickness(px: number): void;
}

const COLOR = 0x6528d7;

type Measurer =
  | OBF.LengthMeasurement
  | OBF.AreaMeasurement
  | OBF.AngleMeasurement
  | OBF.VolumeMeasurement;

export const measurementTool = (
  components: OBC.Components,
): MeasurementTool => {
  const length = components.get(OBF.LengthMeasurement);
  const area = components.get(OBF.AreaMeasurement);
  const angle = components.get(OBF.AngleMeasurement);
  const volume = components.get(OBF.VolumeMeasurement);
  const all: Measurer[] = [length, area, angle, volume];

  const worlds = components.get(OBC.Worlds);
  const getWorld = () => [...worlds.list.values()][0] as OBC.World | undefined;

  const onChanged = new OBC.Event<void>();
  const onModeChanged = new OBC.Event<void>();

  // Snapping: all three classes on by default (vertices, edges, faces).
  const snaps: Record<SnapKind, boolean> = { point: true, line: true, face: true };
  const snapClass: Record<SnapKind, FRAGS.SnappingClass> = {
    point: FRAGS.SnappingClass.POINT,
    line: FRAGS.SnappingClass.LINE,
    face: FRAGS.SnappingClass.FACE,
  };
  const applySnaps = () => {
    const list = (Object.keys(snaps) as SnapKind[])
      .filter((k) => snaps[k])
      .map((k) => snapClass[k]);
    for (const m of all) m.snappings = list;
  };

  // Stable per-measurement ids (entry object → id) so W2's outliner row keys
  // survive deletion of OTHER rows (index-based ids would shift).
  const entryIds = new WeakMap<object, string>();
  let entrySeq = 0;
  const idFor = (entry: object): string => {
    let id = entryIds.get(entry);
    if (!id) {
      id = `m${++entrySeq}`;
      entryIds.set(entry, id);
    }
    return id;
  };

  let mode: MeasureMode = "none";
  let subMode = "free"; // measurer creation mode: "free" | "edge" (Length) | "face"/"square" (Area)
  let visible = true;
  let canvas: HTMLElement | undefined;
  let wired = false;

  const manager = toolModeManager(components);
  // When another tool takes over, drop measure mode locally (manager handles
  // hover/select suppression).
  const managed: ManagedTool = {
    id: "measure",
    label: () => (mode === "none" ? "Measuring" : `Measuring ${mode}`),
    icon: "mdi:ruler",
    onDeactivate: () => {
      for (const m of all) {
        m.cancelCreation();
        // Only flip when it actually changes. Some measurers' enabled-setter has
        // side effects — VolumeMeasurement toggles the GLOBAL Hoverer on/off — and
        // firing that spuriously (disabling an already-disabled measurer) corrupts
        // the hover state the toolModeManager captures, so hover stays off after
        // returning to Select. Skipping no-op flips keeps that side effect from
        // running unless the measurer is genuinely being turned off.
        if (m.enabled) m.enabled = false;
      }
      mode = "none";
      if (canvas) canvas.style.cursor = "";
      onModeChanged.trigger();
    },
  };

  const active = (): Measurer | null =>
    mode === "length"
      ? length
      : mode === "area"
        ? area
        : mode === "angle"
          ? angle
          : mode === "volume"
            ? volume
            : null;

  const onDblClick = () => active()?.create();

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      // Only the Area polygon needs an explicit close; Length (2 pts) and Angle
      // (3 pts) finalize themselves.
      if (mode === "area") area.endCreation();
      return;
    }
    if (event.code === "Escape") {
      active()?.cancelCreation();
      return;
    }
    if (event.code === "Delete" || event.code === "Backspace") {
      if (event.shiftKey) {
        for (const m of all) m.list.clear();
      } else {
        void active()?.delete();
      }
    }
  };

  // Bind world + canvas + list events once the viewport exists.
  const ensure = (): boolean => {
    const world = getWorld();
    if (!world) return false;
    for (const m of all) if (m.world !== world) m.world = world;
    if (wired) return true;

    for (const m of all) m.color = new THREE.Color(COLOR);
    angle.units = "deg";
    applySnaps();

    for (const m of all) {
      m.list.onItemAdded.add(() => onChanged.trigger());
      // onItemDeleted (NOT onBeforeDelete) — the panel's re-render re-reads the
      // live list, and onBeforeDelete fires while the entry is still present, so
      // the deleted row would linger. onItemDeleted fires after removal.
      m.list.onItemDeleted.add(() => onChanged.trigger());
      m.list.onCleared.add(() => onChanged.trigger());
    }

    const renderer = world.renderer as OBF.PostproductionRenderer | undefined;
    canvas = renderer?.three.domElement;
    if (canvas) canvas.addEventListener("dblclick", onDblClick);
    window.addEventListener("keydown", onKeyDown);

    // Deferred-overlay registration. In the deferred pipeline the single-pass
    // capture HIDES every non-emitter, and the measurement line (LineBasicMaterial)
    // + area fill are non-emitters that are never redrawn — so the dimension line
    // is invisible/faint in the deferred app (it only shows in a forward/Simple-
    // Renderer example). Register the measurers' shared materials into the
    // postproduction overlay set (the same mechanism clip sections / grid / hover
    // use), depthTest/depthWrite off so they draw on top. The endpoint markers are
    // CSS2D (rendered by three2D) and don't need this.
    // Deferred-overlay registration + fat-line resolution must be ROBUST to
    // timing. ensure() can run BEFORE postproduction.basePass exists; a one-shot
    // register then silently no-ops and never retries (wired=true), leaving the
    // measurement line OUT of isolatedMaterials → the capture hides it → invisible
    // (while clip edges, registered later by ClipEdges at build time, show fine).
    // So: re-run the static material registration + resolution sync before EVERY
    // render (both idempotent/cheap) so they take effect the moment postproduction
    // is ready. Per-instance materials (area fills, volumes) register on creation.
    const fills = (
      area as unknown as {
        fills?: FRAGS.DataSet<{ material?: THREE.Material }>;
      }
    ).fills;
    fills?.onItemAdded.add((fill) => {
      registerMat(fill.material);
      getWorld()?.renderer?.update?.();
    });
    const volumes = (
      volume as unknown as {
        volumes?: FRAGS.DataSet<{ material?: THREE.Material }>;
      }
    ).volumes;
    volumes?.onItemAdded.add((v) => {
      registerMat(v.material);
      getWorld()?.renderer?.update?.();
    });

    registerStaticMats();
    syncLineResolution();
    renderer?.onBeforeUpdate?.add(() => {
      registerStaticMats();
      syncLineResolution();
    });

    wired = true;
    return true;
  };

  // Live lookup of the deferred overlay material set (postproduction may not be
  // ready at ensure() time, so never cache this).
  const isolatedMaterials = (): THREE.Material[] | undefined => {
    const r = getWorld()?.renderer as OBF.PostproductionRenderer | undefined;
    try {
      return r?.postproduction?.basePass?.isolatedMaterials;
    } catch {
      return undefined;
    }
  };

  // Register a material into the deferred overlay (idempotent). Fat lines are also
  // marked transparent so they sort with the hover/overlay group. No-op until the
  // overlay set exists.
  const registerMat = (mat?: THREE.Material) => {
    if (!mat) return;
    const isolated = isolatedMaterials();
    if (!isolated) return;
    mat.depthTest = false;
    mat.depthWrite = false;
    if ((mat as { isLineMaterial?: boolean }).isLineMaterial) {
      mat.transparent = true;
    }
    if (!isolated.includes(mat)) isolated.push(mat);
  };

  // (Re)register the shared per-measurer materials: line + fill for each, plus
  // Angle's dedicated 1px ray/arc material and Volume's shared mesh material.
  const registerStaticMats = () => {
    for (const m of all) {
      registerMat((m as { linesMaterial?: THREE.Material }).linesMaterial);
      registerMat((m as { fillsMaterial?: THREE.Material }).fillsMaterial);
    }
    registerMat(
      (volume as unknown as { volumesMaterial?: THREE.Material })
        .volumesMaterial,
    );
  };

  const _resScratch = new THREE.Vector2();
  const syncLineResolution = () => {
    const three = (getWorld()?.renderer as OBF.PostproductionRenderer | undefined)
      ?.three;
    if (!three) return;
    three.getDrawingBufferSize(_resScratch);
    // Skip until the viewport is actually sized — setting resolution to (0,0) makes
    // the fat line's screen-space quad divide by zero → NaN → invisible.
    if (_resScratch.x < 1 || _resScratch.y < 1) return;
    for (const m of all) {
      const mat = (m as { linesMaterial?: unknown }).linesMaterial as
        | { isLineMaterial?: boolean; resolution?: THREE.Vector2 }
        | undefined;
      if (mat?.isLineMaterial && mat.resolution) {
        mat.resolution.set(_resScratch.x, _resScratch.y);
      }
    }
  };

  const collect = (
    out: MeasurementRow[],
    type: string,
    measurer: Measurer,
  ) => {
    let i = 0;
    for (const entry of measurer.list) {
      const value = (entry as { value: number }).value;
      const units = measurer.units ?? "";
      out.push({
        key: `${type}-${i++}`,
        type,
        text: `${value}${units ? ` ${units}` : ""}`,
        // DataSet.delete(value) removes that single measurement.
        remove: () => {
          (measurer.list as { delete(v: unknown): boolean }).delete(entry);
        },
      });
    }
  };

  return {
    onChanged,
    onModeChanged,
    setMode(next, sub) {
      ensure();
      for (const m of all) {
        m.cancelCreation();
        // Only flip when it actually changes. Some measurers' enabled-setter has
        // side effects — VolumeMeasurement toggles the GLOBAL Hoverer on/off — and
        // firing that spuriously (disabling an already-disabled measurer) corrupts
        // the hover state the toolModeManager captures, so hover stays off after
        // returning to Select. Skipping no-op flips keeps that side effect from
        // running unless the measurer is genuinely being turned off.
        if (m.enabled) m.enabled = false;
      }
      mode = next;
      subMode = sub ?? "free";
      const a = active();
      if (a) {
        a.enabled = true;
        // Length/Area carry a creation sub-mode ("edge" / "face" / "square");
        // force it so measure-edge / measure-face reuse those measurers correctly.
        if (next === "length" || next === "area") {
          (a as unknown as { mode: string }).mode = subMode;
        }
        // Constrain the active measurer's snap set to match the sub-mode: edge mode
        // snaps to EDGES only (not vertices/faces), face mode to FACES only. Other
        // modes use the user's full snap set (applySnaps below restores it).
        if (subMode === "edge") {
          a.snappings = [FRAGS.SnappingClass.LINE];
        } else if (subMode === "face") {
          a.snappings = [FRAGS.SnappingClass.FACE];
        } else {
          applySnaps();
        }
      }
      if (canvas) canvas.style.cursor = a ? "crosshair" : "";
      // Route through the central manager: a real mode makes this the sole active
      // tool (suppressing hover/select + exiting any other tool); "none" exits.
      if (next === "none") manager.clearActive(managed);
      else manager.setActive(managed);
      // Mode may have changed while staying the active tool (length → area);
      // refresh so the HUD re-reads the dynamic label.
      manager.refresh();
      onModeChanged.trigger();
    },
    getMode: () => mode,
    getSubMode: () => subMode,
    rows() {
      const out: MeasurementRow[] = [];
      collect(out, "Length", length);
      collect(out, "Area", area);
      collect(out, "Angle", angle);
      collect(out, "Volume", volume);
      return out;
    },
    instances() {
      ensure();
      const rows: InstanceRow[] = [];
      // Per-measurement visibility lives on the visual element, mapped from the
      // list entry differently per type: Length/Angle's DimensionLine.line ===
      // entry (in `lines`); Area's fill.area === entry (in `fills`); Angle stores
      // an entry→visual map (`_visuals`) with group/label/endpoints.
      type Adapter = {
        get: (entry: unknown) => boolean;
        set: (entry: unknown, on: boolean) => void;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lineAdapter = (m: any): Adapter => ({
        get: (e) =>
          [...m.lines].find((d: any) => d.line === e)?.visible ?? true,
        set: (e, on) => {
          const d = [...m.lines].find((x: any) => x.line === e);
          if (d) d.visible = on;
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fillAdapter = (m: any): Adapter => ({
        get: (e) =>
          [...m.fills].find((f: any) => f.area === e)?.visible ?? true,
        set: (e, on) => {
          const f = [...m.fills].find((x: any) => x.area === e);
          if (f) f.visible = on;
          // Area outlines + corner endpoints are separate DimensionLines mapped
          // to the area; cascade so hiding the area hides them too (else the fill
          // disappears but the wireframe + endpoints stay on screen). DimensionLine
          // .visible also un-hides the per-segment length label — but area lines
          // are created with labels off, so force them back off after showing.
          for (const line of m.getAreaLines?.(e) ?? []) {
            line.visible = on;
            if (on) line.label.visible = false;
          }
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const angleAdapter = (m: any): Adapter => ({
        get: (e) => m._visuals?.get(e)?.group?.visible ?? true,
        set: (e, on) => {
          const v = m._visuals?.get(e);
          if (!v) return;
          v.group.visible = on;
          v.label.visible = on;
          for (const ep of v.endpoints) ep.visible = on;
        },
      });
      // Volume: MeasureVolume.volume === entry (in `volumes`).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const volumeAdapter = (m: any): Adapter => ({
        get: (e) =>
          [...m.volumes].find((v: any) => v.volume === e)?.visible ?? true,
        set: (e, on) => {
          const v = [...m.volumes].find((x: any) => x.volume === e);
          if (v) v.visible = on;
        },
      });
      const add = (m: Measurer, type: string, ad: Adapter) => {
        let i = 0;
        for (const entry of m.list) {
          const idx = ++i;
          const value = (entry as { value: number }).value;
          const units = m.units ?? "";
          rows.push({
            id: idFor(entry as object),
            kind: "measurement",
            type,
            label: `${type} ${idx} — ${value}${units ? ` ${units}` : ""}`,
            visible: ad.get(entry),
            setVisible: (on) => {
              ad.set(entry, on);
              getWorld()?.renderer?.update();
              onChanged.trigger();
            },
            remove: () => {
              (m.list as { delete(v: unknown): boolean }).delete(entry);
              onChanged.trigger();
            },
          });
        }
      };
      add(length, "Length", lineAdapter(length));
      add(area, "Area", fillAdapter(area));
      add(angle, "Angle", angleAdapter(angle));
      add(volume, "Volume", volumeAdapter(volume));
      return rows;
    },
    clearAll() {
      for (const m of all) m.list.clear();
      onChanged.trigger();
    },
    setVisible(on) {
      visible = on;
      for (const m of all) m.visible = on;
      onChanged.trigger();
    },
    isVisible: () => visible,
    getSnaps: () => ({ ...snaps }),
    setSnap(kind, on) {
      snaps[kind] = on;
      ensure();
      applySnaps();
      onChanged.trigger();
    },
    getMeasurementSettings() {
      ensure();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (m: Measurer) => (m as any).units as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts = (m: Measurer) => [...((m as any).unitsList as string[])];
      return {
        color: `#${(length.color as THREE.Color).getHexString()}`,
        units: {
          length: u(length) as LengthUnit,
          area: u(area) as AreaUnit,
          angle: u(angle) as AngleUnit,
        },
        unitOptions: {
          length: opts(length),
          area: opts(area),
          angle: opts(angle),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rounding: (length as any).rounding as number,
        snaps: { ...snaps },
        visible,
        thickness:
          (length.linesMaterial as unknown as { linewidth?: number })
            .linewidth ?? 1,
      };
    },
    setColor(hex) {
      const c = new THREE.Color(hex);
      for (const m of all) m.color = c.clone();
      getWorld()?.renderer?.update();
      onChanged.trigger();
    },
    setUnits(type, value) {
      ensure();
      const target = type === "length" ? length : type === "area" ? area : angle;
      // Per-measurer `units` is a narrow string-literal union; the panel feeds a
      // value from unitOptions for that type, so cast through unknown.
      (target as unknown as { units: string }).units = value;
      getWorld()?.renderer?.update();
      onChanged.trigger();
    },
    setRounding(decimals) {
      for (const m of all) {
        (m as unknown as { rounding: number }).rounding = decimals;
      }
      getWorld()?.renderer?.update();
      onChanged.trigger();
    },
    setThickness(px) {
      // Applies to the fat Length/Area line materials (linewidth uniform). Angle's
      // 1px material ignores it until its arc is converted to Line2.
      for (const m of all) {
        const mat = (m as { linesMaterial?: unknown }).linesMaterial as
          | { isLineMaterial?: boolean; linewidth?: number }
          | undefined;
        if (mat?.isLineMaterial) mat.linewidth = px;
      }
      getWorld()?.renderer?.update();
      onChanged.trigger();
    },
  };
};
