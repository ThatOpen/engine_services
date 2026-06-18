import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import { ensureSectionStyle, STYLE_NAME } from "./clipper-tool";

/**
 * FLOOR PLANS panel — 2D plan navigation per IFCBUILDINGSTOREY.
 *
 * Built on `OBC.Views`: `createFromIfcStoreys()` generates one View per storey
 * (an orthographic, top-down "Plan"-mode camera + a section clip plane at the
 * storey's elevation). Clicking a level `open()`s its view (Views snapshots the
 * current camera pose); "Exit to 3D" `close()`s it (Views restores the prior
 * orbit camera + pose). The panel just lists the levels (name + elevation) and
 * drives open/close. The active plan's cut is drawn FILLED + OUTLINED via
 * `OBF.ClipStyler.createFromView` reusing the global "Section" style (registered
 * idempotently by `ensureSectionStyle`), so the section reads like the 3D clipper.
 *
 * UI: vanilla BUI, native panel header (label+icon), muted section band, 1px
 * contrast-20 hairlines, #3C3C41 scrollbar — matching the docked-panel refactor.
 * Factory returns the element WITHOUT self-mounting (like graphics/files panels).
 *
 * @param components engine components
 */

interface Level {
  name: string; // = the View id (Views keys storey views by Name)
  elevation: number; // raw IFC Elevation value (model length unit)
}

interface PanelState {
  status: "loading" | "empty" | "ready";
  levels: Level[];
  active: string | null; // name of the open plan, or null (3D)
  filter: string; // level-list search query (by name + elevation)
  viewDepth: number; // extra depth (model units) revealed BELOW the storey cut
  cutOffset: number; // top-cut height (model units) ABOVE the active storey floor
}

// View-depth slider bounds (model units). 0 = the storey's default range (only
// that storey); higher reveals floors below down to the chosen depth. Defaults
// to 30 below the cut on open.
const VIEW_DEPTH_MAX = 100;
const VIEW_DEPTH_STEP = 0.5;
const VIEW_DEPTH_DEFAULT = 30;

// Cut-plane offset (top cut, model units above the storey floor). The slider
// DEFAULTS to 1.5m above each floor; CREATION_OFFSET is the createFromIfcStoreys
// offset the captured base plane reflects (the formula raises the cut from there).
const CUT_OFFSET_DEFAULT = 1.5;
const CREATION_OFFSET = 0.25;
const CUT_OFFSET_MAX = 3;
const CUT_OFFSET_STEP = 0.05;

// Margin fraction added around the model AABB when framing a plan (breathing room).
const PLAN_FIT_MARGIN = 0.06;

const elevText = (e: number) => {
  if (!Number.isFinite(e)) return "";
  return `${e >= 0 ? "+" : ""}${e.toFixed(2)}`;
};

