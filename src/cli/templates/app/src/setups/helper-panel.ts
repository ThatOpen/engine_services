import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";
import { toolPlaceholderUri } from "../assets/tool-placeholder";

/**
 * A contextual helper card — ALWAYS present in the left stack (see left-sidebar).
 * It renders the options of whichever panel-tool is active (e.g. Styles); when
 * no tool is active it shows an empty-state illustration + hint. Mirrors the
 * standardized card chrome: dark `bg-base`, `cardHeader` (with divider) fixed,
 * inset `.helper-scroll` `overflow-y:auto` (same scrollbar as the others).
 *
 * Returns the panel ELEMENT (mounted by the left stack) plus a controller:
 *   show({ title, icon, render }) — show a tool's content (+ retitle the header)
 *   clear()                       — revert to the empty state
 *   refresh()                     — re-run the current `render`
 */
export interface HelperContent {
  title: string;
  icon: string;
  render: () => unknown;
}

export interface HelperPanelController {
  element: HTMLElement;
  show(content: HelperContent): void;
  clear(): void;
  refresh(): void;
}

const DEFAULT = { title: "Tools", icon: "mdi:tune" };

const emptyState = () => BUI.html`
  <div style="
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 0.75rem; height: 100%; min-height: 12rem; padding: 1rem; text-align: center;
  ">
    <img src=${toolPlaceholderUri} alt="" style="width: 7.5rem; height: auto; opacity: 0.9;" />
    <bim-label style="opacity: 0.55; white-space: normal;">Select a tool to see it here.</bim-label>
  </div>
`;

export const helperPanel = (): HelperPanelController => {
  let renderContent: (() => unknown) | null = null;

  const [panel, update] = BUI.Component.create<BUI.Panel, { title: string; icon: string }>(
    (state) => BUI.html`
      <bim-panel
        label=${state.title}
        icon=${state.icon}
        style="width: 100%; height: 100%; pointer-events: auto;"
      >
        <style>
          .helper-scroll::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
          .helper-scroll::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
          .helper-scroll::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }
        </style>
        <div style="display: flex; flex-direction: column; height: 100%;">
          <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0.4rem 0.4rem 0.4rem 1.1rem;">
            <!-- Scroll container: scrollbar sits inset from the card (left
                 wrapper pad). Inner content has right padding so it clears the
                 scrollbar (gap on both sides), mirroring the tree. -->
            <div class="helper-scroll" style="flex: 1 1 auto; min-height: 0; overflow-y: auto;">
              <div style="padding-right: 0.6rem;">
                ${renderContent ? renderContent() : emptyState()}
              </div>
            </div>
          </div>
        </div>
      </bim-panel>
    `,
    { ...DEFAULT },
  );

  return {
    element: panel,
    show({ title, icon, render }) {
      renderContent = render;
      update({ title, icon });
    },
    clear() {
      renderContent = null;
      update({ ...DEFAULT });
    },
    refresh() {
      update({}); // re-runs the template → re-calls renderContent()
    },
  };
};
