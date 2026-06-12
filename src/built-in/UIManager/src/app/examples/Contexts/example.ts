/* MD
  ## Consuming platform contexts in child components
  ---
  Developers building custom BIM panels need access to the 3D engine, the platform
  API, and the current project's metadata — but threading these objects down through
  props across multiple component layers forces every intermediate element to know
  about data it doesn't use, making trees brittle and hard to refactor.

  top-app publishes the engine instance, the platform client, and the current
  project data as named reactive contexts, so any descendant component can subscribe
  to exactly what it needs without any prop drilling from the root.

  This tutorial covers defining a custom panel that subscribes to the engine
  context, the platform client context, and the project data context; handling the
  intermediate loading state before contexts become available after boot; and
  mounting the panel inside a top-app layout.

  By the end, you'll have a custom info panel that reads the project name and engine
  state directly from context, with no objects passed down as props from the app root.
*/

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { consume } from "@lit/context";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, ProjectData } from "thatopen-services";
import uiManagerDef from "../../../../index";
import {
  componentsContext,
  clientContext,
  projectDataContext,
  appStateContext,
  type App,
  type AppState,
} from "../../index";

// appStateContext is provided by top-app immediately — before setup completes.
// componentsContext, clientContext, and projectDataContext become available only
// after app.setup returns and all waitUntil promises resolve.
@customElement("project-info-panel")
class ProjectInfoPanel extends LitElement {
  @consume({ context: appStateContext, subscribe: true })
  @state()
  private _appState?: AppState;

  @consume({ context: componentsContext, subscribe: true })
  @state()
  private _components?: OBC.Components;

  @consume({ context: clientContext, subscribe: true })
  @state()
  private _client?: PlatformClient;

  @consume({ context: projectDataContext, subscribe: true })
  @state()
  private _projectData?: ProjectData;

  render() {
    if (!this._components || !this._client || !this._projectData) {
      return html`<bim-label>Loading…</bim-label>`;
    }
    return html`
      <bim-panel label="Project Info">
        <bim-panel-section label="Project" icon="solar:buildings-bold">
          <bim-label .value=${this._projectData.name}></bim-label>
        </bim-panel-section>
        <bim-panel-section label="Engine" icon="solar:cpu-bold">
          <bim-label>Components ready</bim-label>
        </bim-panel-section>
      </bim-panel>
    `;
  }
}

// ---- app wiring ----

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

  // Any element rendered inside top-app can consume the contexts above.
  info: () => html`<project-info-panel></project-info-panel>`,
};

app.base = "viewer";
app.layouts = {
  main: {
    label: "Main",
    icon: "solar:home-bold",
    template: `"info" 1fr / 22rem`,
  },
};
app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
