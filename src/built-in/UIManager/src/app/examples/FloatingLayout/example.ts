/* MD
  ## Floating layout
  ---
  Developers building BIM coordination tools often want the 3D model to fill the
  entire window while control panels float above it — but standard grid layouts
  give every area equal standing, shrinking the viewer into one cell and leaving
  visible seams between it and the panels.

  top-app supports a floating mode where one element is mounted as an absolute
  background that fills the container edge-to-edge, and all other layout areas
  render as a transparent overlay on top of it with independent pointer events.

  This tutorial covers assigning the viewer as the absolute background of the app;
  defining an overlay layout where a side panel floats above the viewer without
  sharing grid space; and annotating why the base element is excluded from the
  layout template.

  By the end, you'll have a full-screen 3D viewer with a floating side panel
  hovering above it, with the model filling the entire window and the panel
  receiving its own pointer events.
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
  // "viewer" is referenced by app.base — rendered as a position:absolute layer
  // behind all layout content so it fills the container edge-to-edge.
  viewer: () =>
    html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,

  // Panels declared here appear in the floating content grid on top of the viewer.
  // Their container has pointer-events: none; each child re-enables them individually.
  panel: () => html`
    <bim-panel>
      <bim-panel-section label="Models" icon="solar:layers-bold">
        <bim-label>Load models here</bim-label>
      </bim-panel-section>
    </bim-panel>
  `,
};

// Setting app.base to an element key mounts that element as the absolute background.
// Layout templates then only list the floating overlay areas — not the base element.
// Without app.base, every area in the template is a peer grid cell (inline mode).
app.base = "viewer";

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:home-bold",
    // Only overlay areas appear here. "viewer" is not listed because it is the base.
    template: `"panel" 1fr / 22rem`,
  },
};

app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
