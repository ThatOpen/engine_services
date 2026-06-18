import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";

/**
 * Merged SETTINGS panel (UI-reorg) — ONE scrolling bim-panel with a collapsible
 * section per source panel (Graphics / Clip styling / Measurement / Commands).
 * Reuses each panel's existing element verbatim.
 *
 * Sections use a hand-rolled light-DOM header (NOT bim-panel-section, whose
 * header/content padding is hardcoded in shadow DOM and can't be flattened) so
 * the section title row + its divider span the FULL panel width with no inset,
 * and the section content sits flush. The nested bim-panel's own chrome is
 * removed (transparent bg / no border / no radius) and its height:100% / inner
 * scroll neutralised so it flows and the Settings panel does the single scroll —
 * all scoped to light-DOM descendants, so bim-* widget shadow internals (sliders,
 * dropdowns, color inputs) are untouched. Returns the `bim-panel` (no self-mount).
 *
 * @param sections ordered settings sections (label + icon + the panel element)
 * @returns the merged Settings `bim-panel`
 */
export const settingsPanel = (
  sections: { label: string; icon: string; el: HTMLElement }[],
) => {
  for (const s of sections) {
    s.el.setAttribute("header-hidden", ""); // our section header replaces it
    s.el.style.height = "auto";
    s.el.style.width = "100%";
  }
  const collapsed = new Set<string>(); // section labels currently collapsed

  const [panel, update] = BUI.Component.create<BUI.Panel, { tick: number }>(
    (_s) => BUI.html`
      <bim-panel
        label="Settings"
        icon="mdi:cog"
        header-hidden
        style="width: 100%; height: 100%; pointer-events: auto;"
      >
        <style>
          .set-scroll { display: flex; flex-direction: column; height: 100%; overflow-y: auto; }
          .set-scroll::-webkit-scrollbar { width: 0.4rem; }
          .set-scroll::-webkit-scrollbar-thumb { border-radius: 0.25rem;
            background-color: var(--bim-scrollbar--c, #3C3C41); }
          /* Full-width section header: title row + divider span the whole panel,
             no side inset/box. */
          .set-hd { display: flex; align-items: center; gap: 0.5rem; cursor: pointer;
            margin-top: 1.2rem;
            padding: 0.45rem 0.75rem; font-weight: 600;
            font-size: var(--bim-ui_size-lg, 0.8125rem);
            color: var(--bim-ui_bg-contrast-100, #f1f2f4);
            /* contrast-40 (#323237) so the divider is VISIBLE on the #262629
               surface — contrast-20 now equals the surface (palette pin). */
            border-bottom: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.12)); }
          .set-hd:hover { background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.04)); }
          /* Section icon matches the title font color (not a dimmer grey). */
          .set-hd-ico { flex: 0 0 auto; color: inherit; }
          .set-hd-t { flex: 1 1 auto; }
          .set-hd-x { flex: 0 0 auto; color: var(--bim-ui_bg-contrast-80, #adadad); }
          /* Flatten the nested panel: no "panel inside a panel", content flush to
             the edges (its own bands full-bleed). Light-DOM only — widget shadow
             internals untouched. */
          .set-sec bim-panel {
            height: auto !important;
            width: 100%;
            --bim-panel--bg: transparent;
            --bim-panel--border: none;
            border-radius: 0 !important;
            box-shadow: none !important;
          }
          .set-sec bim-panel * { height: auto !important; max-height: none !important; }
        </style>
        <div class="set-scroll">
          ${cardHeader("mdi:cog", "Settings", "0.75rem")}
          ${sections.map((s, i) => {
            const open = !collapsed.has(s.label);
            return BUI.html`
              <div class="set-hd" style=${i === 0 ? "margin-top: 0;" : ""} @click=${() => {
                if (collapsed.has(s.label)) collapsed.delete(s.label);
                else collapsed.add(s.label);
                update({ tick: 0 });
              }}>
                <bim-icon class="set-hd-ico" icon=${s.icon}></bim-icon>
                <span class="set-hd-t">${s.label}</span>
                <bim-icon class="set-hd-x" icon=${open ? "mdi:chevron-up" : "mdi:chevron-down"}></bim-icon>
              </div>
              <div class="set-sec" style=${open ? "" : "display: none;"}>${s.el}</div>`;
          })}
        </div>
      </bim-panel>`,
    { tick: 0 },
  );

  return panel;
};
