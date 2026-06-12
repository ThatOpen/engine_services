/* MD
  ## Shared reactive state with AppState
  ---
  Developers building interactive BIM panels often need sibling components — a
  filter selector and a results table, for example — to stay in sync without a
  shared parent. Lifting state to a common ancestor and threading it down as props
  works for shallow trees but becomes unwieldy as the component tree grows.

  top-app provides a typed reactive state object available to every component in
  the tree through context. Any component can write to it, and all subscribers
  re-render automatically — no shared parent required.

  This tutorial covers defining a typed payload for custom app state; building a
  filter selector that updates shared state on button click; building a results
  counter that reads the current filter and count from shared state; composing both
  into a panel inside a top-app layout; and noting when the shared state is
  available relative to the engine boot sequence.

  By the end, you'll have two independent components that stay in sync through
  shared reactive state — a filter selector and a results counter that reflect each
  other's changes without any direct coupling between them.
*/

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { consume } from "@lit/context";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "thatopen-services";
import uiManagerDef from "../../../../index";
import {
  appStateContext,
  AppState,
  AppStateController,
  type App,
} from "../../index";

// Define a typed payload for this app's custom state.
type MyAppState = { selectedFilter: string; count: number };

// AppStateController subscribes to appStateContext and triggers a re-render
// on every setCustom call — across any component in the tree that holds one.
@customElement("filter-selector")
class FilterSelector extends LitElement {
  @consume({ context: appStateContext, subscribe: true })
  @state()
  private _appState?: AppState;

  // Declare the controller — the LitElement lifecycle handles subscription.
  private _stateCtrl = new AppStateController<MyAppState>(this, () => this._appState);

  render() {
    const filters = ["All", "Walls", "Slabs", "Columns"];
    const active = this._stateCtrl.custom?.selectedFilter ?? "All";
    return html`
      <bim-panel-section label="Filter" icon="solar:filter-bold">
        ${filters.map(
          (f) => html`
            <bim-button
              .label=${f}
              ?active=${active === f}
              @click=${() => {
                this._appState?.setCustom<MyAppState>({ selectedFilter: f, count: 0 });
              }}
            ></bim-button>
          `,
        )}
      </bim-panel-section>
    `;
  }
}

@customElement("result-counter")
class ResultCounter extends LitElement {
  @consume({ context: appStateContext, subscribe: true })
  @state()
  private _appState?: AppState;

  private _stateCtrl = new AppStateController<MyAppState>(this, () => this._appState);

  render() {
    const { selectedFilter = "All", count = 0 } = this._stateCtrl.custom ?? {};
    return html`
      <bim-panel-section label="Results" icon="solar:list-bold">
        <bim-label>${count} elements match "${selectedFilter}"</bim-label>
      </bim-panel-section>
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

// appState is available immediately — before setup completes — so components
// that only consume appStateContext can render while the engine is still booting.
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
  panel: () => html`
    <bim-panel label="State Demo">
      <filter-selector></filter-selector>
      <result-counter></result-counter>
    </bim-panel>
  `,
};

app.layouts = {
  main: {
    label: "Main",
    icon: "solar:home-bold",
    template: `"panel" 1fr / 22rem`,
  },
};
app.layout = "main";

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
