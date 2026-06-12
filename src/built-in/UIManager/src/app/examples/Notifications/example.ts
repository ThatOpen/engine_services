/* MD
  ## Toasts, file drop, and cross-component notifications
  ---
  Developers building BIM processing UIs need to surface status updates, errors,
  and file-drop feedback to users from different points in the component tree —
  but reaching back to the app root to trigger a notification from a deeply nested
  component requires threading a reference through every layer in between.

  top-app provides a built-in toast system that any descendant can trigger by
  dispatching a standard DOM event, a drag-and-drop overlay that activates
  automatically when files enter the window, and a drop-zone message that can be
  computed from live state at render time rather than set once at initialization.

  This tutorial covers showing a success toast when the app finishes booting;
  building a component that dispatches notification events to report async progress
  and completion without a reference to the root; handling dropped files, filtering
  them by extension, and showing a warning when none are supported; and setting the
  drop-zone message as a function that reads a live model counter.

  By the end, you'll have an app with a full notification layer — a boot
  confirmation toast, async status reporting from a child component, and a
  drag-and-drop zone whose message updates as models are loaded.
*/

import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient } from "thatopen-services";
import uiManagerDef from "../../../../index";
import type { App, AppReadyEvent } from "../../index";

// A child component that dispatches top:notification to surface messages
// to the nearest top-app ancestor — no reference to the app element needed.
@customElement("status-reporter")
class StatusReporter extends LitElement {
  @state() private _busy = false;

  private _simulateWork() {
    this._busy = true;

    // Dispatching top:notification from any descendant of top-app shows a toast.
    // bubbles:true + composed:true lets it cross shadow-DOM boundaries.
    this.dispatchEvent(
      new CustomEvent("top:notification", {
        bubbles: true,
        composed: true,
        detail: { message: "Analysis started", type: "info" },
      }),
    );

    setTimeout(() => {
      this._busy = false;
      this.dispatchEvent(
        new CustomEvent("top:notification", {
          bubbles: true,
          composed: true,
          detail: {
            message: "Analysis complete",
            type: "success",
            description: "Found 342 elements across 5 categories.",
          },
        }),
      );
    }, 2000);
  }

  render() {
    return html`
      <bim-panel label="Reporter">
        <bim-panel-section label="Actions" icon="solar:play-bold">
          <bim-button
            label="Run Analysis"
            icon="solar:play-bold"
            .loading=${this._busy}
            @click=${this._simulateWork}
          ></bim-button>
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
  panel: () => html`<status-reporter></status-reporter>`,
};

app.base = "viewer";
app.layouts = {
  main: {
    label: "Main",
    icon: "solar:home-bold",
    template: `"panel" 1fr / 22rem`,
  },
};
app.layout = "main";

// dropMessage as a function is called at render time so it can read live state.
// Here it reads how many models are already loaded and adjusts the hint text.
let loadedCount = 0;
app.dropMessage = () =>
  loadedCount === 0
    ? "Drop an IFC or FRAG file to load your first model"
    : `Drop a file to add to the ${loadedCount} loaded model${loadedCount === 1 ? "" : "s"}`;

// top:files-dropped fires when the user drops files onto the window.
// e.detail.files is a File[]. Handle upload, load, or validation here.
app.addEventListener("top:files-dropped", (e) => {
  const { files } = (e as CustomEvent<{ files: File[] }>).detail;
  const supported = files.filter((f) =>
    f.name.endsWith(".ifc") || f.name.endsWith(".frag"),
  );
  if (!supported.length) {
    app.showToast("No supported files dropped", "warning");
    return;
  }
  app.showToast(`Loading ${supported.length} file${supported.length === 1 ? "" : "s"}…`, "info");
  loadedCount += supported.length;
});

// thatopen:app-ready fires after all waitUntil promises resolve.
// e.detail.app is a reference to the top-app element itself.
app.addEventListener("thatopen:app-ready", (e) => {
  const { app: readyApp } = (e as AppReadyEvent).detail;
  readyApp.showToast("App ready", "success");
});

const container = document.getElementById("that-open-app") ?? document.body;
container.appendChild(app);
document.body.style.margin = "0";