export const plansPanel = (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager);
  const views = components.get(OBC.Views);
  const styler = components.get(OBF.ClipStyler);
  // No camera animations in the plans path: Views' close-restore otherwise
  // tweens the 3D camera back via fromJSON(json, true). The default 3D camera is
  // untouched during a plan (we drive the plan camera), so disabling the restore
  // means close() just snaps back to the default camera's existing pose — instant.
  views.restoreCameraOnClose = false;

  let rebuildToken = 0;
  let searchTimer: number | undefined;

  const getWorld = () =>
    ([...components.get(OBC.Worlds).list.values()][0] as OBC.World) ?? null;

  // ── Shared 2D camera memory (session, in-memory) ───────────────
  // ONE shared plan-view camera state (toJSON: position + target + ortho zoom)
  // across ALL floor plans. The FIRST time the user enters plan mode there's no
  // snapshot → fit-to-plan. After that, switching between levels KEEPS the same
  // XY pan + zoom (only each level's own section-clip height changes); restoring
  // the shared pose re-applies pan/zoom while Views' per-level clip drives the cut.
  let sharedPlanCam: string | null = null;
  let currentLevel: string | null = null;
  let restAttached = false;

  const capturePlanCam = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = getWorld()?.camera?.controls as any;
    if (c && typeof c.toJSON === "function") {
      try {
        sharedPlanCam = c.toJSON();
      } catch {
        /* controls without (de)serialization — memory just no-ops */
      }
    }
  };
  const restorePlanCam = (): boolean => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = getWorld()?.camera?.controls as any;
    if (c && sharedPlanCam && typeof c.fromJSON === "function") {
      try {
        c.fromJSON(sharedPlanCam, false); // INSTANT restore of XY + zoom (no tween)
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };
  // Keep the shared 2D pose current as the user pans/zooms within ANY plan —
  // camera-controls 'rest' fires once motion settles. Attached lazily, once.
  const ensureRestListener = () => {
    if (restAttached) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = getWorld()?.camera?.controls as any;
    if (!c?.addEventListener) return;
    c.addEventListener("rest", () => {
      if (currentLevel) capturePlanCam();
    });
    restAttached = true;
  };

  // Fit the (now active) plan camera to the model AABB — fitToBox frames the
  // box's footprint TIGHTLY in the ortho top-down view (the bounding SPHERE used
  // before over-encloses ~1.7× and lands too far). Instant (no fly-in).
  const fitActive = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controls = getWorld()?.camera?.controls as any;
    if (!controls?.fitToBox) return;
    const box = new THREE.Box3();
    for (const [, model] of fragments.list) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (model as any).box as THREE.Box3 | undefined;
      if (b && !b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    box.expandByScalar(Math.max(size.x, size.y, size.z) * PLAN_FIT_MARGIN); // margin
    await controls.fitToBox(box, false); // INSTANT, AABB-tight
  };

  // The postproduction renderer (lazy — the pipeline allocates once it's up).
  const getPostproduction = () => {
    const r = getWorld()?.renderer as OBF.PostproductionRenderer | undefined;
    return r?.postproduction ?? null;
  };

  // Plan-mode view tweaks, snapshotted on the FIRST entry (3D → plan) and
  // restored on exit (plan → 3D), so 3D mode is left exactly as it was. Direct
  // plan→plan switches keep the snapshot.
  let inPlan = false;
  let savedAnchor: boolean | null = null;
  let savedStyle: OBF.PostproductionAspect | null = null;

  // Tame the plan-mode wheel zoom. The PLAN camera is ORTHOGRAPHIC, so the wheel
  // maps to the ZOOM action — governed by camera-controls' `zoomSpeed` (scales
  // camera.zoom), NOT `dollySpeed` (that's perspective dolly only). Views may use
  // a SEPARATE camera-controls instance per plan, so we tame whatever controls is
  // ACTIVE after views.open() (tameZoom is called there), tracking each instance
  // we touch so every one is restored on exit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tamedControls = new Map<any, { zoom: number; dolly: number }>();
  const PLAN_ZOOM_SPEED = 1.0; // snappy wheel zoom (the View defaults dollySpeed=6)
  const tameZoom = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = getWorld()?.camera?.controls as any;
    if (!c || tamedControls.has(c)) return;
    tamedControls.set(c, {
      zoom: typeof c.zoomSpeed === "number" ? c.zoomSpeed : NaN,
      dolly: typeof c.dollySpeed === "number" ? c.dollySpeed : NaN,
    });
    if (typeof c.zoomSpeed === "number") c.zoomSpeed = PLAN_ZOOM_SPEED;
    if (typeof c.dollySpeed === "number") c.dollySpeed = PLAN_ZOOM_SPEED; // belt + braces
  };
  const untameZoom = () => {
    for (const [c, orig] of tamedControls) {
      if (!Number.isNaN(orig.zoom)) c.zoomSpeed = orig.zoom;
      if (!Number.isNaN(orig.dolly)) c.dollySpeed = orig.dolly;
    }
    tamedControls.clear();
  };

  const applyPlanLook = () => {
    if (inPlan) return;
    inPlan = true;
    // Hide the dynamic-anchor pivot dot in 2D (the anchor dot only renders off
    // world.onDynamicAnchorSet, so disabling dynamicAnchor suppresses it).
    const world = getWorld();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = world as any;
    if (w && typeof w.dynamicAnchor === "boolean") {
      savedAnchor = w.dynamicAnchor;
      w.dynamicAnchor = false;
    }
    // True PEN style for plans — line drawing, no surface colour (snapshot the
    // live style to restore on exit).
    const pp = getPostproduction();
    if (pp) {
      savedStyle = pp.style;
      pp.style = OBF.PostproductionAspect.PEN;
    }
  };

  const restorePlanLook = () => {
    if (!inPlan) return;
    inPlan = false;
    untameZoom(); // restore every plan-controls instance's zoom/dolly speed
    const world = getWorld();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = world as any;
    if (w && savedAnchor !== null) w.dynamicAnchor = savedAnchor;
    const pp = getPostproduction();
    if (pp && savedStyle !== null) pp.style = savedStyle;
    savedAnchor = null;
    savedStyle = null;
  };

  // ── View depth (Revit "view depth"): extend the lower clip below the storey ──
  // Each storey View has a top cut `plane` (the section height) and a `range` =
  // how far BELOW the cut is shown (its `farPlane`). depth 0 keeps the storey's
  // default range; raising it pushes the far plane down to reveal lower floors.
  let viewDepth = VIEW_DEPTH_DEFAULT; // model units below the cut (mirrors state.viewDepth)
  // PER-LEVEL pristine default range. Was a single shared value captured from the
  // first level visited and then applied to ALL levels — wrong, since each storey
  // view has its own natural range (distance below its cut), so upper storeys got
  // a bad slab and showed nothing. Capture+restore per level.
  const baseRange = new Map<string, number>();
  const applyViewDepth = () => {
    if (!currentLevel) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = views.list.get(currentLevel) as any;
    if (!view || typeof view.range !== "number") return;
    if (!baseRange.has(currentLevel)) baseRange.set(currentLevel, view.range as number);
    view.range = baseRange.get(currentLevel)! + viewDepth;
    if (typeof view.update === "function") view.update();
  };
  // The view-depth slider works where the open path didn't, even though both set
  // the SAME range — the difference was the slider ALSO re-rendered the panel
  // (update), which is what actually commits the new slab visually. Factor that
  // whole body into one function so OPEN and the SLIDER fire the identical commit.
  const applyDepthAndCommit = () => {
    applyViewDepth();
    refreshPlanSection();
    update({ viewDepth });
  };

  // ── Cut-plane offset (top cut, model units above the floor) — PER PLAN ──────
  // The View's `distance` = its cut plane's `constant`. Raising the cut by Δ above
  // the floor changes the constant by −normal.y·Δ, measured from CREATION_OFFSET
  // (the offset the captured base plane reflects). Default cut height is 1.5m.
  const cutOffsets = new Map<string, number>(); // level → offset above floor
  const baseCut = new Map<string, number>(); // level → pristine plane.constant
  const applyCutOffset = (level: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = views.list.get(level) as any;
    if (!view || typeof view.distance !== "number") return;
    if (!baseCut.has(level)) baseCut.set(level, view.distance as number);
    const off = cutOffsets.get(level) ?? CUT_OFFSET_DEFAULT;
    const ny = view.plane?.normal?.y ?? 1;
    view.distance = baseCut.get(level)! - ny * (off - CREATION_OFFSET);
    // (the distance setter calls view.update internally)
  };

  // ── Plan section fill + edges (OBF.ClipStyler) ─────────────────
  // Draw the global "Section" style (fill + outline) at the active plan's cut
  // plane via createFromView, so the cut reads filled + outlined like the 3D
  // clipper. One ClipEdges at a time (only one plan open); rebuilt on switch and
  // disposed on exit. ensureSectionStyle registers "Section" idempotently so we
  // don't depend on the clipper tool having been constructed.
  let planEdges: OBF.ClipEdges | null = null;
  let planEdgesId: string | null = null;
  const disposePlanSection = () => {
    if (planEdgesId && styler.list.has(planEdgesId)) styler.list.delete(planEdgesId); // DataMap delete disposes
    planEdges = null;
    planEdgesId = null;
  };
  const buildPlanSection = (name: string) => {
    disposePlanSection();
    try {
      ensureSectionStyle(components);
      const world = getWorld();
      styler.world = world;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const view = views.list.get(name) as any;
      if (!view) return;
      const id = `plan-section:${name}`;
      planEdges = styler.createFromView(view, {
        id,
        items: { All: { style: STYLE_NAME } }, // no `data` → style ALL cut geometry
        link: true, // auto-update/visibility-sync with the view
        world: world ?? undefined,
      });
      planEdgesId = id;
      // createFromView (unlike createFromClipping) does NOT set edges.visible —
      // and the `visible` setter is what ADDS the group to the scene. The view is
      // already open here, so the view.onStateChanged→visible link already fired
      // before our ClipEdges existed; set it explicitly so renderOverlay can find
      // the section group. Then force a rebuild at the current plane.
      planEdges.visible = true;
      void Promise.resolve(planEdges.update()).catch((error) =>
        console.warn("[plans-panel] section build skipped:", error),
      );
    } catch (error) {
      console.warn("[plans-panel] failed to build plan section", name, error);
    }
  };
  // Redraw the section after the cut plane moves (cut-height / view-depth change).
  const refreshPlanSection = () => {
    if (!planEdges) return;
    void Promise.resolve(planEdges.update()).catch(() => {});
  };

  const enterPlan = async (name: string) => {
    // Guard: never silently no-op on a level whose view is missing — that's the
    // "can't navigate to some levels" symptom. The rebuild reconcile should have
    // created it; if not, surface it instead of failing quietly.
    if (!views.list.has(name)) {
      console.warn("[plans-panel] no plan view for level:", name, "— cannot open");
      return;
    }
    try {
      // Capture the current 2D pan/zoom before switching, so it carries over.
      if (currentLevel && currentLevel !== name) capturePlanCam();
      applyPlanLook(); // anchor off + pen style (snapshot on first entry)
      ensureRestListener();
      views.open(name); // sets this level's section-clip height
      tameZoom(); // NOW the plan camera's controls is active → tame its wheel zoom
      currentLevel = name;
      buildPlanSection(name); // create the Section edges (positioned in the settle below)
      update({ active: name, cutOffset: cutOffsets.get(name) ?? CUT_OFFSET_DEFAULT });
      // Apply the per-level SLAB (range + cut), CAMERA framing, and SECTION refresh
      // AFTER the view settles (two frames). Doing them synchronously on open hits
      // a not-yet-ready view/camera: the per-level range applies to a stale view
      // (wrong slab → blank plan) and fitToBox no-ops on the un-sized camera. This
      // is exactly the timing the view-depth slider hit — nudging it "fixed" every
      // dead level — now run on open for every level.
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          if (currentLevel !== name) return; // user moved on
          applyCutOffset(name); // per-level top cut
          if (sharedPlanCam) {
            restorePlanCam(); // subsequent visits → restore the shared 2D pan/zoom
          } else {
            await fitActive(); // first visit → frame now that the camera is sized
            const c = getWorld()?.camera?.controls as unknown as { update?: (d: number) => void };
            try {
              c?.update?.(0); // apply the fit before capturing the shared pose
            } catch {
              /* some builds reject delta 0 */
            }
            capturePlanCam(); // seed the shared 2D pose from the real fit
          }
          // Apply depth AND fire the panel update that COMMITS the slab — the exact
          // path the view-depth slider runs (range alone, without the commit, never
          // took on open). This makes every level correct on first open, no nudge.
          applyDepthAndCommit();
        }),
      );
    } catch (error) {
      console.warn("[plans-panel] failed to open plan", name, error);
    }
  };

  const exitPlan = () => {
    capturePlanCam(); // remember the shared 2D pan/zoom for the next plan visit
    currentLevel = null;
    disposePlanSection(); // drop the plan's section fill + edges
    if (!views.hasOpenViews) {
      restorePlanLook();
      update({ active: null });
      return;
    }
    views.close(); // restores the prior orbit camera + pose
    restorePlanLook(); // anchor + postproduction style back to the 3D snapshot
    update({ active: null });
  };

  // ── Build the storey list + register the storey views ──────────
  const rebuild = async () => {
    const token = ++rebuildToken;
    // The model set changed → the remembered 2D pose + clip baselines are stale.
    sharedPlanCam = null;
    currentLevel = null;
    baseRange.clear();
    baseCut.clear();
    cutOffsets.clear();
    disposePlanSection(); // views are about to be cleared/regenerated
    const world = getWorld();
    const models = [...fragments.list.values()];
    if (!world || models.length === 0) {
      views.list.clear();
      if (token === rebuildToken) update({ status: "empty", levels: [], active: null });
      return;
    }
    update({ status: "loading" });
    try {
      views.world = world;
      views.list.clear(); // drop stale views before regenerating
      await views.createFromIfcStoreys({ world });

      const levels: Level[] = [];
      const seenNames = new Set<string>(); // views.list is keyed by Name → dedupe
      for (const [, model] of fragments.list) {
        const ids = Object.values(
          await model.getItemsOfCategories([/BUILDINGSTOREY/]),
        ).flat();
        if (ids.length === 0) continue;
        const data = await model.getItemsData(ids, {
          attributesDefault: false,
          attributes: ["Name", "Elevation"],
        });
        // RTC coordinate height (same term createFromIfcStoreys uses to place the
        // plane), so a reconciled view sits at the right elevation.
        let coordHeight = 0;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const coords = (await (model as any).getCoordinates?.()) as any;
          if (Array.isArray(coords)) coordHeight = Number(coords[1]) || 0;
        } catch {
          /* no coordinates → assume 0 */
        }
        for (const d of data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const nm = (d as any)?.Name;
          if (!(nm && "value" in nm && nm.value != null)) continue;
          const name = String(nm.value);
          if (seenNames.has(name)) continue; // duplicate storey name → one view only
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const el = (d as any)?.Elevation;
          const elevation =
            el && "value" in el && el.value != null ? Number(el.value) : NaN;
          // RECONCILE: createFromIfcStoreys SKIPS storeys whose Elevation value is
          // missing, so they get no view and the level is unreachable. If we know
          // the elevation, create the missing plan view here (same plane math as
          // the library: normal (0,-1,0), height = elevation + coordHeight + offset).
          if (!views.list.has(name) && Number.isFinite(elevation)) {
            try {
              const plane = new THREE.Plane(
                new THREE.Vector3(0, -1, 0),
                elevation + coordHeight + CREATION_OFFSET,
              );
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (views as any).createFromPlane(plane, { id: name, world });
            } catch (e) {
              console.warn("[plans-panel] could not create plan view for", name, e);
            }
          }
          if (!views.list.has(name)) {
            // Still no view (e.g. no elevation at all) → don't list a dead button.
            console.warn(
              "[plans-panel] level has no plan view, skipping:",
              name,
              "elevation:",
              elevation,
            );
            continue;
          }
          seenNames.add(name);
          levels.push({ name, elevation });
        }
      }
      // Top floor first (NaN elevations sort to the bottom).
      levels.sort((a, b) => (b.elevation || 0) - (a.elevation || 0));
      if (token !== rebuildToken) return;
      update({ status: levels.length > 0 ? "ready" : "empty", levels, active: null });
    } catch (error) {
      if (token !== rebuildToken) return;
      console.warn("[plans-panel] failed to build floor plans", error);
      update({ status: "empty", levels: [], active: null });
    }
  };

  const [panel, update] = BUI.Component.create<BUI.Panel, PanelState>(
    (state) => {
      const levelRow = (lvl: Level) => BUI.html`
        <div
          class="pl-row ${state.active === lvl.name ? "active" : ""}"
          @click=${() => enterPlan(lvl.name)}
          title=${lvl.name}
        >
          <bim-icon class="pl-ico" icon="mdi:layers"></bim-icon>
          <span class="pl-name">${lvl.name}</span>
          <span class="pl-elev">${elevText(lvl.elevation)}</span>
        </div>
      `;

      // Filter levels by name + elevation text (the searchbar above the list).
      const q = state.filter.trim().toLowerCase();
      const shown = q
        ? state.levels.filter(
            (l) => l.name.toLowerCase().includes(q) || elevText(l.elevation).toLowerCase().includes(q),
          )
        : state.levels;

      return BUI.html`
        <bim-panel
          label="Floor Plans"
          icon="mdi:floor-plan"
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .pl-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .pl-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .pl-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }
            .pl-row { box-sizing: border-box; min-height: 30px; display: flex;
              align-items: center; gap: 0.45rem; cursor: pointer;
              padding: 0.3rem 0.6rem 0.3rem 1.1rem; font-size: 0.78rem;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .pl-row:hover { background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08)); }
            .pl-row.active { background: var(--bim-ui_accent-base, #6528d7); color: #fff; }
            .pl-row.active .pl-ico, .pl-row.active .pl-elev { color: #fff; opacity: 0.9; }
            .pl-ico { flex: 0 0 auto; color: var(--bim-ui_bg-contrast-60, #99a0ae); font-size: 0.95rem; }
            .pl-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .pl-elev { flex: 0 0 auto; opacity: 0.55; font-variant-numeric: tabular-nums; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0.4rem 0.4rem 0.4rem 1.1rem; gap: 0.4rem;">
              <!-- Searchbar + inline back-to-3D icon (mirrors the files panel row). -->
              <div style="display: flex; align-items: stretch; gap: 0.4rem; flex: 0 0 auto;">
                <bim-text-input
                  icon="mdi:magnify"
                  icon-inside
                  placeholder="Filter levels…"
                  .value=${state.filter}
                  style="flex: 1 1 auto;"
                  @input=${(e: Event) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const v = String((e.target as any).value ?? "");
                    if (searchTimer !== undefined) clearTimeout(searchTimer);
                    searchTimer = window.setTimeout(() => update({ filter: v }), 200);
                  }}
                ></bim-text-input>
                <bim-button
                  icon="mdi:cube-outline"
                  ?disabled=${!state.active}
                  @click=${exitPlan}
                  style="flex: 0 0 auto;"
                ><bim-tooltip>Back to 3D</bim-tooltip></bim-button>
              </div>
              <!-- View depth: how far below the storey cut is visible. Only while
                   a plan is open. -->
              ${state.active
                ? BUI.html`
                    <div style="display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; font-size: 0.72rem; color: var(--bim-ui_bg-contrast-70, #a7a7ab);">
                      <span style="white-space: nowrap;"><bim-icon icon="mdi:arrow-expand-down" style="vertical-align: -0.1rem;"></bim-icon> View depth</span>
                      <bim-number-input
                        style="flex: 1 1 auto;"
                        slider
                        .value=${state.viewDepth}
                        min="0"
                        max=${VIEW_DEPTH_MAX}
                        step=${VIEW_DEPTH_STEP}
                        @change=${(e: Event) => {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const v = Number((e.target as any).value);
                          if (!Number.isFinite(v)) return;
                          viewDepth = Math.max(0, v);
                          applyDepthAndCommit(); // applyViewDepth + refreshPlanSection + update
                        }}
                      ></bim-number-input>
                    </div>
                    <!-- Cut height: how far ABOVE the floor the horizontal cut is taken (per plan). -->
                    <div style="display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; font-size: 0.72rem; color: var(--bim-ui_bg-contrast-70, #a7a7ab);">
                      <span style="white-space: nowrap;"><bim-icon icon="mdi:content-cut" style="vertical-align: -0.1rem;"></bim-icon> Cut height</span>
                      <bim-number-input
                        style="flex: 1 1 auto;"
                        slider
                        .value=${state.cutOffset}
                        min="0"
                        max=${CUT_OFFSET_MAX}
                        step=${CUT_OFFSET_STEP}
                        @change=${(e: Event) => {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const v = Number((e.target as any).value);
                          if (!Number.isFinite(v) || !currentLevel) return;
                          cutOffsets.set(currentLevel, Math.max(0, v));
                          applyCutOffset(currentLevel);
                          refreshPlanSection(); // the cut plane moved
                          update({ cutOffset: Math.max(0, v) });
                        }}
                      ></bim-number-input>
                    </div>`
                : null}
              <div
                class="pl-vp"
                style="flex: 1 1 auto; min-height: 0; overflow-y: auto; margin-left: -1.1rem; margin-right: -0.4rem;"
              >
                ${state.status === "loading"
                  ? BUI.html`<div style="padding: 0.6rem 1.1rem;"><bim-label style="opacity: 0.6;">Loading…</bim-label></div>`
                  : state.status === "empty"
                    ? BUI.html`<div style="padding: 0.6rem 1.1rem;"><bim-label style="opacity: 0.6; white-space: normal;">No storeys found. Load a model with IFC building storeys.</bim-label></div>`
                    : shown.length === 0
                      ? BUI.html`<div style="padding: 0.6rem 1.1rem;"><bim-label style="opacity: 0.6; white-space: normal;">No levels match "${state.filter}".</bim-label></div>`
                      : BUI.html`${shown.map(levelRow)}`}
              </div>
            </div>
          </div>
        </bim-panel>
      `;
    },
    { status: "loading", levels: [], active: null, filter: "", viewDepth: VIEW_DEPTH_DEFAULT, cutOffset: CUT_OFFSET_DEFAULT },
  );

  // ── Triggers ───────────────────────────────────────────────────
  fragments.core.onModelLoaded.add(() => rebuild());
  fragments.list.onItemDeleted.add(() => {
    if (views.hasOpenViews) views.close();
    disposePlanSection(); // drop section edges tied to the now-stale views
    restorePlanLook(); // anchor + postproduction style back to 3D
    rebuild();
  });
  rebuild();

  return panel;
};
