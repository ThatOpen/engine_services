/* MD
  ## Sidebar navigation
  ---
  Product teams building BIM apps often need multiple distinct views — a 3D model
  viewer, a data browser, a settings screen — but wiring a custom nav bar and
  managing view transitions from scratch adds complexity before any real feature
  work begins.

  top-app supports named layouts with a built-in sidebar navigation bar that
  switches the active grid template on click, so teams get multi-view navigation
  without building the scaffolding themselves.

  This tutorial covers defining three named layouts with their own grid templates
  and icons; providing a dedicated element for each view; enabling the sidebar nav
  bar; and setting the initial active layout.

  By the end, you'll have a multi-view BIM app with a persistent sidebar that lets
  users switch between a 3D viewer, a data panel, and a settings screen.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "thatopen-services";
import uiManagerDef from "../../../../index";
import type { App } from "../../index";

const UIManager = uiManagerDef.componentDefinition;
const client = PlatformClient.fromPlatformContext();
const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };
components.get(UIManager).init();

const app = document.createElement("top-app") as unknown as App;

app.setup = (waitUntil) => {
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

app.elements = {
  viewer: () =>
    html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,

  data: () => html`
    <bim-panel label="Data">
      <bim-panel-section label="Properties" icon="solar:document-bold">
        <bim-label>Select an element in the viewer to inspect its properties.</bim-label>
      </bim-panel-section>
    </bim-panel>
  `,

  settings: () => html`
    <bim-panel label="Settings">
      <bim-panel-section label="Appearance" icon="solar:settings-bold">
        <bim-checkbox label="Show grid" checked></bim-checkbox>
        <bim-checkbox label="Show axes"></bim-checkbox>
      </bim-panel-section>
    </bim-panel>
  `,
};

app.layouts = {
  // Each layout defines its own CSS grid template. Only areas used in a template
  // are rendered for that layout — unused elements are not created.
  viewer: {
    label: "Viewer",
    icon: "solar:3d-square-bold",
    template: `"viewer" 1fr / 1fr`,
  },
  data: {
    label: "Data",
    icon: "solar:document-bold",
    template: `"data" 1fr / 1fr`,
  },
  settings: {
    label: "Settings",
    icon: "solar:settings-bold",
    template: `"settings" 1fr / 1fr`,
  },
};

// sidebar=true adds a vertical nav column on the left with one button per layout.
// Each button shows the layout's label and icon and activates that layout on click.
app.sidebar = true;
app.layout = "viewer";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
