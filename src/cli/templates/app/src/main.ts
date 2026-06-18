import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
// Inlines the fragments worker so it runs inside the platform's sandboxed iframe.
import "@thatopen/fragments/inline";
import * as BUI from "@thatopen/ui";
import * as MARKERJS from "@markerjs/markerjs3";
import {
  PlatformClient,
  AppManager,
  ViewportsManager,
  UIManager,
} from "@thatopen/services";

import { getAppManager } from "./app";
import {
  uiManager,
  cloudRunner,
  viewportsManager,
  fpsIndicator,
  activeToolHud,
  propertiesPanel,
  modelTree,
  filesPanel,
  graphicsPanel,
  clipperTool,
  clipperPanel,
  commandsPanel,
  plansPanel,
  navigationGizmo,
  measurementTool,
  measurementPanel,
  dataTablePanel,
  // explodedView, // removed from toolbar for launch — re-add with the controller in main()
  walkthrough,
  visibilityToolbar,
  rightStack,
} from "./setups";
// Direct imports (not in the setups barrel): the Objects-outliner panel + W1's
// unified clip-plane/measurement instance API it consumes.
import { objectsPanel } from "./setups/objects-panel";
import { inspectionInstances, inspectionActions } from "./setups/inspection";
import { measurementSettingsPanel } from "./setups/measurement-settings-panel";
import { settingsPanel } from "./setups/settings-panel";

