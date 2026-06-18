import * as BUI from "@thatopen/ui";
import type { MeasurementTool } from "./measurement-tool";

/**
 * MEASUREMENT settings section for the merged Settings layout (UI-reorg). Color,
 * per-type units, rounding, snap toggles, and global visibility — all driven by
 * W1's measurementTool settings API (getMeasurementSettings + setters), re-read
 * on `onChanged`. (Line thickness lands later with the LineSegments2 conversion.)
 * Returns its `bim-panel` WITHOUT self-mounting.
 *
 * @param tool the measurement tool (worker 1)
 * @returns the `bim-panel` element
 */
export const measurementSettingsPanel = (tool: MeasurementTool) => {
  const dropdown = (
    opts: string[],
    selected: string,
    onPick: (v: string) => void,
  ) => BUI.html`
    <bim-dropdown
      style="flex: 1 1 auto; min-width: 0;"
      @change=${(e: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (e.target as any).value?.[0];
        if (v != null) onPick(String(v));
      }}
    >
      ${opts.map((o) => BUI.html`<bim-option .value=${o} label=${o} ?checked=${o === selected}></bim-option>`)}
    </bim-dropdown>`;

  const [panel, update] = BUI.Component.create<BUI.Panel, { tick: number }>(
    // NOTE: the callback MUST take a state param (arity >= 1) — an arity-0
    // callback makes Component.create return a single element instead of
    // [el, update], and the destructure throws "object is not iterable".
    (_s) => {
      // Fail-safe: a settings sub-panel must NEVER crash main(). If the tool's
      // settings API is unavailable/throws, render a placeholder instead.
      let s: ReturnType<MeasurementTool["getMeasurementSettings"]> | null = null;
      try {
        s = tool.getMeasurementSettings?.() ?? null;
      } catch (error) {
        console.warn("[measurement-settings] getMeasurementSettings failed", error);
      }
      if (!s || !s.unitOptions || !s.units || !s.snaps) {
        return BUI.html`
          <bim-panel label="Measurement" icon="mdi:ruler" style="width: 100%; height: 100%; pointer-events: auto;">
            <div style="padding: 0.9rem 1.1rem; font-size: 0.78rem; color: var(--bim-ui_bg-contrast-70, #a7a7ab);">
              Measurement settings unavailable.
            </div>
          </bim-panel>`;
      }
      const unitRow = (label: string, type: "length" | "area" | "angle") => BUI.html`
        <div class="ms-row">
          <span class="ms-lbl">${label}</span>
          ${dropdown(s.unitOptions[type], s.units[type], (v) => tool.setUnits(type, v))}
        </div>`;
      return BUI.html`
        <bim-panel
          label="Measurement"
          icon="mdi:ruler"
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .ms-body { display: flex; flex-direction: column; gap: 0.45rem;
              padding: 0.6rem 0.75rem; overflow-y: auto; height: 100%; }
            .ms-row { display: flex; align-items: center; gap: 0.5rem; }
            .ms-toggle { cursor: pointer; justify-content: space-between; }
            .ms-lbl { font-size: 0.72rem; white-space: nowrap; flex: 0 0 5.5rem;
              color: var(--bim-ui_bg-contrast-80, #c9c9c9); }
            .ms-snaps { display: flex; gap: 0.9rem; flex-wrap: wrap; }
            .ms-snap { display: inline-flex; align-items: center; gap: 0.3rem;
              cursor: pointer; font-size: 0.72rem;
              color: var(--bim-ui_bg-contrast-80, #c9c9c9); }
          </style>
          <div class="ms-body">
            <div class="ms-row">
              <span class="ms-lbl">Color</span>
              <bim-color-input
                color=${s.color}
                @input=${(e: Event) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const t = e.target as any;
                  tool.setColor(String(t.color ?? t.value));
                }}
              ></bim-color-input>
            </div>
            ${unitRow("Length", "length")}
            ${unitRow("Area", "area")}
            ${unitRow("Angle", "angle")}
            <div class="ms-row">
              <span class="ms-lbl">Decimals</span>
              <bim-number-input
                slider
                value=${s.rounding}
                min="0"
                max="6"
                step="1"
                style="flex: 1 1 auto;"
                @change=${(e: Event) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tool.setRounding(Number((e.target as any).value));
                }}
              ></bim-number-input>
            </div>
            ${
              typeof s.thickness === "number" && typeof tool.setThickness === "function"
                ? BUI.html`
                  <div class="ms-row">
                    <span class="ms-lbl">Thickness</span>
                    <bim-number-input
                      slider
                      value=${s.thickness}
                      min="1"
                      max="10"
                      step="1"
                      style="flex: 1 1 auto;"
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setThickness(Number((e.target as any).value));
                      }}
                    ></bim-number-input>
                  </div>`
                : BUI.html``
            }
            <div class="ms-row">
              <span class="ms-lbl">Snap</span>
              <div class="ms-snaps">
                ${Object.keys(s.snaps).map(
                  (kind) => BUI.html`<label class="ms-snap">
                    <bim-checkbox
                      toggle
                      ?checked=${s.snaps[kind as keyof typeof s.snaps]}
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool.setSnap(kind as never, !!(e.target as any).checked);
                      }}
                    ></bim-checkbox>${kind}
                  </label>`,
                )}
              </div>
            </div>
            <label class="ms-row ms-toggle">
              <span class="ms-lbl">Show measurements</span>
              <bim-checkbox
                toggle
                ?checked=${s.visible}
                @change=${(e: Event) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  tool.setVisible(!!(e.target as any).checked);
                }}
              ></bim-checkbox>
            </label>
          </div>
        </bim-panel>`;
    },
    { tick: 0 },
  );

  tool.onChanged.add(() => update({ tick: 0 }));
  return panel;
};
