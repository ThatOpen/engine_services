import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import type { WalkthroughController } from "./walkthrough";
import { toolModeManager } from "./tool-mode-manager";
import type { InspectionAction } from "./inspection";

/**
 * Floating "visibility" toolbar — bottom-center over the viewport.
 *
 * A self-mounting `bim-toolbar` (matching the look of `toolbar.ts`: dark
 * `bg-base`, rounded, subtle shadow, icon-only `bim-button`s with standalone
 * `<bim-tooltip>` hover tooltips) placed inside a floating `bim-grid` overlay so
 * empty areas click through to the 3D scene.
 *
 * ── MODE TOGGLE ────────────────────────────────────────────────────────────
 * One labeled toggle button flips the *target* every action operates on:
 *  - "Selected"   → the current Highlighter select set (`selection.select`).
 *                   If nothing is selected the target is EMPTY (actions no-op).
 *  - "Unselected" → everything that is NOT selected. If nothing is selected the
 *                   target is the WHOLE model.
 *
 * ── ACTIONS (each reversible via Show / Reset) ─────────────────────────────
 *  - HIDE    → hide the target set.
 *  - SHOW    → un-hide the target set.
 *  - ISOLATE → show only the target set, hide everything else.
 *  - GHOST   → render the target set semi-transparent; opaque rest.
 *  - RESET   → restore full visibility + opacity (clears hide AND ghost).
 *
 * Combos give full control, e.g.:
 *  - Unselected + Hide  = isolate the selection.
 *  - Selected   + Hide  = hide the selection.
 *  - Show / Reset       = restore.
 *
 * ── VISIBILITY API ─────────────────────────────────────────────────────────
 * Visibility (hide/show/isolate) goes through `OBC.Hider` (`set` / `isolate`),
 * which drives the fragments' per-item visibility flag and triggers the core
 * redraw itself — NOT the Highlighter recolor-on-hover path (honoring the perf
 * rule). Ghosting uses a dedicated transparent Highlighter style ("ghost") —
 * the idiomatic flat x-ray the library's Hoverer example calls "ghost mode".
 * It renders a uniform faint translucent gray shell as a flat overlay (NOT
 * through the deferred pen-shadows emitter, which looked muddy), is fully
 * reversible via `highlighter.clear("ghost")`, and coexists with the "select"
 * style so selection still works while items are ghosted.
 *
 * ── MOUNTING ───────────────────────────────────────────────────────────────
 * `visibilityToolbar(components)` builds the floating overlay AND appends it to
 * the viewport itself (it locates the viewport like the other setups do), then
 * returns the `bim-toolbar` element. To wire it from main.ts, add this single
 * line after the viewport + Highlighter exist (e.g. next to the `toolbar(...)`
 * call):
 *
 *     visibilityToolbar(components);
 *
 * @param components engine components
 * @param container optional viewport element to overlay; if omitted, the first
 *                  world's renderer container (the viewport) is used.
 */

type TargetMode = "selected" | "unselected";

// Minimal toggle-controller shape (exploded view, etc.) — a single toolbar
// button can drive any controller exposing this surface.
type ToggleCtrl = {
  toggle(): void;
  isActive(): boolean;
  onChange(cb: (active: boolean) => void): () => void;
};

const isModelIdMapEmpty = (map?: OBC.ModelIdMap) =>
  !map || !Object.values(map).some((set) => set.size > 0);

