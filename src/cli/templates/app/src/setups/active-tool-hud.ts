import * as OBC from "@thatopen/components";
import { toolModeManager, type ManagedTool } from "./tool-mode-manager";

/**
 * Active-tool HUD — a floating text overlay (top-left of the viewport) showing
 * what the user is currently doing, e.g. "Drawing clipping plane" /
 * "Measuring length".
 *
 * Fully DECOUPLED from any specific tool: it only subscribes to the global
 * toolModeManager's `onActiveChanged` and renders the active tool's registered
 * {@link ManagedTool.label} (+ optional icon), hidden when no tool is active. Any
 * future tool that registers a label with the manager shows up here with zero
 * HUD changes.
 *
 * Styled like the other in-viewer overlays (fps counter): panel surface + 1px
 * contrast-20 border + theme text, pointer-events off.
 */
export interface ActiveToolHud {
  element: HTMLElement;
}

export const activeToolHud = (
  parent: HTMLElement,
  components: OBC.Components,
): ActiveToolHud => {
  const manager = toolModeManager(components);

  const el = document.createElement("div");
  el.style.cssText = `
    position: absolute; top: 0.6rem; left: 0.6rem; z-index: 10;
    display: none; align-items: center; gap: 0.4rem;
    padding: 0.25rem 0.6rem; border-radius: 0.5rem;
    background: var(--bim-ui_bg-contrast-10, #262629);
    border: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
    color: var(--bim-ui_bg-contrast-100, #e3e3e3);
    font: 600 0.74rem/1.2 "Plus Jakarta Sans", sans-serif;
    pointer-events: none; user-select: none;
  `;
  const icon = document.createElement("bim-icon");
  icon.style.fontSize = "0.95rem";
  const text = document.createElement("span");
  el.append(icon, text);

  // The viewer is position:relative, so an absolutely-positioned child overlays
  // the canvas correctly.
  if (!parent.style.position) parent.style.position = "relative";
  parent.append(el);

  const render = (tool: ManagedTool | null) => {
    if (!tool) {
      el.style.display = "none";
      return;
    }
    text.textContent =
      typeof tool.label === "function" ? tool.label() : tool.label;
    if (tool.icon) {
      icon.setAttribute("icon", tool.icon);
      icon.style.display = "";
    } else {
      icon.style.display = "none";
    }
    el.style.display = "flex";
  };

  manager.onActiveChanged.add(render);
  render(manager.active);

  return { element: el };
};
