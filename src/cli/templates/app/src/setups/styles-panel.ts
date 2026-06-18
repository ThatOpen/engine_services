import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { styles, StyleSetting } from "./styles";

/**
 * UI side of the Styles tool. Consumes Worker 1's style DESCRIPTOR
 * (`styles(components, world).settings`) and renders it generically in the
 * bottom-left helper panel: checkbox (bool), slider (number), color picker
 * (color), dropdown (enum) — each wired live to the setting's get/set. Settings
 * are grouped by their `group` field.
 *
 * Returned as a "panel tool" `{ label, icon, render }` for the toolbar; `render`
 * receives a `refresh` callback to re-read all controls after a change (needed
 * because e.g. the preset enum rewrites several other settings).
 */
const control = (s: StyleSetting, refresh: () => void) => {
  switch (s.type) {
    case "bool":
      return BUI.html`<bim-checkbox
        label=${s.label}
        ?checked=${s.get()}
        @change=${(e: Event) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          s.set(!!(e.target as any).value);
          refresh();
        }}
      ></bim-checkbox>`;
    case "number":
      return BUI.html`<bim-number-input
        label=${s.label}
        slider
        value=${s.get()}
        min=${s.min}
        max=${s.max}
        step=${s.step}
        @change=${(e: Event) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          s.set(Number((e.target as any).value));
          refresh();
        }}
      ></bim-number-input>`;
    case "color":
      return BUI.html`<bim-color-input
        label=${s.label}
        color=${s.get()}
        @input=${(e: Event) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = e.target as any;
          s.set(String(t.color ?? t.value));
          refresh();
        }}
      ></bim-color-input>`;
    case "enum":
      return BUI.html`<bim-dropdown
        label=${s.label}
        @change=${(e: Event) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const picked = (e.target as any).value?.[0];
          const match = s.options.find((o) => o.label === picked);
          if (match) {
            s.set(match.value);
            refresh();
          }
        }}
      >
        ${s.options.map(
          (o) => BUI.html`<bim-option label=${o.label} ?checked=${o.value === s.get()}></bim-option>`,
        )}
      </bim-dropdown>`;
  }
};

export const stylesTool = (components: OBC.Components, world: OBC.World) => ({
  label: "Styles",
  icon: "mdi:palette",
  render: (refresh: () => void) => {
    const { settings } = styles(components, world);
    // Group settings by their `group` field, preserving first-seen order.
    const groups: { name: string; items: StyleSetting[] }[] = [];
    for (const s of settings) {
      let g = groups.find((x) => x.name === s.group);
      if (!g) {
        g = { name: s.group, items: [] };
        groups.push(g);
      }
      g.items.push(s);
    }
    return BUI.html`
      <div style="display: flex; flex-direction: column; gap: 0.6rem;">
        ${groups.map(
          (g) => BUI.html`
            <div>
              <div style="
                font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em;
                text-transform: uppercase; opacity: 0.6;
                color: var(--bim-ui_bg-contrast-100, #e3e3e3);
                padding: 0.1rem 0 0.3rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              ">${g.name}</div>
              <div style="display: flex; flex-direction: column; padding-top: 0.25rem;">
                ${g.items.map(
                  (s) => BUI.html`<div style="padding: 0.3rem 0; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255, 255, 255, 0.1));">${control(s, refresh)}</div>`,
                )}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  },
});
