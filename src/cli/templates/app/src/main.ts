import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
// Inlines the fragments worker so it runs inside the platform's sandboxed iframe.
import "@thatopen/fragments/inline";
import * as BUI from "@thatopen/ui";
import * as MARKERJS from "@markerjs/markerjs3";
import { PlatformClient, UIManager } from "@thatopen/services";
import { setAppContext } from "./app";

// ─── A2 migration — PHASES 1+2: boot on UIManager + re-dock panels ───────────
// Juan consolidated the old AppManager (layout) + ViewportsManager (viewport)
// built-ins into the single UIManager built-in, which ships `top-app` (shell +
// layout) and `top-viewer` (deferred-PEN viewport). This boots the bim-viewer on
// that model.
//   Phase 1 — top-app shell hosting one top-viewer + auto-load.  [done]
//   Phase 2 — re-dock the side panels (tree/properties/files/data/objects/
//             settings) into top-app's layouts + sidebar.        [this file]
//   Phase 3 — the viewer-overlay tools (fps/HUD/gizmo/bottom toolbar/measure +
//             clip handles) that mount over the canvas.          [next]
// The pre-A2 rich main is preserved at `main.rich.ts.bak`.
async function main() {
  const client = PlatformClient.fromPlatformContext();

  // Brand accent (purple) — drives layout-selector active state, dividers, etc.
  document.documentElement.style.setProperty("--bim-ui_accent-base", "#6528d7");

  // The dev `thatopen serve` wrapper HTML doesn't zero the UA body margin (8px),
  // which insets the whole app inside the platform iframe. Kill it here so it's
  // fixed in both dev and production regardless of the host page.
  document.body.style.margin = "0";

  // UIManager must be in the setup call: it registers the platform web
  // components (top-app, top-viewer, top-viewer-tools, …) before the DOM renders.
  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: UIManager.uuid },
  );
  components.get(UIManager).init();

  // One STABLE top-viewer node, returned by reference so re-rendering top-app
  // (when we add the panels below) reuses it instead of disposing/recreating
  // its world. No <top-viewer-tools>: the bim-viewer mounts its own tabbed
  // visibility/inspect toolbar (see below), so the platform default would just
  // duplicate it.
  const viewerEl = document.createElement("top-viewer");
  // Frame the viewport to match the side panels (BUI bim-panel host = 1px border
  // + 0.75rem radius). top-viewer's host is already overflow:hidden, so the
  // radius clips the canvas corners; border-box keeps the 1px inside the grid
  // area. Done here (not in top-viewer) so the CDE's top-file-viewer, which draws
  // its own frame, never double-borders.
  viewerEl.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
  viewerEl.style.borderRadius = "0.75rem";
  viewerEl.style.boxSizing = "border-box";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = document.createElement("top-app") as any;

  app.setup = (waitUntil: (p: Promise<void>, label?: string) => void) => {
    waitUntil(
      (async () => {
        const fragments = components.get(OBC.FragmentsManager);
        const workerUrl = await FRAGS.FragmentsModels.getWorker();
        fragments.init(await FRAGS.toClassicWorker(workerUrl), {
          classicWorker: true,
        });
      })(),
      "Fragments Core",
    );
    return { components, client };
  };

  // Mount minimally first (viewer only) so top-viewer creates the world; the
  // panels + their tools are built once that world exists (below).
  app.elements = { viewer: () => BUI.html`${viewerEl}` };
  app.layouts = {
    Main: {
      label: "Main",
      icon: "solar:3d-square-bold",
      template: `"viewer" 1fr / 1fr`,
    },
  };
  app.layout = "Main";

  const container = document.getElementById("that-open-app") ?? document.body;
  container.appendChild(app);

  // Wait for top-viewer's world to exist before building world-dependent panels.
  // The viewer tool suite + dynamic-anchor pivot dot are now baked into
  // <top-viewer> (setupViewerTools), so the app no longer wires them.
  await firstWorld(components.get(OBC.Worlds));

  // Platform client + project data for the AppManager-shim consumers
  // (CloudRunner, data-table-panel, app-info-section).
  const projectId: string | undefined = client?.context?.projectId;
  let projectData;
  try {
    if (projectId) projectData = await client.getProjectData(projectId);
  } catch {
    /* dev/no-project → consumers degrade gracefully */
  }
  setAppContext(client, projectData);

  // Pluggable loaders for <top-models-list>. The built-in ships the lightweight
  // defaults (.frag load, IFC→fragments convert); heavy/app-specific loaders are
  // registered here so they stay OUT of the built-in's bundle. The reality-capture
  // .3tz viewer pulls Spark + 3d-tiles-renderer, so it's lazy-imported app-side
  // and plugged in via the loader registry. Alignment persists through the panel's
  // app-data via the loader context (getAlignment/setAlignment).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rcViewer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelLoaders: Record<string, any> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "3tz": async (fileId: string, ctx: any) => {
      if (!rcViewer) {
        const { realityCaptureViewer } = await import(
          "./setups/reality-capture-viewer"
        );
        rcViewer = realityCaptureViewer(ctx.components, client);
      }
      const saved = ctx.getAlignment(fileId) as number[] | undefined;
      await rcViewer.loadIntoWorld(fileId, {
        keepPostproduction: true,
        transform: saved ? new THREE.Matrix4().fromArray(saved) : undefined,
        onTransformChange: (m: THREE.Matrix4) =>
          ctx.setAlignment(fileId, m.toArray()),
      });
    },
  };

  // Re-dock: the stable viewer + the panels, under the bim-viewer's named layouts
  // with the activity-bar sidebar (Explorer · Assets · Data · Settings). All panels
  // are now built-ins that self-wire from top-app's componentsContext/clientContext
  // — no `components` plumbing in the app.
  app.elements = {
    viewer: () => BUI.html`${viewerEl}`,
    tree: () => BUI.html`<top-model-tree></top-model-tree>`,
    properties: () => BUI.html`<top-properties-panel></top-properties-panel>`,
    files: () =>
      BUI.html`<top-models-list .loaders=${modelLoaders}></top-models-list>`,
    dataTable: () => BUI.html`<top-data-table-panel></top-data-table-panel>`,
    objects: () => BUI.html`<top-objects-panel></top-objects-panel>`,
    settings: () => BUI.html`<top-settings-panel></top-settings-panel>`,
  };
  // No `label` → the sidebar renders icon-only activity-bar buttons (matching
  // the pre-A2 look), background only on the active one.
  app.layouts = {
    Explorer: {
      icon: "mdi:file-tree",
      template: `"tree viewer" 1fr "properties viewer" 1fr / 22rem 1fr`,
    },
    Assets: {
      icon: "mdi:folder-multiple-outline",
      template: `"files viewer" 1fr "objects viewer" 1fr / 22rem 1fr`,
    },
    Data: {
      icon: "mdi:table",
      template: `"dataTable viewer" 1fr / 22rem 1fr`,
    },
    Settings: {
      icon: "mdi:cog",
      template: `"settings viewer" 1fr / 22rem 1fr`,
    },
  };
  app.layout = "Explorer";
  app.sidebar = true;

  // ── Viewer toolbar — now a built-in slotted INTO <top-viewer> (it consumes the
  // world + components contexts top-viewer provides). The rich bottom toolbar +
  // active-tool HUD + clip/measure/walkthrough tools all live in
  // <top-viewer-toolbar>; the side panels share the SAME tool singletons via
  // components.get (OBC.Component-wrapped).
  viewerEl.appendChild(document.createElement("top-viewer-toolbar"));

  // Navigation gizmo is now baked into <top-viewer> (setupViewerTools), so the
  // app no longer mounts it. (Cascade: the rest of the overlay tools follow.)

  // No auto-load: the viewer opens empty. Users add models from the Assets
  // (files) panel — top-models-list loads the .frag they pick into the world.
}

/** Resolves with the first world once it exists (top-viewer creates it async). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstWorld(worlds: any): Promise<any> {
  const existing = [...worlds.list.values()][0];
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = ({ value }: any) => {
      worlds.list.onItemSet.remove(handler);
      resolve(value);
    };
    worlds.list.onItemSet.add(handler);
  });
}

main().catch(console.error);
