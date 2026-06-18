import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import type { ClipperTool } from "./clipper-tool";

/**
 * CLIPPING panel — a docked side-panel (a 4th layout alongside
 * Explorer/Files/Graphics) for section planes + per-category section styling.
 *
 * Sections:
 *  - Section planes — master Enabled, Add plane (placing mode: double-click a
 *    surface), Clear all.
 *  - Active planes — one row per plane (per-plane enable + delete).
 *  - Section styling — master fills/edges visibility + a per-IFC-category list,
 *    each with a fill colour, an edge colour, and an include toggle.
 *
 * Vanilla BUI, matching graphics-panel.ts / files-panel.ts: `bim-panel` (native
 * header label+icon), muted section bands, 1px contrast-20 hairline rows, the
 * #3C3C41 scrollbar, library `bim-checkbox[toggle]` switches, `bim-button`s and
 * `bim-color-input`s. Factory returns the element WITHOUT self-mounting.
 */
export const clipperPanel = (
  _components: OBC.Components,
  tool: ClipperTool,
) => {
  const [panel, update] = BUI.Component.create<BUI.Panel, { tick: number }>(
    (state) => {
      const refresh = () => update({ tick: state.tick + 1 });

      const enabled = tool.isEnabled();
      const sectionStyle = tool.getSectionStyle();
      const stylingVisible = tool.isStylingVisible();

      return BUI.html`
        <bim-panel label="Clipping" icon="mdi:scissors-cutting"
          style="width: 100%; height: 100%; pointer-events: auto;">
          <style>
            .c-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .c-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .c-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }

            .c-band { box-sizing: border-box; padding: 0.4rem 0.4rem 0.4rem 1.1rem;
              display: flex; align-items: center; gap: 0.4rem;
              font-size: 0.76rem; font-weight: 500; letter-spacing: 0.01em;
              color: var(--bim-ui_bg-contrast-70, #a7a7ab);
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-top: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .c-band-ico { flex: 0 0 auto; font-size: 0.9rem; color: var(--bim-ui_bg-contrast-70, #a7a7ab); }
            .c-band:first-child { border-top: none; }

            .c-row { box-sizing: border-box; min-height: 32px; display: flex;
              align-items: center; justify-content: space-between; gap: 0.6rem;
              padding: 0.35rem 0.4rem 0.35rem 1.1rem; font-size: 0.78rem;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .c-k { opacity: 0.6; flex: 0 1 auto; min-width: 0; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
            .c-v { flex: 1 1 auto; min-width: 0; display: flex; align-items: center;
              justify-content: flex-end; gap: 0.5rem; }
            .c-row bim-checkbox.c-toggle, .c-cat bim-checkbox.c-toggle { flex: 0 0 2rem; width: 2rem; }
            .c-row bim-button.c-del { flex: 0 0 auto; --bim-button--bgc: transparent; }

            .c-empty { padding: 0.6rem 0.4rem 0.6rem 1.1rem; opacity: 0.6;
              font-size: 0.78rem; line-height: 1.3; white-space: normal; }

            .c-actions { display: flex; flex-direction: column; gap: 0.4rem;
              padding: 0.5rem 0.4rem 0.5rem 1.1rem; }
            .c-actions bim-button { width: 100%; }

            /* Per-category style row: [toggle] [name grows] [fill][edge swatches] */
            .c-cat { box-sizing: border-box; min-height: 32px; display: flex;
              align-items: center; gap: 0.5rem;
              padding: 0.3rem 0.4rem 0.3rem 1.1rem; font-size: 0.78rem;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .c-cat-name { flex: 1 1 auto; min-width: 0; opacity: 0.85;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .c-cat-colors { flex: 0 0 auto; display: flex; align-items: center; gap: 0.35rem; }
            .c-cat-colors bim-color-input { flex: 0 0 auto; }
            .c-cat-off { opacity: 0.45; }
            .c-cat-off .c-cat-colors { pointer-events: none; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0 0.4rem 0.4rem 1.1rem;">
              <div class="c-vp" style="flex: 1 1 auto; min-height: 0; overflow-y: auto;
                margin-left: -1.1rem; margin-right: -0.4rem;">

                <div class="c-row">
                  <span class="c-k">Enabled</span>
                  <span class="c-v">
                    <bim-checkbox class="c-toggle" toggle ?checked=${enabled}
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setEnabled(!!(e.target as any).checked);
                        refresh();
                      }}></bim-checkbox>
                  </span>
                </div>
                <div class="c-row">
                  <span class="c-k">Show fills / edges</span>
                  <span class="c-v">
                    <bim-checkbox class="c-toggle" toggle ?checked=${stylingVisible}
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setStylingVisible(!!(e.target as any).checked);
                        refresh();
                      }}></bim-checkbox>
                  </span>
                </div>
                <div class="c-row">
                  <span class="c-k">Fill color</span>
                  <span class="c-v">
                    <bim-color-input color=${sectionStyle.fill}
                      @input=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const t = e.target as any;
                        tool.setSectionFill(String(t.color ?? t.value));
                      }}></bim-color-input>
                  </span>
                </div>
                <div class="c-row">
                  <span class="c-k">Edge color</span>
                  <span class="c-v">
                    <bim-color-input color=${sectionStyle.line}
                      @input=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const t = e.target as any;
                        tool.setSectionLine(String(t.color ?? t.value));
                      }}></bim-color-input>
                  </span>
                </div>
                <div class="c-row">
                  <span class="c-k">Fill opacity</span>
                  <span class="c-v">
                    <bim-number-input slider value=${sectionStyle.opacity}
                      min="0" max="1" step="0.05"
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setSectionOpacity(Number((e.target as any).value));
                      }}></bim-number-input>
                  </span>
                </div>
                <div class="c-row">
                  <span class="c-k">Edge width</span>
                  <span class="c-v">
                    <bim-number-input slider value=${sectionStyle.width}
                      min="1" max="20" step="1"
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setSectionWidth(Number((e.target as any).value));
                      }}></bim-number-input>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </bim-panel>
      `;
    },
    { tick: 0 },
  );

  tool.onChanged.add(() => update({ tick: 0 }));
  tool.onStyleChanged.add(() => update({ tick: 0 }));

  return panel;
};
