/* MD
  ## top-app
  ---
  Front-end developers building BIM web apps need to coordinate several async
  initialization steps before the UI can be shown — loading the engine, preparing
  fragment workers, registering loaders — and users need visible feedback on what
  is happening during that wait, rather than a blank screen.

  top-app is the platform's root shell element. It manages the full boot sequence,
  tracks each async setup task individually, shows a labelled loading screen until
  every task completes, and then mounts the app's visual layout.

  This tutorial covers initializing the platform client and registering all
  platform web components; registering two async setup tasks — the fragment worker
  and the IFC loader — each with its own loading-screen label; declaring a named
  layout area as a CSS grid template; wiring a 3D viewer into that layout; and
  using a flag to keep the loading screen visible during development.

  By the end, you'll have a working app shell that boots the engine, shows a
  step-by-step loading screen, and mounts a 3D viewer once every setup task
  resolves.
*/

import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "thatopen-services";
import uiManagerDef from "../../index";
import type { App } from "./index";

const UIManager = uiManagerDef.componentDefinition;

const client = PlatformClient.fromPlatformContext();

// UIManager must be in the setup call: it registers all platform web components
// (top-app, top-viewer, top-viewer-tools, etc.) before the DOM renders.
const { components } = (await client.setup(
  { OBC, OBF, BUI, THREE, FRAGS },
  { uuid: UIManager.uuid },
)) as { components: OBC.Components };

components.get(UIManager).init();

const app = document.createElement("top-app") as unknown as App;

// setup runs synchronously and returns { components, client }.
// waitUntil registers async tasks that appear as labelled steps in the loading screen.
// All tasks run in parallel; top-app mounts only after every promise resolves.
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

  waitUntil(
    (async () => {
      const loader = components.get(OBC.IfcLoader);
      await loader.setup();
    })(),
    "IFC Loader",
  );

  return { components, client };
};

// Each key must match an area name used in at least one layout template.
app.elements = {
  viewer: () =>
    html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
};

// CSS grid-template shorthand. Area names are the keys for app.elements.
// "." creates an empty unnamed cell and is never rendered.
app.layouts = {
  main: {
    label: "Main",
    icon: "solar:3d-square-bold",
    template: `"viewer" 1fr / 1fr`,
  },
};

app.layout = "main";

// forceLoading keeps the boot screen visible even after setup completes.
// Useful during development to inspect the loading UI without real async tasks.
// app.forceLoading = true;

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
