import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import type {
  MeasurementTool,
  MeasureMode,
  SnapKind,
} from "./measurement-tool";

/**
 * MEASUREMENT panel — a docked side-panel (a layout alongside
 * Explorer/Files/Graphics/Clipping) for length / area / angle measurements.
 *
 * Sections:
 *  - Measure — exclusive mode buttons (Off / Length / Area / Angle); pick one,
 *    then double-click surfaces in the viewport (Area: Enter to close).
 *  - Snapping — vertices / edges / faces toggles (precise picks).
 *  - Measurements — show/hide all, clear all, and a list of every measurement
 *    (type + value + units) with delete-per-row.
 *
 * Vanilla BUI, app chrome (native panel header, muted bands, 1px contrast-20
 * hairlines, #3C3C41 scrollbar, library toggle switches + buttons). Factory
 * returns the element WITHOUT self-mounting. (A simple row list is used for the
 * measurements, matching files-panel / clipper-panel, so each row can carry a
 * delete button.)
 */
const MODES: { mode: MeasureMode; label: string; icon: string }[] = [
  { mode: "none", label: "Off", icon: "mdi:cursor-default" },
  { mode: "length", label: "Length", icon: "mdi:ruler" },
  { mode: "area", label: "Area", icon: "mdi:vector-square" },
  { mode: "angle", label: "Angle", icon: "mdi:angle-acute" },
];

const SNAPS: { kind: SnapKind; label: string }[] = [
  { kind: "point", label: "Vertices" },
  { kind: "line", label: "Edges" },
  { kind: "face", label: "Faces" },
];

export const measurementPanel = (
  _components: OBC.Components,
  tool: MeasurementTool,
) => {
  const [panel, update] = BUI.Component.create<BUI.Panel, { tick: number }>(
    (state) => {
      const refresh = () => update({ tick: state.tick + 1 });

      const mode = tool.getMode();
      const rows = tool.rows();
      const snaps = tool.getSnaps();
      const visible = tool.isVisible();

      const modeButtons = MODES.map(
        (m) => BUI.html`
          <bim-button
            class="m-mode"
            label=${m.label}
            icon=${m.icon}
            ?active=${mode === m.mode}
            @click=${() => {
              tool.setMode(m.mode);
              refresh();
            }}
          ></bim-button>
        `,
      );

      const snapRows = SNAPS.map(
        (s) => BUI.html`
          <div class="m-row">
            <span class="m-k">${s.label}</span>
            <span class="m-v">
              <bim-checkbox class="m-toggle" toggle ?checked=${snaps[s.kind]}
                @change=${(e: Event) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tool.setSnap(s.kind, !!(e.target as any).checked);
                  refresh();
                }}></bim-checkbox>
            </span>
          </div>
        `,
      );

      const measurementRows =
        rows.length === 0
          ? BUI.html`<div class="m-empty">No measurements. Pick a mode above, then double-click surfaces.</div>`
          : rows.map(
              (r) => BUI.html`
                <div class="m-row">
                  <span class="m-k m-type">${r.type}</span>
                  <span class="m-v">
                    <span class="m-val">${r.text}</span>
                    <bim-button class="m-del" icon="mdi:trash-can-outline"
                      @click=${() => {
                        r.remove();
                        refresh();
                      }}></bim-button>
                  </span>
                </div>
              `,
            );

      return BUI.html`
        <bim-panel label="Measure" icon="mdi:ruler"
          style="width: 100%; height: 100%; pointer-events: auto;">
          <style>
            .m-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .m-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .m-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }

            .m-band { box-sizing: border-box; padding: 0.4rem 0.4rem 0.4rem 1.1rem;
              display: flex; align-items: center; gap: 0.4rem;
              font-size: 0.76rem; font-weight: 500; letter-spacing: 0.01em;
              color: var(--bim-ui_bg-contrast-70, #a7a7ab);
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-top: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .m-band-ico { flex: 0 0 auto; font-size: 0.9rem; color: var(--bim-ui_bg-contrast-70, #a7a7ab); }
            .m-band:first-child { border-top: none; }

            .m-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem;
              padding: 0.5rem 0.4rem 0.5rem 1.1rem; }
            .m-modes bim-button { width: 100%; }

            .m-row { box-sizing: border-box; min-height: 32px; display: flex;
              align-items: center; justify-content: space-between; gap: 0.6rem;
              padding: 0.35rem 0.4rem 0.35rem 1.1rem; font-size: 0.78rem;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .m-k { opacity: 0.6; flex: 0 1 auto; min-width: 0; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
            .m-type { opacity: 0.85; }
            .m-v { flex: 1 1 auto; min-width: 0; display: flex; align-items: center;
              justify-content: flex-end; gap: 0.5rem; }
            .m-val { font-variant-numeric: tabular-nums; }
            .m-row bim-checkbox.m-toggle { flex: 0 0 2rem; width: 2rem; }
            .m-row bim-button.m-del { flex: 0 0 auto; --bim-button--bgc: transparent; }

            .m-empty { padding: 0.6rem 0.4rem 0.6rem 1.1rem; opacity: 0.6;
              font-size: 0.78rem; line-height: 1.3; white-space: normal; }

            .m-actions { display: flex; flex-direction: column; gap: 0.4rem;
              padding: 0.5rem 0.4rem 0.5rem 1.1rem; }
            .m-actions bim-button { width: 100%; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0 0.4rem 0.4rem 1.1rem;">
              <div class="m-vp" style="flex: 1 1 auto; min-height: 0; overflow-y: auto;
                margin-left: -1.1rem; margin-right: -0.4rem;">

                <div class="m-modes">${modeButtons}</div>

                <div class="m-band"><bim-icon class="m-band-ico" icon="mdi:magnet"></bim-icon>Snapping</div>
                ${snapRows}

                <div class="m-band"><bim-icon class="m-band-ico" icon="mdi:format-list-bulleted"></bim-icon>Measurements</div>
                <div class="m-row">
                  <span class="m-k">Show all</span>
                  <span class="m-v">
                    <bim-checkbox class="m-toggle" toggle ?checked=${visible}
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setVisible(!!(e.target as any).checked);
                        refresh();
                      }}></bim-checkbox>
                  </span>
                </div>
                <div class="m-actions">
                  <bim-button label="Clear all" icon="mdi:trash-can-outline" ?disabled=${rows.length === 0}
                    @click=${() => {
                      tool.clearAll();
                      refresh();
                    }}></bim-button>
                </div>
                ${measurementRows}
              </div>
            </div>
          </div>
        </bim-panel>
      `;
    },
    { tick: 0 },
  );

  tool.onChanged.add(() => update({ tick: 0 }));
  tool.onModeChanged.add(() => update({ tick: 0 }));

  return panel;
};
