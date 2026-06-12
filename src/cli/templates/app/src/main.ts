import { html } from "lit";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { PlatformClient, UIManager } from "@thatopen/services";
import { initFragments } from "./setups/fragments";
import { initIfcLoader } from "./setups/ifc-loader";
import "./ui-components";

async function main() {
  const client = PlatformClient.fromPlatformContext();

  const { components } = await client.setup(
    { OBC, OBF, BUI, THREE, FRAGS },
    { uuid: UIManager.uuid },
  ) as { components: OBC.Components };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (components.get(UIManager as any) as any).init();

  const app = document.createElement("top-app") as any;

  app.setup = (waitUntil: (promise: Promise<unknown>, label: string) => void) => {
    waitUntil(initFragments(components), "Fragments Core");
    waitUntil(initIfcLoader(components), "IFC Loader");
    return { components, client };
  };

  app.elements = {
    viewer: () => html`<top-viewer><top-viewer-tools></top-viewer-tools></top-viewer>`,
    panel: () => html`<app-panel></app-panel>`,
  };

  app.layouts = {
    main: {
      label: "Main",
      icon: "solar:home-bold",
      template: `"panel" 1fr / 22rem`,
    },
  };

  app.base = "viewer";
  app.layout = "main";

  app.addEventListener("thatopen:app-ready", () => {
    app.showToast("App ready", "success");
  });

  const container = document.getElementById("that-open-app") ?? document.body;
  container.appendChild(app);
  document.body.style.margin = "0";
}

main().catch(console.error);
