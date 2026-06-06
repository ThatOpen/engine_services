import * as THREE from "three";
import * as OBC from "@thatopen-platform/components-beta";
import * as OBF from "@thatopen-platform/components-front-beta";
import * as FRAGS from "@thatopen-platform/fragments-beta";
import * as BUI from "@thatopen/ui";
import * as MARKERJS from "@markerjs/markerjs3"
import {
  PlatformClient,
  AppManager,
  ViewportsManager,
  UIManager,
} from "@thatopen/services";

import { getAppManager } from "./app";
import { uiManager, cloudRunner, viewportsManager, getUIManager } from "./setups";

// Wrap in async function since IIFE format does not support top-level await.
async function main() {
  // ─── Platform Client ──────────────────────────────────────────
  // Reads auth context from window.__THATOPEN_CONTEXT__ (injected by the
  // platform) and creates a client with Bearer auth.
  const client = PlatformClient.fromPlatformContext();

  // ─── Built-in Components ──────────────────────────────────────
  // First argument: library globals used by the engine.
  // Subsequent arguments: platform built-in components to initialise.
  const { components } = await client.setup<OBC.Components>(
    { OBC, OBF, BUI, THREE, FRAGS, MARKERJS },
    { uuid: ViewportsManager.uuid },
    { uuid: AppManager.uuid },
    { uuid: UIManager.uuid },
  );

  // ─── Viewport ─────────────────────────────────────────────────
  // Must run before app.init() so the element is ready for the grid.
  const viewerElement = await viewportsManager(components);

  // ─── App Init ─────────────────────────────────────────────────
  const app = getAppManager(components);

  await app.init({
    client,
    icons: [],
    componentSetups: {
      // core: runs in parallel before the grid mounts.
      core: [uiManager, cloudRunner],
    },
    grid: (grid) => {
      const uis = getUIManager(components);

      grid.elements = {
        viewer: viewerElement,
        appInfoSection: {
          template: uis.custom.get("appInfoSection").template,
          initialState: { components },
          label: "App Info",
          icon: "solar:info-circle-bold",
        },
        cloudRunnerSection: {
          template: uis.custom.get("cloudRunnerSection").template,
          initialState: { components },
          label: "Cloud Component",
          icon: "solar:code-bold",
        },
      };

      grid.layouts = {
        Viewer: {
          template: `"viewer" 1fr / 1fr`,
        },
        Split: {
          template: `
            "tabs:left(appInfoSection, cloudRunnerSection) viewer" 1fr
            / 24rem 1fr
          `,
          icon: "solar:info-circle-bold",
        },
      };

      grid.areaGroups = {
        left: { switchersFull: true },
      };

      grid.layout = "Split";
    },
  });
}

main().catch(console.error);
