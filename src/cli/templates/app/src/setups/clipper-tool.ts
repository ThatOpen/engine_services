import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { toolModeManager, type ManagedTool } from "./tool-mode-manager";
import type { InstanceRow } from "./inspection";

/**
 * Clipping / section-plane TOOL (logic only; the UI lives in clipper-panel.ts).
 *
 * Two parts:
 *
 * 1. PLANES (OBC.Clipper) — placing mode (double-click a surface drops a plane on
 *    the picked face), drag the gizmo to move, Delete removes the hovered plane,
 *    per-plane + master enable, clear-all. `localClippingPlanes` is on (before any
 *    plane) so cuts sit exactly on the plane.
 *
 * 2. SECTION STYLING (OBF.ClipStyler) — one global "Section" style (a fill + an
 *    edge line) applied to the whole model ("All") at every clip plane, matching
 *    the stock ClipStyler example. The deferred-overlay treatment (depthTest/
 *    depthWrite off, line resolution, renderOrder-on-top, registration into
 *    `postproduction.basePass.isolatedMaterials`) lives centrally in ClipEdges, so
 *    here we only supply the fill/edge colours + opacity. Colour changes rebuild
 *    the section edges (cheap).
 */
type ClipEdges = ReturnType<OBF.ClipStyler["createFromClipping"]>;

export interface SectionStyle {
  fill: string; // "#rrggbb"
  line: string; // "#rrggbb"
  opacity: number; // 0..1 fill opacity
  width: number; // edge line width (px)
}

export interface ClipperTool {
  readonly clipper: OBC.Clipper;
  /** Fires when the set of planes (or their enabled state) changes. */
  readonly onChanged: OBC.Event<void>;
  /** Fires when the section style (colours/opacity/visibility) changes. */
  readonly onStyleChanged: OBC.Event<void>;

  // ── Planes ──
  setPlacing(on: boolean): void;
  isPlacing(): boolean;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** Enable/disable a single plane AND show/hide its section accordingly. */
  setPlaneEnabled(id: string, on: boolean): void;
  deletePlane(id: string): void;
  clearAll(): void;
  /** Per-plane rows for the Objects outliner (W2): hide / enable / delete. */
  instances(): InstanceRow[];

  // ── Single global section style ──
  getSectionStyle(): SectionStyle;
  setSectionFill(hex: string): void;
  setSectionLine(hex: string): void;
  setSectionOpacity(value: number): void;
  setSectionWidth(value: number): void;
  /** Master visibility of the section fills/edges. */
  setStylingVisible(on: boolean): void;
  isStylingVisible(): boolean;
}

const CLASSIFICATION = "Categories"; // OBC.Classifier.byCategory default
export const STYLE_NAME = "Section";

/**
 * Register the global "Section" ClipStyler style idempotently, so other
 * consumers (e.g. the floor-plans panel calling `createFromView`) can reference
 * it by name WITHOUT depending on `clipperTool()` having constructed first.
 * No-op if it already exists — `clipperTool` registers a live, user-editable
 * instance in its `rebuildStyles`, and this must not clobber that one.
 */
export const ensureSectionStyle = (components: OBC.Components) => {
  const styler = components.get(OBF.ClipStyler);
  if (styler.styles.get(STYLE_NAME)) return;
  styler.styles.set(STYLE_NAME, {
    // NearPlaneLineMaterial: a fat line (real px width) that ALSO discards
    // segments behind the camera plane in-shader, so it gives thick edges WITHOUT
    // the near-plane "infinity streak" the stock fat LineMaterial produced.
    linesMaterial: new OBF.NearPlaneLineMaterial({
      color: "#111111",
      linewidth: 2,
    }),
    fillsMaterial: new THREE.MeshBasicMaterial({
      color: "#a96eec",
      side: THREE.DoubleSide,
    }),
  });
};