export const visibilityToolbar = (
  components: OBC.Components,
  container?: HTMLElement,
  walk?: WalkthroughController,
  explode?: ToggleCtrl,
  inspection?: InspectionAction[],
) => {
  const fragments = components.get(OBC.FragmentsManager);
  const hider = components.get(OBC.Hider);
  const highlighter = components.get(OBF.Highlighter);

  // ── Ghost / x-ray (scalable per-element GPU state texture) ──────────────
  // The legacy approach recolored fragments per item via a Highlighter "ghost"
  // style (highlightByID) — O(elements) CPU churn that breaks batching. Ghost
  // now lives on the GPU: `model.setGhostItems(localIds)` flips a per-element
  // state texture sampled in the SHELL shader (faint screen-door + desaturate),
  // so it scales to millions of elements with no per-item CPU work. See
  // engine_fragments-beta ghost-emission.ts / material-manager.ts.
  let mode: TargetMode = "selected";

  // ── Target-set resolution ──────────────────────────────────────────────
  const selection = (): OBC.ModelIdMap | undefined => highlighter.selection.select;

  /**
   * The ModelIdMap the current mode targets.
   *  - selected:   the select set (empty → empty map).
   *  - unselected: every loaded item minus the select set (nothing selected →
   *                the whole model).
   * Built async because the "unselected" set is derived from each model's full
   * item list (via getItemsByVisibility(true|false) union = all items).
   */
  const targetMap = async (): Promise<OBC.ModelIdMap> => {
    const sel = selection();
    if (mode === "selected") {
      // Clone defensively (Hider/iteration shouldn't mutate the live set).
      const out: OBC.ModelIdMap = {};
      if (sel) {
        for (const [modelId, set] of Object.entries(sel)) {
          if (set.size > 0) out[modelId] = new Set(set);
        }
      }
      return out;
    }
    // unselected = all items in every model, minus the selected ones.
    const out: OBC.ModelIdMap = {};
    for (const [modelId, model] of fragments.list) {
      // Union of visible + hidden = every item the model knows about.
      const [vis, hid] = await Promise.all([
        model.getItemsByVisibility(true),
        model.getItemsByVisibility(false),
      ]);
      const all = new Set<number>([...vis, ...hid]);
      const selSet = sel?.[modelId];
      if (selSet) for (const id of selSet) all.delete(id);
      if (all.size > 0) out[modelId] = all;
    }
    return out;
  };

  // ── Ghost helpers (scalable GPU hash table) ─────────────────────────────
  // Always hash the SMALL key set (the selection) + an invert flag, so the
  // table stays tiny whether we ghost the selection or everything-but it:
  //  - "selected"   → ghost the selection (invert=false).
  //  - "unselected" → ghost everything EXCEPT the selection (invert=true),
  //    applied to every loaded model (a model with no selection → empty key set
  //    + invert=true → fully ghosted).
  const applyGhost = async () => {
    const sel = selection() ?? {};
    const invert = mode === "unselected";
    const tasks: Promise<unknown>[] = [];
    for (const model of fragments.list.values()) {
      const set = sel[model.modelId];
      const ids = set ? [...set] : [];
      if (!invert && ids.length === 0) continue; // ghost-selected with nothing selected
      // setGhostItems is async (localId→itemId conversion) — update after all.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tasks.push((model as any).setGhostItems(ids, invert));
    }
    await Promise.all(tasks);
    await fragments.core.update(true);
  };

  /** Clear the ghost overlay on every loaded model. */
  const clearGhost = async () => {
    for (const model of fragments.list.values()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).clearGhost?.();
    }
    await fragments.core.update(true);
  };

  /**
   * Un-ghost the given items in place (without disturbing the rest of the ghost
   * state). Making items visible should also clear their ghost, so a shown
   * element never lingers as a ghost.
   */
  const unghost = async (map: OBC.ModelIdMap) => {
    const tasks: Promise<unknown>[] = [];
    for (const model of fragments.list.values()) {
      const set = map[model.modelId];
      if (!set || set.size === 0) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tasks.push((model as any).unsetGhostItems?.([...set]));
    }
    if (!tasks.length) return;
    await Promise.all(tasks);
    await fragments.core.update(true);
  };

  // ── Actions ─────────────────────────────────────────────────────────────
  const doHide = async () => {
    const map = await targetMap();
    if (isModelIdMapEmpty(map)) return; // nothing to hide (e.g. Selected w/ no selection)
    await hider.set(false, map);
  };

  const doShow = async () => {
    const map = await targetMap();
    // For "unselected" w/ no selection this is the whole model → show all.
    if (isModelIdMapEmpty(map)) {
      await hider.set(true);
      await clearGhost(); // all visible → nothing should stay ghosted
      return;
    }
    await hider.set(true, map);
    await unghost(map); // shown items un-ghost
  };

  const doIsolate = async () => {
    const map = await targetMap();
    if (isModelIdMapEmpty(map)) return; // isolating an empty set would blank the model
    await hider.isolate(map);
    await unghost(map); // the isolated (visible) items un-ghost
  };

  const doGhost = async () => {
    await applyGhost();
  };

  // Frame the camera on the target set's merged bounding box (same fit the tree's
  // Focus button uses). Targets selected or unselected per the mode toggle.
  const doFocus = async () => {
    const map = await targetMap();
    if (isModelIdMapEmpty(map)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = [...components.get(OBC.Worlds).list.values()][0] as any;
    const controls = world?.camera?.controls;
    if (!controls?.fitToSphere) return;
    try {
      const boxes = (await fragments.getBBoxes(map)) as THREE.Box3[];
      const box = new THREE.Box3();
      for (const b of boxes) box.union(b);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      await controls.fitToSphere(sphere, true); // animated, preserves view dir
    } catch (error) {
      console.warn("[visibility-toolbar] focus failed", error);
    }
  };

  // Reset: restore full visibility AND clear every ghost override.
  const doReset = async () => {
    await hider.set(true);
    await clearGhost();
  };

  // ── Toolbar UI ──────────────────────────────────────────────────────────
  type Action = { label: string; icon: string; run: () => void | Promise<void> };
  const actions: Action[] = [
    { label: "Focus", icon: "mdi:image-filter-center-focus", run: doFocus },
    { label: "Hide", icon: "mdi:eye-off-outline", run: doHide },
    { label: "Show", icon: "mdi:eye-outline", run: doShow },
    { label: "Isolate", icon: "mdi:select-search", run: doIsolate },
    { label: "Ghost", icon: "mdi:ghost-outline", run: doGhost },
  ];

  let busy = false;
  const onAction = async (run: () => void | Promise<void>) => {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (error) {
      console.warn("[visibility-toolbar] action failed", error);
    } finally {
      busy = false;
    }
  };

  const toggleMode = () => {
    mode = mode === "selected" ? "unselected" : "selected";
    barUpdate({ tick: ++tick });
  };

  // ── Camera projection (perspective ⇄ orthographic) ──────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraProjection = (): any =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([...components.get(OBC.Worlds).list.values()][0] as any)?.camera?.projection;
  const isOrtho = () => cameraProjection()?.current === "Orthographic";

  // AO now reconstructs correctly under orthographic projection (fixed at source
  // in the beta postproduction shaders via the `uOrtho` branch), so we no longer
  // force it off in ortho — the user's AO setting is honored in both projections.
  const toggleProjection = async () => {
    const proj = cameraProjection();
    if (!proj?.set) return;
    const goingOrtho = !isOrtho();
    await proj.set(goingOrtho ? "Orthographic" : "Perspective");
    barUpdate({ tick: ++tick });
  };

  let tick = 0;

  const [bar, barUpdate] = BUI.Component.create<HTMLElement, { tick: number }>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_state) => {
      const modeLabel = mode === "selected" ? "Selected" : "Unselected";
      const modeIcon =
        mode === "selected" ? "mdi:cursor-default-click-outline" : "mdi:select-remove";
      const modeTip =
        mode === "selected"
          ? "Target: SELECTED elements — click to switch to Unselected"
          : "Target: UNSELECTED elements (rest of model) — click to switch to Selected";
      return BUI.html`
        <bim-toolbar
          style="
            pointer-events: auto;
            overflow: visible;
            padding: 0.15rem;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
          "
        >
          <bim-toolbar-section label-hidden style="background: transparent;">
            <bim-button
              label=${modeLabel}
              icon=${modeIcon}
              @click=${toggleMode}
              style="height: 1.9rem;"
            ><bim-tooltip placement="top">${modeTip}</bim-tooltip></bim-button>
          </bim-toolbar-section>
          <bim-toolbar-section label-hidden style="background: transparent;">
            ${actions.map(
              (a) => BUI.html`
                <bim-button
                  icon=${a.icon}
                  @click=${() => onAction(a.run)}
                  style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
                ><bim-tooltip placement="top">${`${a.label} ${modeLabel.toLowerCase()}`}</bim-tooltip></bim-button>
              `,
            )}
          </bim-toolbar-section>
          <bim-toolbar-section label-hidden style="background: transparent;">
            <bim-button
              icon="mdi:restore"
              @click=${() => onAction(doReset)}
              style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
            ><bim-tooltip placement="top">Reset: show all + clear ghost</bim-tooltip></bim-button>
          </bim-toolbar-section>
          <bim-toolbar-section label-hidden style="background: transparent;">
            <bim-button
              icon=${isOrtho() ? "mdi:perspective-less" : "mdi:perspective-more"}
              @click=${toggleProjection}
              style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
            ><bim-tooltip placement="top">${
              isOrtho()
                ? "Orthographic view — switch to Perspective"
                : "Perspective view — switch to Orthographic"
            }</bim-tooltip></bim-button>
          </bim-toolbar-section>
          ${walk
            ? BUI.html`<bim-toolbar-section label-hidden style="background: transparent;">
                <bim-button
                  icon="mdi:walk"
                  ?active=${walk.isActive()}
                  @click=${() => walk.toggle()}
                  style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
                ><bim-tooltip placement="top">${
                  walk.isActive()
                    ? "Exit walkthrough"
                    : "Walkthrough — first-person navigation"
                }</bim-tooltip></bim-button>
              </bim-toolbar-section>`
            : BUI.html``}
          ${explode
            ? BUI.html`<bim-toolbar-section label-hidden style="background: transparent;">
                <bim-button
                  icon="mdi:arrow-expand-vertical"
                  ?active=${explode.isActive()}
                  @click=${() => explode.toggle()}
                  style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
                ><bim-tooltip placement="top">${
                  explode.isActive()
                    ? "Collapse — un-explode"
                    : "Exploded view"
                }</bim-tooltip></bim-button>
              </bim-toolbar-section>`
            : BUI.html``}
        </bim-toolbar>
      `;
    },
    { tick: 0 },
  );

  // Keep the walkthrough button's active state in sync (incl. auto-exit on
  // model unload) without polling.
  if (walk) walk.onChange(() => barUpdate({ tick: ++tick }));
  if (explode) explode.onChange(() => barUpdate({ tick: ++tick }));

  // ── Inspection tab (Select default · Clip · Measure length/area/angle) ──────
  // A second toolbar holding the inspection tools, routed through W1's
  // toolModeManager (exclusive). Built only when `inspection` actions are passed;
  // the bottom bar then becomes a bim-tabs with View (visibility) + Inspect tabs.
  const manager = toolModeManager(components);
  let itick = 0;
  const [inspectionBar, inspUpdate] = BUI.Component.create<BUI.Toolbar, { tick: number }>(
    // Arity >= 1 (state param) required, else create returns a single element and
    // the [inspectionBar, inspUpdate] destructure throws "object is not iterable".
    (_s) => {
      const selActive = manager.getActiveId() === "select";
      const actionButton = (a: InspectionAction) => BUI.html`
        <bim-button
          icon=${a.icon}
          ?active=${a.isActive()}
          @click=${() => a.activate()}
          style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
        ><bim-tooltip placement="top">${a.label}</bim-tooltip></bim-button>`;
      // Split the actions into a Clip section + a Measure section so the toolbar's
      // section divider draws a line between the cut button and the measure tools.
      const acts = inspection ?? [];
      const clipActions = acts.filter((a) => a.id.startsWith("clip"));
      const measureActions = acts.filter((a) => a.id.startsWith("measure"));
      return BUI.html`
        <bim-toolbar
          style="pointer-events: auto; overflow: visible; padding: 0.15rem; box-shadow: 0 2px 8px rgba(0,0,0,0.25);"
        >
          <bim-toolbar-section label-hidden style="background: transparent;">
            <bim-button
              icon="mdi:cursor-default"
              ?active=${selActive}
              @click=${() => manager.selectMode()}
              style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
            ><bim-tooltip placement="top">Select</bim-tooltip></bim-button>
          </bim-toolbar-section>
          ${clipActions.length
            ? BUI.html`<bim-toolbar-section label-hidden style="background: transparent;">
                ${clipActions.map(actionButton)}
              </bim-toolbar-section>`
            : BUI.html``}
          ${measureActions.length
            ? BUI.html`<bim-toolbar-section label-hidden style="background: transparent;">
                ${measureActions.map(actionButton)}
              </bim-toolbar-section>`
            : BUI.html``}
        </bim-toolbar>`;
    },
    { tick: 0 },
  );
  // Refresh ALL button active-states (Select + tool buttons) when the active
  // tool changes (W1 fires onActiveChanged through the manager).
  manager.onActiveChanged.add(() => inspUpdate({ tick: ++itick }));

  // The element docked in the floating grid: a tabbed bar when inspection actions
  // are supplied (View = visibility, Inspect = tools), else just the bar.
  const dock: HTMLElement = inspection
    ? (BUI.Component.create(
        () => BUI.html`
          <bim-tabs floating style="pointer-events: auto;">
            <bim-tab name="view" label="View" icon="mdi:eye-outline">${bar}</bim-tab>
            <bim-tab name="inspect" label="Inspect" icon="mdi:cursor-default-click">${inspectionBar}</bim-tab>
          </bim-tabs>`,
      ) as unknown as HTMLElement)
    : (bar as unknown as HTMLElement);

  // ── Floating grid overlay: bar docked bottom-center, empty areas click through ──
  const grid = BUI.Component.create(() => {
    const onCreated = (element?: Element) => {
      if (!element) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = element as any;
      g.elements = { bar: dock };
      g.layouts = {
        main: {
          template: `
            "fillL  fillC fillR" 1fr
            "restL  bar   restR" auto
            / 1fr auto 1fr
          `,
        },
      };
      g.layout = "main";
    };
    return BUI.html`
      <bim-grid style="padding: 1rem;" ${BUI.ref(onCreated)} floating></bim-grid>
    `;
  });

  // Resolve the viewport to overlay (the renderer container of the first world).
  const resolveContainer = (): HTMLElement | undefined => {
    if (container) return container;
    const world = [...components.get(OBC.Worlds).list.values()][0] as
      | { renderer?: { three?: { domElement?: HTMLElement } } }
      | undefined;
    const canvas = world?.renderer?.three?.domElement;
    // Overlay the canvas's parent (the viewport element), so the floating grid
    // sits on top of the 3D scene.
    return (canvas?.parentElement as HTMLElement | undefined) ?? undefined;
  };

  const host = resolveContainer();
  if (host) {
    host.append(grid);
  } else {
    console.warn(
      "[visibility-toolbar] no viewport found to overlay; append the returned element manually",
    );
  }

  // Refresh the tooltips/state when the selection changes (so the Selected-mode
  // action tooltips reflect whether there's anything to act on).
  highlighter.events.select.onHighlight.add(() => barUpdate({ tick: ++tick }));
  highlighter.events.select.onClear.add(() => barUpdate({ tick: ++tick }));

  return bar;
};