// ─── RAW VIEWER (perf baseline) ──────────────────────────────────────
// Stripped to just: platform setup → bare viewport → auto-load one model →
// FPS overlay. NO panels (files/tree/properties), NO toolbar, NO helper/Styles,
// NO frame/hover/selection/postproduction. We'll re-add each piece one at a time
// to find what makes orbiting heavier than the raw example. Full main saved at
// `main.full.ts.bak`.
async function main() {
  const client = PlatformClient.fromPlatformContext();

  // Brand accent (purple). Theming via the library variable is the sanctioned
  // way — drives the layout-selector active state, the grid resize divider,
  // input focus rings, toggles, etc. (The library's dark-theme default is lime.)
  document.documentElement.style.setProperty("--bim-ui_accent-base", "#6528d7");

  // DEV: serve the local ViewportsManager built-in from :4100 if running.
  const ctx = (globalThis as Record<string, any>).__THATOPEN_CONTEXT__;
  if (ctx?.appId === "local-dev") {
    const DEV_BUILTINS: Record<string, string> = {
      [ViewportsManager.uuid]: "http://localhost:4100/ViewportsManager.iife.js",
      [AppManager.uuid]: "http://localhost:4100/AppManager.iife.js",
    };
    const orig = client.getBuiltInComponent.bind(client);
    (client as Record<string, any>).getBuiltInComponent = async (uuid: string) => {
      const url = DEV_BUILTINS[uuid];
      if (url) {
        try {
          return await (await fetch(url)).text();
        } catch {
          /* local bundle server down → fall back to the platform */
        }
      }
      return orig(uuid);
    };
  }

  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: ViewportsManager.uuid },
    { uuid: AppManager.uuid },
    { uuid: UIManager.uuid },
  );

  // Bare viewport (no frame/hover/selection/postproduction).
  const viewerElement = await viewportsManager(components);
  console.log("[raw] viewport ready");

  // ── LAYER 5: panels via the platform's LAYOUT system ──────────────
  // Two named layouts, each with an icon → the AppManager auto-generates the
  // vertical sidebar button bar (VS Code activity bar) that switches between
  // them. Each layout docks its panel beside the viewer (real grid column →
  // canvas shrinks, perf-friendly). No custom switcher/drag code.
  void rightStack;

  // Explorer panel: tree + properties STACKED (both visible together).
  const treeEl = modelTree(components);
  const propsEl = propertiesPanel(components);
  // Tree and properties are TWO SEPARATE GRID AREAS (stacked in the left column;
  // see the Explorer layout below), not a hand-rolled split inside one area. So
  // they get the exact same inter-area gap as every other area, AND the bim-grid
  // gives a draggable divider between them for free (it goes purple on
  // hover/drag — the app's resize accent, themed via --bim-grid--divider-c).

  // Files panel (upload / convert / add-to-scene UI).
  const filesEl = filesPanel(components, client) as unknown as HTMLElement;

  // FPS counter — mounted INSIDE the viewer, app-styled, and toggleable from the
  // Graphics panel (pass the controller in so the "Show FPS" switch can drive it).
  const fps = fpsIndicator(viewerElement);

  // Active-tool HUD — shows the current tool's label ("Drawing clipping plane",
  // "Measuring length", …), driven by the global toolModeManager. Decoupled: any
  // future tool that registers a label shows up here automatically.
  activeToolHud(viewerElement, components);

  // press R or resize (log section line resolution vs buffer/overlay sizes).

  // Graphics panel (rendering settings: postproduction, AO, edges, tone/scene,
  // grid, selection outline). Docked as a third layout beside the viewer.
  const graphicsEl = graphicsPanel(components, fps) as unknown as HTMLElement;

  // Clipping / section-planes (worker 1): the tool drives the planes; the panel
  // manages them + per-category section styling.
  const clipTool = clipperTool(components);
  const clippingEl = clipperPanel(components, clipTool) as unknown as HTMLElement;

  // Commands / keyboard-shortcuts panel (worker 3).
  const commandsEl = commandsPanel(components) as unknown as HTMLElement;

  // Floor plans / 2D plan navigation (worker 2).
  const plansEl = plansPanel(components) as unknown as HTMLElement;

  // Measurement (worker 1): tool + panel (length/area/angle + list/delete).
  const measureTool = measurementTool(components);
  const measureEl = measurementPanel(components, measureTool) as unknown as HTMLElement;
  // Measurement SETTINGS section for the merged Settings layout (color/units/
  // rounding/snaps/visible — W1's measurement settings API).
  const measureSettingsEl = measurementSettingsPanel(measureTool) as unknown as HTMLElement;

  // Element data table (worker 2): docked as a vertical side panel like the
  // others (narrow column; wide content scrolls horizontally / panel resizes).
  const dataTableEl = dataTablePanel(components) as unknown as HTMLElement;

  // Objects outliner (UI reorg, increment b): lists every clip plane + measurement
  // from W1's unified inspectionInstances API, each with hide/disable/delete.
  const inspection = inspectionInstances(clipTool, measureTool);
  const objectsEl = objectsPanel(inspection) as unknown as HTMLElement;

  // Merged Settings panel (UI-reorg polish): ONE scrolling panel with collapsible
  // sections (Graphics · Clip styling · Measurement · Commands), each re-homing
  // the existing panel element. Replaces the 4-stacked-panel Settings layout.
  const settingsEl = settingsPanel([
    { label: "Graphics", icon: "mdi:tune", el: graphicsEl },
    { label: "Clip styling", icon: "mdi:scissors-cutting", el: clippingEl },
    { label: "Measurement", icon: "mdi:ruler", el: measureSettingsEl },
    { label: "Commands", icon: "mdi:keyboard", el: commandsEl },
  ]) as unknown as HTMLElement;

  // RAW-UI-TEMP: keep panels filling their cell but DON'T flatten the chrome —
  // let bim-panel show its default border/radius/shadow. (Was also: border:none,
  // borderRadius:0, boxShadow:none + a border-right separator on files/graphics.)
  // Only the DOCKED panels fill their grid cell. graphics/clipping/commands/
  // measureSettings are NOT here — they're nested inside settingsEl (which manages
  // their height:auto), so forcing height:100% on them would fight that.
  for (const el of [treeEl, propsEl, filesEl, dataTableEl, objectsEl, settingsEl] as HTMLElement[]) {
    el.style.width = "100%";
    el.style.height = "100%";
  }

  // ── App shell: layout sidebar + docked panel + viewer ─────────────
  const app = getAppManager(components);
  await app.init({
    client,
    icons: [],
    componentSetups: { core: [uiManager, cloudRunner] },
    grid: (grid) => {
      grid.elements = {
        viewer: viewerElement,
        tree: treeEl,
        properties: propsEl,
        files: filesEl,
        dataTable: dataTableEl,
        objects: objectsEl,
        settings: settingsEl,
      };
      // UI REORG — activity bar order: Explorer · Assets · Objects · Data ·
      // Settings (Settings LAST). Files→Assets. Clipping + Measure are no longer
      // their own layouts: their TOOLS move to the bottom Inspection toolbar tab,
      // their plane/measurement INSTANCES to the Objects outliner, and their
      // SETTINGS into the merged Settings layout (Graphics + clip styling +
      // Commands; Measurement settings fold in once W1 exposes them).
      grid.layouts = {
        Explorer: {
          // Tree (top) + properties (bottom) are two separate areas stacked in
          // the left column; the viewer spans both rows. The shared row edge
          // becomes a draggable bim-grid divider, and both areas get the same
          // gap as the viewer↔column gap (consistent spacing, by construction).
          template: `
            "tree viewer" 1fr
            "properties viewer" 1fr
            / 22rem 1fr
          `,
          icon: "mdi:file-tree",
        },
        Assets: {
          // Project Files (top) + Objects outliner (bottom) STACKED in the left
          // column — same shape as Explorer's tree+properties stack — with the
          // viewer spanning both rows and a draggable divider on the shared edge.
          template: `
            "files viewer" 1fr
            "objects viewer" 1fr
            / 22rem 1fr
          `,
          icon: "mdi:folder-multiple-outline",
        },
        Data: {
          // Element data table docked as a vertical left-column panel like every
          // other layout. Wide tables scroll horizontally inside the panel, and
          // the shared column edge is a draggable bim-grid divider (resizable).
          template: `"dataTable viewer" 1fr / 22rem 1fr`,
          icon: "mdi:table",
        },
        Settings: {
          // ONE scrolling Settings panel with collapsible sections (Graphics ·
          // Clip styling · Measurement · Commands) — see settings-panel.ts.
          template: `"settings viewer" 1fr / 22rem 1fr`,
          icon: "mdi:cog",
        },
      };
      grid.layout = "Explorer";
      // RAW-UI-TEMP: keep the grid filling the viewport, but drop the cosmetic
      // flattening (padding/gap/radius + --bim-grid--g/p) and the purple accent
      // override — use the library's defaults.
      grid.style.width = "100%";
      grid.style.height = "100%";
      grid.style.margin = "0";
    },
  });
  // Show the auto-generated layout-switching sidebar (vertical button bar).
  app.showSidebar = true;
  console.log("[raw] app.init done — viewer mounted");

  // Walkthrough is now a headless controller (worker 2); create it here so its
  // mdi:walk toggle button can live in the bottom visibility toolbar.
  let walk;
  try {
    walk = walkthrough(components);
  } catch (e) {
    console.warn("[main] walkthrough controller failed to init", e);
  }

  // Exploded view removed from the toolbar for launch (re-add after). The
  // explodedView controller (worker 3) is intact — to bring back the button,
  // uncomment the controller below and pass `explode` (not undefined) to the
  // toolbar; the toolbar renders the button only when a controller is supplied.
  // let explode;
  // try {
  //   explode = explodedView(components);
  // } catch (e) {
  //   console.warn("[main] explodedView controller failed to init", e);
  // }

  // Floating bottom toolbar — now TABBED (bim-tabs): "View" = visibility actions
  // (Hide/Show/Ghost/Isolate + Selected⇄Unselected + Walkthrough); "Inspect" =
  // Select (default) + Clip plane + Measure length/area/angle, routed through the
  // toolModeManager. Self-mounts bottom-center over the viewport.
  visibilityToolbar(
    components,
    viewerElement,
    walk,
    undefined,
    inspectionActions(clipTool, measureTool),
  );

  // Navigation gizmo / view-cube, top-right (worker 2): live orientation +
  // click-to-orient preset views (faces/edges/corners) + home/zoom-to-fit.
  // Guarded so a gizmo-mount error can't abort viewer init.
  try {
    navigationGizmo(components, viewerElement);
  } catch (e) {
    console.warn("[main] navigationGizmo failed to mount", e);
  }

  // ── Auto-load one model (no UI), AFTER the viewer is up ───────────
  // Non-blocking: runs in the background so a slow load never affects the
  // mounted viewport. Mirrors the minimal scene-add wiring from the Files panel.
  void autoLoadFirstModel(components, client);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function autoLoadFirstModel(components: OBC.Components, client: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worlds = components.get(OBC.Worlds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const world = [...worlds.list.values()][0] as any;
  const fragments = components.get(OBC.FragmentsManager);
  fragments.list.onItemSet.add((event) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (event as any).value;
    if (world && model) {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      // Worker-side clip cull: let the fragments worker skip streaming/computing
      // tiles fully on the clipped-away side of the section planes (today the
      // clip is GPU-shader-only; the worker is blind to it). Return the
      // renderer's FULL clipping-plane list (BaseRenderer.clippingPlanes), NOT
      // three.clippingPlanes — our clipper runs in localClippingPlanes mode, so
      // the local planes are filtered out of three.clippingPlanes and the worker
      // would see an empty set (cull silently disabled).
      model.getClippingPlanesEvent = () =>
        Array.from(world.renderer?.clippingPlanes ?? []);
    }
    fragments.core.update(true);
  });

  const projectId: string | undefined = client?.context?.projectId;
  if (!projectId) {
    console.warn("[raw] no projectId — skipping auto-load");
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (await client.listFiles({ projectId })) as any[];
    // Prefer BLOXHUB (a medium model) as the default; fall back to first .frag.
    const frags = items.filter((it) =>
      (it.name ?? "").toLowerCase().endsWith(".frag"),
    );
    const frag =
      frags.find((it) => (it.name ?? "").toLowerCase().includes("bloxhub")) ??
      frags[0];
    if (!frag) {
      console.warn("[raw] no .frag in project to auto-load");
      return;
    }
    const resp = await client.downloadFile(String(frag._id));
    const buffer = await resp.arrayBuffer();
    // Key the model by the frag's fileId (not basename) so the Files panel —
    // which keys loaded models by fragId — can manage it (e.g. dispose on detach).
    const modelId = String(frag._id);
    await fragments.core.load(buffer, { modelId });
    await fragments.core.update(true);
    // Do NOT focus the camera on the model — keep the default view on load.
    console.log("[raw] auto-loaded model:", frag.name);
  } catch (error) {
    console.warn("[raw] auto-load failed", error);
  }
}

main().catch(console.error);