export const clipperTool = (components: OBC.Components): ClipperTool => {
  const clipper = components.get(OBC.Clipper);
  clipper.localClippingPlanes = true; // before any plane is created
  clipper.enabled = true;
  clipper.visible = true;

  const styler = components.get(OBF.ClipStyler);
  const classifier = components.get(OBC.Classifier);
  const fragments = components.get(OBC.FragmentsManager);
  const worlds = components.get(OBC.Worlds);
  const getWorld = () => [...worlds.list.values()][0] as OBC.World | undefined;

  const onChanged = new OBC.Event<void>();
  const onStyleChanged = new OBC.Event<void>();

  const manager = toolModeManager(components);

  // ── Plane placing / canvas binding ───────────────────────────────
  let placing = false;
  let canvas: HTMLElement | undefined;

  // Registered with the ToolMode manager: when another tool takes over, exit
  // placing mode locally (the manager handles hover/select suppression).
  const managed: ManagedTool = {
    id: "clipper",
    label: "Drawing clipping plane",
    icon: "mdi:scissors-cutting",
    onDeactivate: () => {
      placing = false;
      if (canvas) canvas.style.cursor = "";
      onChanged.trigger();
    },
  };

  const onDblClick = () => {
    const world = getWorld();
    if (!placing || !world) return;
    void clipper.create(world);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "Delete" && event.code !== "Backspace") return;
    const world = getWorld();
    if (world) void clipper.delete(world);
  };
  const ensureCanvas = () => {
    if (canvas) return canvas;
    const renderer = getWorld()?.renderer as
      | OBF.PostproductionRenderer
      | undefined;
    const c = renderer?.three.domElement;
    if (c) {
      canvas = c;
      canvas.addEventListener("dblclick", onDblClick);
      window.addEventListener("keydown", onKeyDown);
    }
    return canvas;
  };
  ensureCanvas();

  // ── Section styling state ────────────────────────────────────────
  // `categories` is only kept to satisfy buildEdgesFor's classify gate (the
  // section builds once the model is classified); it no longer drives styling.
  let categories: string[] = [];
  const edgesByPlane = new Map<string, ClipEdges>();
  const planesWired = new Set<string>();
  // Planes currently being dragged. SimplePlane fires TransformControls "change"
  // every drag tick → notifyManager → clipper.list.onItemSet, which would
  // re-section the plane LIVE on every frame. That spams overlapping async
  // rebuilds (which race and drop edges — the "missing edges while dragging") and
  // costs a full re-section per frame. We instead BLINK: hide on drag-start, skip
  // the per-frame rebuild while dragging, and rebuild once on release.
  const draggingPlanes = new Set<string>();
  // Gizmo (TransformControls) + section-plane-mesh materials we registered into
  // the postproduction overlay set per plane, so we can unregister on delete.
  const gizmoMatsByPlane = new Map<string, THREE.Material[]>();

  const sectionStyle: SectionStyle = {
    // Pre-compensated purple: the deferred postproduction linearizes scene
    // colors (sRGB→linear ≈ c^2.4), so #6528d7 would render as #2105ad. Feeding
    // the linear→sRGB inverse (#a96eec) makes the fill GRADE to the app purple
    // #6528d7 on screen, while still shaded naturally by the PEN scene.
    fill: "#a96eec",
    line: "#111111",
    opacity: 1,
    width: 2,
  };

  // One global "Section" style (fill + edge line) applied to the whole model
  // ("All"), matching the stock ClipStyler example. The deferred-overlay
  // treatment (depthTest/depthWrite off, line resolution, renderOrder-on-top,
  // overlay registration) lives centrally in ClipEdges.
  const rebuildStyles = () => {
    styler.styles.set(STYLE_NAME, {
      // NearPlaneLineMaterial: fat line (real px width via `linewidth`) whose
      // shader discards segments behind the camera plane, so we get thick section
      // edges with NO near-plane "infinity streak". Re-enables the Edge-width
      // control (the setter drives `linewidth`). ClipEdges' fat-line path
      // (isLineMaterial) builds a LineSegments2 and keeps `resolution` in sync.
      linesMaterial: new OBF.NearPlaneLineMaterial({
        color: sectionStyle.line,
        linewidth: sectionStyle.width,
      }),
      fillsMaterial: new THREE.MeshBasicMaterial({
        color: sectionStyle.fill,
        side: THREE.DoubleSide,
        transparent: sectionStyle.opacity < 1,
        opacity: sectionStyle.opacity,
      }),
    });
  };
  rebuildStyles();

  const buildItems = () => {
    return { All: { style: STYLE_NAME } } as Record<
      string,
      { style: string; data?: Record<string, string[]> }
    >;
  };

  const buildEdgesFor = (planeId: string) => {
    const plane = clipper.list.get(planeId);
    if (!getWorld() || categories.length === 0 || !plane) return;
    // A DISABLED plane applies no cut, so it must show no section — hide its
    // existing fill/edges and don't compute a new one. Re-enabling fires
    // onItemSet again (via SimplePlane.notifyManager), which rebuilds + shows it.
    if (!plane.enabled) {
      const existing = edgesByPlane.get(planeId);
      if (existing) existing.visible = false;
      // Request a frame so the now-hidden section disappears immediately rather
      // than lingering until the next camera move (the deferred overlay only
      // re-composites on demand).
      getWorld()?.renderer?.update();
      return;
    }
    styler.world = getWorld() ?? null;
    // Drop any previous edges for this plane (DataMap delete disposes them).
    if (styler.list.has(planeId)) styler.list.delete(planeId);
    edgesByPlane.delete(planeId);

    const items = buildItems();
    if (Object.keys(items).length === 0) return;
    // link:false → no auto onDraggingEnded/onDisposed listeners (we manage those
    // once per plane below, so rebuilds don't accumulate handlers).
    const edges = styler.createFromClipping(planeId, {
      id: planeId,
      items,
      link: false,
      world: getWorld() ?? undefined,
    });
    edgesByPlane.set(planeId, edges);
    // edges.update() is async (awaits getSection); the new overlay materials
    // only exist once it resolves. Kick a render THEN so the recoloured/rebuilt
    // section appears immediately instead of staying blank until a camera move
    // invalidates the deferred frame.
    void Promise.resolve(edges.update())
      .then(() => getWorld()?.renderer?.update())
      .catch((error) =>
        console.warn("[clipper] section build skipped:", error),
      );
  };

  const rebuildAllEdges = () => {
    for (const [id] of clipper.list) buildEdgesFor(id);
  };

  // One drag listener per plane; it updates whatever edges currently belong to
  // the plane (survives rebuilds since it reads edgesByPlane live).
  const wirePlane = (planeId: string) => {
    if (planesWired.has(planeId)) return;
    const plane = clipper.list.get(planeId);
    if (!plane) return;
    planesWired.add(planeId);
    // Suppress the dynamic-anchor pivot dot while the plane gizmo is being
    // dragged (it would otherwise pop up on the press). The dot renders off
    // world.onDynamicAnchorSet, so turning dynamicAnchor off for the drag stops
    // it cleanly with no change to viewports-manager.
    plane.onDraggingStarted.add(() => {
      draggingPlanes.add(planeId); // suppress the per-frame live re-section (blink)
      const world = getWorld() as unknown as { dynamicAnchor?: boolean } | undefined;
      if (world) world.dynamicAnchor = false;
      // Re-prune the TransformControls guide lines (the ±1e6 AXIS/X/Y/Z helper
      // lines that read as thin "infinity" lines): three creates/shows them
      // lazily, so the one-shot prune at registerGizmo time can run before they
      // exist. By drag time they're present — prune + hide again (idempotent).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const helper = (plane as any).controls?.getHelper?.();
      pruneInfiniteGuides(helper);
      hideGizmoHelpers(helper);
      tintGizmo(planeId); // keep the handle purple through the drag highlight
      // Hide this plane's section fill + edges while dragging — they'd be stale
      // mid-move anyway, and hiding dodges the per-frame re-section cost. Re-shown
      // + recomputed on release below.
      const edges = edgesByPlane.get(planeId);
      if (edges) edges.visible = false;
    });
    plane.onDraggingEnded.add(() => {
      draggingPlanes.delete(planeId); // re-enable rebuilds; do the one rebuild below
      const world = getWorld() as unknown as { dynamicAnchor?: boolean } | undefined;
      if (world) world.dynamicAnchor = true;
      const edges = edgesByPlane.get(planeId);
      if (edges) {
        // Rebuild the section at the NEW plane position FIRST; only reveal it once
        // the rebuild resolves. Showing before the update lets the stale geometry
        // (still at the pre-drag position) render for a frame → a flash of the old
        // section snapping to the new one. update() is async (awaits getSection),
        // so flip visible + kick a render in its completion, never before it.
        void Promise.resolve(edges.update())
          .then(() => {
            edges.visible = true;
            getWorld()?.renderer?.update();
          })
          .catch((error) =>
            console.warn("[clipper] section update skipped:", error),
          );
      }
    });
  };

  // Classify loaded models by IFC category, refresh the category list + styles,
  // and (re)build all section edges. Resilient: models can be mid-load or
  // disposed when fragments.list fires (the project has multiple frags), so the
  // worker may not yet/no longer have a model id — byCategory then throws
  // "Model not found". We debounce (coalesce the multi-frag load), wrap in
  // try/catch, and retry once the list settles, so a transient miss never
  // surfaces as an uncaught runtime error.
  let classifyTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleClassify = () => {
    if (classifyTimer) clearTimeout(classifyTimer);
    classifyTimer = setTimeout(() => void classify(), 250);
  };
  const classify = async () => {
    if (fragments.list.size === 0) {
      categories = [];
      rebuildAllEdges();
      onStyleChanged.trigger();
      return;
    }
    try {
      await classifier.byCategory();
    } catch (error) {
      // A model wasn't queryable yet (mid-load) — retry after it settles.
      console.warn("[clipper] classification deferred:", error);
      scheduleClassify();
      return;
    }
    const groups = classifier.list.get(CLASSIFICATION);
    categories = groups ? [...groups.keys()].sort() : [];
    rebuildAllEdges();
    onStyleChanged.trigger();
  };

  fragments.list.onItemSet.add(scheduleClassify);
  fragments.list.onItemDeleted.add(scheduleClassify);
  if (fragments.list.size > 0) scheduleClassify();

  // The postproduction overlay material set, or undefined on a non-postproduction
  // renderer / before it's initialised (the basePass getter throws if early).
  const isolatedMaterials = (): THREE.Material[] | undefined => {
    const renderer = getWorld()?.renderer as
      | { postproduction?: { basePass?: { isolatedMaterials?: THREE.Material[] } } }
      | undefined;
    try {
      return renderer?.postproduction?.basePass?.isolatedMaterials;
    } catch {
      return undefined;
    }
  };

  // The clipper's gizmo (TransformControls helper) + section-plane mesh are basic
  // single-output materials. classify() hides them by OBJECT visibility, but
  // TransformControls re-asserts handle visibility in updateMatrixWorld, so they
  // leak into the deferred MRT capture and spam "missing fragment shader
  // outputs". Register their materials into the overlay set so the deferred path
  // hides them at MATERIAL level during capture and redraws them on top; mark
  // preserveBlending so the overlay redraw keeps the gizmo's normal look.
  // three.js TransformControls draws infinite axis/delta GUIDE lines (named
  // X/Y/Z/AXIS/DELTA, extending ±1e6) to show the active drag axis. In the
  // deferred overlay those render as black streaks running to the horizon. Remove
  // them — detected by a huge geometry extent so we drop only the guides, never
  // the small draggable handles.
  const pruneInfiniteGuides = (root: THREE.Object3D | undefined) => {
    if (!root) return;
    const doomed: THREE.Object3D[] = [];
    root.traverse((o) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyO = o as any;
      if (
        !(anyO.isLine || anyO.isLineSegments || anyO.isLine2 || anyO.isLineSegments2)
      ) {
        return;
      }
      const geo = (o as THREE.Line).geometry as THREE.BufferGeometry | undefined;
      if (!geo) return;
      geo.computeBoundingBox?.();
      const bb = geo.boundingBox;
      if (bb && bb.min.distanceTo(bb.max) > 1e4) doomed.push(o);
    });
    for (const o of doomed) o.removeFromParent();
  };

  // The clip plane's TransformControls draws helper clutter that has nothing to do
  // with the draggable handle: an opaque WHITE bounds cylinder (renders as a solid
  // white volume) plus translucent plane/scale/rotate guide quads, pickers and
  // helper octahedrons. With postproduction ON the deferred capture hides them, but
  // the forward path (the cheap resize path turns postpro off) draws them — that's
  // the "white volume" + "guide quads on resize". Hide every NON-handle helper at
  // MATERIAL level and flag it `keepHidden` so the PostproductionRenderer.enabled
  // setter no longer force-reveals it. We keep only the actual translate arrows:
  // in three's TransformControls the arrow/shaft materials are fully opaque
  // (opacity 1), while every guide/picker/helper material is translucent
  // (opacity < 1) — a stable signal set once at material creation. The opaque
  // white bounds cylinder is the lone opaque exception, caught explicitly.
  // material.visible is never touched by TransformControls (it only re-asserts
  // object.visible per frame), so this sticks; raycast picking ignores it so
  // dragging still works.
  const hideGizmoHelpers = (root: THREE.Object3D | undefined) => {
    if (!root) return;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        if (!m) continue;
        const basic = m as THREE.MeshBasicMaterial;
        const translucent = basic.transparent && (basic.opacity ?? 1) < 1;
        const opaqueWhite =
          !basic.transparent &&
          (basic.opacity ?? 1) >= 1 &&
          basic.color?.getHex?.() === 0xffffff &&
          mesh.geometry?.type === "CylinderGeometry";
        if (translucent || opaqueWhite) {
          m.visible = false;
          m.userData.keepHidden = true;
        }
      }
    });
  };

  const registerGizmo = (planeId: string) => {
    const isolated = isolatedMaterials();
    if (!isolated) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plane = clipper.list.get(planeId) as any;
    if (!plane) return;
    // Strip the infinite axis/delta guide lines first so we neither register nor
    // draw them, and hide the opaque white bounds cylinder (the white volume).
    pruneInfiniteGuides(plane.controls?.getHelper?.());
    hideGizmoHelpers(plane.controls?.getHelper?.());
    const mats: THREE.Material[] = [];
    const collect = (root: THREE.Object3D | undefined) =>
      root?.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) if (mat) mats.push(mat);
      });
    collect(plane.helper);
    collect(plane.controls?.getHelper?.());
    for (const m of mats) {
      m.userData.preserveBlending = true;
      if (!isolated.includes(m)) isolated.push(m);
    }
    gizmoMatsByPlane.set(planeId, mats);

    // three creates/shows the ±1e6 AXIS/X/Y/Z guide lines lazily, so they may not
    // exist yet at this synchronous pass. Re-prune next frame to catch them even
    // before the first drag (they can render visible pre-interaction).
    requestAnimationFrame(() => {
      const helper = plane.controls?.getHelper?.();
      pruneInfiniteGuides(helper);
      hideGizmoHelpers(helper);
      getWorld()?.renderer?.update();
    });
  };

  const unregisterGizmo = (planeId: string) => {
    const mats = gizmoMatsByPlane.get(planeId);
    if (!mats) return;
    const isolated = isolatedMaterials();
    if (isolated) {
      for (const m of mats) {
        const i = isolated.indexOf(m);
        if (i >= 0) isolated.splice(i, 1);
      }
    }
    gizmoMatsByPlane.delete(planeId);
  };

  // ── Gizmo POLISH: recolor the draggable handle to the app purple ──────────
  // The clip-plane handle (three TransformControls arrows) ships in stock axis
  // colours, which read as "raw". The gizmo is overlay-composited (ungraded), so
  // a literal #6528d7 renders as the true app purple. The only catch: three
  // re-applies a cached original colour (`material._color`) every
  // updateMatrixWorld before layering the hover/active highlight — so we recolour
  // BOTH the live colour AND that cache, or our purple snaps back on hover/drag.
  // Targets only the opaque, visible arrow handles (the translucent guides + the
  // white bounds cylinder are skipped, same signal hideGizmoHelpers uses).
  const HANDLE_PURPLE = 0x6528d7;
  const tintGizmo = (planeId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plane = clipper.list.get(planeId) as any;
    const helper = plane?.controls?.getHelper?.();
    if (!helper) return;
    // SimplePlane sets showX/showY false → only the Z (normal) translate gizmo
    // shows. three's TC translate gizmo puts an arrowhead at BOTH +z and −z (plus
    // a thin line); the −z one is the "bodyless" arrow pointing away from the
    // plane. Drop it. (object.visible would be re-asserted each frame, so
    // removeFromParent like the guide-line prune.) The drag hit-area is the
    // separate centered _arrowBoundBox picker, so removing the visible back
    // arrowhead doesn't affect dragging.
    const doomed: THREE.Object3D[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    helper.traverse((o: any) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const opaqueVisible = list.some(
        (m: any) => m && m.visible !== false && (m.opacity ?? 1) >= 1,
      );
      // Back arrowhead: three's setupGizmo BAKES the layout offset into the
      // GEOMETRY and resets mesh.position to (0,0,0) — so detect by the geometry's
      // bbox center, not mesh.position. The translate cones are CylinderGeometry;
      // the one baked at z≈-0.5 is the bodyless back arrow (the +0.5 front arrow
      // and the z≈0 line/shaft stay; invisible pickers excluded by opaqueVisible).
      const geo = o.geometry as THREE.BufferGeometry | undefined;
      if (geo && !geo.boundingBox) geo.computeBoundingBox?.();
      const bb = geo?.boundingBox;
      const centerZ = bb ? (bb.min.z + bb.max.z) / 2 : 0;
      if (opaqueVisible && geo?.type === "CylinderGeometry" && centerZ < -0.2) {
        doomed.push(o);
        return;
      }
      for (const m of list) {
        if (!m?.color?.setHex) continue;
        const opacity = m.opacity ?? 1;
        // three's TC arrow materials are transparent:true WITH opacity 1, so we
        // must NOT require !transparent (that skipped the handles entirely — why
        // the recolor looked like nothing changed). Recolor every VISIBLE handle
        // (opacity >= 1), matching hideGizmoHelpers' kept set; skip only the faded
        // guides/pickers (opacity < 1) and the opaque white bounds cylinder.
        const translucent = m.transparent && opacity < 1;
        const whiteCylinder =
          opacity >= 1 &&
          m.color.getHex?.() === 0xffffff &&
          o.geometry?.type === "CylinderGeometry";
        if (translucent || whiteCylinder) continue;
        m.color.setHex(HANDLE_PURPLE);
        if (m._color?.setHex) m._color.setHex(HANDLE_PURPLE); // patch TC's cache
      }
    });
    for (const o of doomed) o.removeFromParent();
  };

  // Plane lifecycle → edges + panel refresh.
  clipper.list.onItemSet.add(({ key }) => {
    wirePlane(key);
    registerGizmo(key);
    tintGizmo(key);
    // three creates/colours the handle materials lazily, so re-tint next frame to
    // catch anything not present in this synchronous pass.
    requestAnimationFrame(() => {
      tintGizmo(key);
      getWorld()?.renderer?.update();
    });
    // While the plane is being dragged, skip the live re-section (blink): the
    // section stays hidden until release, where onDraggingEnded rebuilds it once.
    if (!draggingPlanes.has(key)) buildEdgesFor(key);
    onChanged.trigger();
  });
  clipper.list.onItemDeleted.add((key) => {
    if (styler.list.has(key)) styler.list.delete(key);
    edgesByPlane.delete(key);
    planesWired.delete(key);
    unregisterGizmo(key);
    onChanged.trigger();
  });

  // ── In-place section style mutation ──────────────────────────────
  // Mutate the LIVE drawn materials rather than rebuilding the ClipEdges: a
  // rebuild tears down + recreates the overlay meshes, which vanish until a
  // camera move re-composites. Local-clipping mode CLONES the style materials per
  // ClipEdges, so we must touch the actual rendered clones (inside each
  // ClipEdges.three), not the style template — and also the template so newly
  // built sections (and W2's plan views) match. Colour/width are pure uniforms
  // (no recompile); only a transparent-flag flip needs needsUpdate.
  // rAF-coalesced render kick: dragging a colour/opacity/width control fires many
  // input events per frame, each of which would otherwise force a full deferred
  // re-composite. Collapse them to at most one recomposite per frame.
  let _renderScheduled = false;
  const requestRender = () => {
    if (_renderScheduled) return;
    _renderScheduled = true;
    requestAnimationFrame(() => {
      _renderScheduled = false;
      getWorld()?.renderer?.update();
    });
  };

  const templateMaterials = () =>
    styler.styles.get(STYLE_NAME) as
      | { linesMaterial?: THREE.Material; fillsMaterial?: THREE.Material }
      | undefined;

  const eachSectionMaterial = (
    which: "line" | "fill",
    fn: (m: THREE.Material) => void,
  ) => {
    // Detect line vs fill by OBJECT type (covers both the fat LineSegments2 and a
    // plain THREE.LineSegments) rather than a material flag, so it's robust to
    // whichever line material the style uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isLineObj = (o: any) =>
      !!(o.isLine || o.isLineSegments || o.isLine2 || o.isLineSegments2);
    const tpl = templateMaterials();
    const tplMat = which === "line" ? tpl?.linesMaterial : tpl?.fillsMaterial;
    if (tplMat) fn(tplMat);
    for (const [, edges] of edgesByPlane) {
      edges.three.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        if ((which === "line") === isLineObj(o)) fn(m);
      });
    }
  };

  return {
    clipper,
    onChanged,
    onStyleChanged,

    setPlacing(on) {
      placing = on;
      const c = ensureCanvas();
      if (c) c.style.cursor = on ? "crosshair" : "";
      // Route through the central manager: entering placing makes this the sole
      // active tool (suppressing hover/select + exiting any other tool); exiting
      // restores them.
      if (on) manager.setActive(managed);
      else manager.clearActive(managed);
    },
    isPlacing: () => placing,
    setEnabled(on) {
      clipper.enabled = on;
      for (const [, plane] of clipper.list) plane.enabled = on;
      // Explicitly resync every section to its plane's enabled state (don't rely
      // on SimplePlane.notifyManager → onItemSet, which the DataMap can dedup).
      rebuildAllEdges();
      onChanged.trigger();
    },
    isEnabled: () => clipper.enabled,
    setPlaneEnabled(id, on) {
      const plane = clipper.list.get(id);
      if (!plane) return;
      plane.enabled = on;
      // buildEdgesFor hides the section when disabled, rebuilds + shows it when
      // enabled — called directly so it never depends on onItemSet firing.
      buildEdgesFor(id);
      onChanged.trigger();
    },
    deletePlane(id) {
      const world = getWorld();
      if (world) void clipper.delete(world, id);
    },
    clearAll() {
      clipper.deleteAll();
      onChanged.trigger();
    },
    instances() {
      const rows: InstanceRow[] = [];
      let i = 0;
      for (const [id, plane] of clipper.list) {
        const idx = ++i;
        const p = plane as unknown as { visible: boolean; enabled: boolean };
        rows.push({
          id,
          kind: "clip",
          type: "Clip plane",
          label: `Clip plane ${idx}`,
          visible: p.visible,
          enabled: p.enabled,
          setVisible: (on) => {
            // Hide the gizmo + plane mesh AND the section fill/edges together.
            p.visible = on;
            const edges = edgesByPlane.get(id);
            if (edges) edges.visible = on;
            requestRender();
            onChanged.trigger();
          },
          setEnabled: (on) => {
            plane.enabled = on;
            buildEdgesFor(id); // hides section when off, rebuilds + shows when on
            onChanged.trigger();
          },
          remove: () => {
            const world = getWorld();
            if (world) void clipper.delete(world, id);
          },
        });
      }
      return rows;
    },

    getSectionStyle: () => ({ ...sectionStyle }),
    setSectionFill(hex) {
      sectionStyle.fill = hex;
      // MeshBasicMaterial.color is a Color — mutate in place (uniform, no recompile).
      eachSectionMaterial("fill", (m) =>
        (m as THREE.MeshBasicMaterial).color.set(hex),
      );
      requestRender();
      onStyleChanged.trigger();
    },
    setSectionLine(hex) {
      sectionStyle.line = hex;
      // LineMaterial.color assigns straight to the diffuse uniform — give it a
      // THREE.Color (a string uploads as black); uniform-only, no recompile.
      eachSectionMaterial("line", (m) => {
        (m as unknown as { color: THREE.Color }).color = new THREE.Color(hex);
      });
      requestRender();
      onStyleChanged.trigger();
    },
    setSectionOpacity(value) {
      sectionStyle.opacity = value;
      // Only the opacity uniform — keep `transparent` TRUE (set in the lib so the
      // section sorts in front of the translucent hover). Opacity still applies:
      // the overlay pass writes (colour, alpha) and straight-alpha composites it,
      // so the fill stays translucent without toggling the transparent flag (which
      // would drop the section back into the opaque group, behind the hover).
      eachSectionMaterial("fill", (m) => {
        m.opacity = value;
      });
      requestRender();
      onStyleChanged.trigger();
    },
    setSectionWidth(value) {
      sectionStyle.width = value;
      // LineMaterial.linewidth is a uniform — no recompile.
      eachSectionMaterial("line", (m) => {
        (m as unknown as { linewidth: number }).linewidth = value;
      });
      requestRender();
      onStyleChanged.trigger();
    },
    setStylingVisible(on) {
      styler.visible = on;
      onStyleChanged.trigger();
    },
    isStylingVisible: () => styler.visible,
  };
};
