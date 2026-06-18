import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";
import { styles, StyleSetting } from "./styles";
import type { FpsIndicator } from "./fps-indicator";

/**
 * GRAPHICS panel — a docked side-panel (third layout alongside Explorer/Files)
 * exposing the viewer's rendering/graphics settings.
 *
 * It REUSES the typed `styles(components, world)` DESCRIPTOR (the same one that
 * backs the bottom-left "Styles" helper tool) so every control here drives the
 * live postproduction pipeline directly — postproduction on/off & preset, edges
 * (contour), surface color / AO / tonal shading, scene background & grid, and
 * the quality block (FXAA, render scale, adaptive resolution, target FPS, the
 * half-res selection-outline toggle). No setting is invented; each maps 1:1 to
 * a wired pipeline feature. Mutating a control takes effect on the next frame.
 *
 * The generic `control()` renderer (switch/slider/color/dropdown wired to a
 * setting's get/set) mirrors styles-panel.ts so the two stay consistent.
 *
 * LAYOUT: to keep the panel dense, a feature's dependent controls are STACKED
 * onto a single shared row (see ROW_LAYOUT below) — e.g. "Edge color" + "Edge
 * strength" sit together, and a feature's toggle pairs with its one dependent
 * value ("Grid" + grid color, "Ambient occlusion" + AO strength, …). Booleans
 * render as a compact pill TOGGLE SWITCH (purple when on) instead of a checkbox.
 * Only the PRESENTATION changes here — every control still drives the exact same
 * StyleSetting get/set, so the pipeline wiring is untouched.
 *
 * Returns the panel ELEMENT WITHOUT self-mounting (like modelTree / filesPanel)
 * so main.ts can strip the card chrome and dock it into the grid.
 */

// ── Document-level theming for the dropdown POPUP ───────────────────────────
// The Style-preset `bim-dropdown` renders its open menu as a `bim-context-menu`
// that BUI MOVES OUT to a top-level `<dialog data-context-dialog>` appended to
// `document.body` while visible (see ContextMenu.set visible() in
// node_modules/@thatopen/ui/dist/index.js: `document.body.append(lt.dialog)` /
// `lt.dialog.append(this)`). Because the popup leaves this panel's shadow scope,
// the panel's <style> can't reach it — the popup falls back to BUI defaults
// (`--bim-ui_bg-contrast-50` surface, 1px shadow-radius) and looks out of place.
//
// So we theme it from the DOCUMENT instead, scoped to the context dialog, to
// match the app's other menus: dark panel surface, 1px contrast-40 border, a
// small radius + subtle shadow, compact ~0.78rem items, and the SELECTED option
// drawn with the app's purple accent (var(--bim-ui_accent-base)). `bim-option`'s shadow `:host`
// sets its own padding/radius (specificity 0,1,0), so where we must beat that we
// use the scoped dialog selector with `!important`; option BACKGROUND/hover/
// selected are unset by BUI so a plain rule suffices. The checked-label colour
// derives from `--bim-ui_main-base`, which we pin to the accent here too.
const APP_ACCENT = "var(--bim-ui_accent-base)";
const ensureDropdownPopupStyle = () => {
  const id = "graphics-dropdown-popup-style";
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = `
    /* The popup surface (the relocated bim-context-menu inside the dialog). */
    dialog[data-context-dialog] bim-context-menu {
      border: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.18)) !important;
      border-radius: 0.375rem !important;
      box-shadow: 0 6px 18px rgba(0,0,0,0.45) !important;
      padding: 0.25rem !important;
      min-width: 8rem;
    }
    /* Compact option rows; selected/hover backgrounds (BUI leaves these unset). */
    dialog[data-context-dialog] bim-option {
      font-size: 0.78rem;
      border-radius: 0.25rem !important;
      padding: 0.18rem 0.5rem !important;
    }
    dialog[data-context-dialog] bim-option:hover {
      background-color: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08));
    }
    /* SELECTED option: the app purple accent, consistently. */
    dialog[data-context-dialog] bim-option[checked] {
      background-color: ${APP_ACCENT};
    }
  `;
  document.head.append(el);
};

// ── Toggle SWITCH for a bool setting (library bim-checkbox[toggle]) ──────────
// The library checkbox has a built-in pill/switch mode (dark ball + outline,
// purple track when on) — so we use it directly instead of a hand-rolled widget,
// keeping the toggle styling in ONE place (the library) for the whole platform.
// It drives the SAME `StyleSetting.set(boolean)`, so behaviour is identical.
const boolSwitch = (s: StyleSetting & { type: "bool" }, refresh: () => void) => {
  const on = s.get();
  return BUI.html`<bim-checkbox
    class="g-toggle"
    toggle
    ?checked=${on}
    @change=${(e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.set(!!(e.target as any).checked);
      refresh();
    }}
  ></bim-checkbox>`;
};

// Generic control for one StyleSetting (same wiring styles-panel.ts uses).
//
// IMPORTANT: the label is rendered by the ROW (left cell, muted) so every
// control here is created WITHOUT its own `label` attribute — it renders as a
// bare, compact widget that sits in the row's right cell. Sizing/colour is
// driven entirely by the `.g-row` CSS (BUI control custom-props) below.
const control = (s: StyleSetting, refresh: () => void) => {
  switch (s.type) {
    case "bool":
      // Pill toggle switch (replaces the former bim-checkbox), same setter.
      return boolSwitch(s, refresh);
    case "number":
      return BUI.html`<bim-number-input
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

// A control sized for sharing a row with another control / a toggle. No inline
// mini-label: the row's left label gives context, and the widget itself is
// self-evident (a colour swatch, or a slider showing its value), so a mini-label
// just costs width and risks crowding the toggle. The `g-i-<type>` class drives
// the compact per-type width.
const inlineControl = (s: StyleSetting, refresh: () => void) =>
  BUI.html`<span class="g-inline g-i-${s.type}">${control(s, refresh)}</span>`;

export const graphicsPanel = (components: OBC.Components, fps?: FpsIndicator) => {
  // Theme the Style-preset dropdown's relocated popup (document-level, since it
  // escapes this panel's shadow to a top-level dialog). Idempotent.
  ensureDropdownPopupStyle();

  // The postproduction pipeline lives on the first world's renderer. It is
  // allocated lazily (once the viewport has a real size), so resolve the world
  // at render time — same pattern the model-tree uses.
  const getWorld = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([...components.get(OBC.Worlds).list.values()][0] as OBC.World) ?? null;

  // Has the deferred pipeline been configured yet? `styles()` reads
  // `renderer.postproduction.deferred`, which throws until the pipeline is up.
  const ready = (world: OBC.World | null) => {
    if (!world) return false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = world.renderer as any;
      return !!r?.postproduction?.deferred;
    } catch {
      return false;
    }
  };

  const [panel, update] = BUI.Component.create<BUI.Panel, { tick: number }>(
    (state) => {
      void state.tick; // bump to force a re-read of all controls

      const world = getWorld();
      let body: unknown;

      if (!ready(world)) {
        body = BUI.html`<div style="padding: 0.6rem 0.4rem 0.6rem 1.1rem;">
          <bim-label style="opacity: 0.6; white-space: normal; font-size: 0.78rem;">Rendering pipeline not ready yet. Load a model / wait for the viewer to initialize.</bim-label>
        </div>`;
      } else {
        const { settings } = styles(components, world!);
        const byKey = new Map(settings.map((s) => [s.key, s]));
        const refresh = () => update({ tick: state.tick + 1 });

        // ── Row layout plan ───────────────────────────────────────────────
        // Each section is a band header followed by a list of ROWS. A row is
        // either a single labelled control (the usual label-left / control-
        // right shape) or a PAIRED row that stacks a feature's dependent
        // controls together so the panel reads as a dense grid. Every key here
        // still resolves to its StyleSetting via `byKey`, so wiring is intact.
        type Row =
          // Standard "label on left, one control on right" row.
          | { kind: "single"; key: string; label?: string }
          // Toggle on the left (with the section's row label), its ONE
          // dependent value inline on the right of the same line.
          | { kind: "toggleWith"; toggle: string; label?: string; dep: string; depLabel: string; depAlwaysEnabled?: boolean }
          // Two dependent controls sharing a row under an obvious section,
          // each with a tight inline mini-label (no wide left label cell).
          | { kind: "pair"; label: string; a: string; aLabel: string; b: string; bLabel: string };

        const sections: { name: string; icon: string; rows: Row[] }[] = [
          {
            name: "Preset",
            icon: "mdi:palette-swatch",
            rows: [
              { kind: "single", key: "preset" },
              { kind: "single", key: "postproductionEnabled" },
            ],
          },
          {
            name: "Edges",
            icon: "mdi:vector-square",
            rows: [
              { kind: "single", key: "edges" },
              // Edge color + edge strength share one row (swatch + strength).
              { kind: "pair", label: "Edge", a: "edgeColor", aLabel: "Color", b: "edgeStrength", bLabel: "Strength" },
            ],
          },
          {
            name: "Shading",
            icon: "mdi:circle-half-full",
            rows: [
              { kind: "single", key: "surfaceColor" },
              // AO toggle + its strength on one line; tonal toggle + its floor.
              { kind: "toggleWith", toggle: "ao", label: "Ambient occlusion", dep: "aoStrength", depLabel: "Strength" },
              { kind: "toggleWith", toggle: "tonalShading", label: "Tonal shading", dep: "tonalFloor", depLabel: "Floor" },
            ],
          },
          {
            name: "Scene",
            icon: "mdi:image-outline",
            rows: [
              // Each scene toggle pairs with its own color on the same line.
              // Background colour is relevant when transparent is OFF (opaque),
              // i.e. the INVERSE of the generic toggle→dep relationship, so keep
              // the picker always interactive instead of dimming it.
              { kind: "toggleWith", toggle: "transparentBackground", label: "Transparent bg", dep: "backgroundColor", depLabel: "Color", depAlwaysEnabled: true },
              { kind: "toggleWith", toggle: "grid", label: "Grid", dep: "gridColor", depLabel: "Color" },
            ],
          },
          {
            name: "Quality",
            icon: "mdi:speedometer",
            rows: [
              { kind: "single", key: "fxaa" },
              // Adaptive resolution toggle + its target FPS on one line.
              { kind: "toggleWith", toggle: "adaptiveResolution", label: "Adaptive resolution", dep: "targetFps", depLabel: "FPS" },
              // Render scale + the high-res selection-outline toggle on one line.
              { kind: "toggleWith", toggle: "highResOutline", label: "Hi-res outline", dep: "renderScale", depLabel: "Scale" },
            ],
          },
        ];

        // "Show FPS" toggle (Quality section) — a synthetic bool wired straight
        // to the FPS overlay's visibility, so it renders through the same control
        // path as every other switch. Only added when an FPS controller exists.
        if (fps) {
          byKey.set("showFps", {
            key: "showFps",
            label: "Show FPS",
            group: "Quality",
            type: "bool",
            default: true,
            get: () => fps.visible,
            set: (v: boolean) => fps.setVisible(v),
          });
          sections.find((s) => s.name === "Quality")?.rows.push({
            kind: "single",
            key: "showFps",
          });
        }

        // Render one planned row, resolving each key to its live StyleSetting.
        const renderRow = (row: Row): unknown => {
          if (row.kind === "single") {
            const s = byKey.get(row.key);
            if (!s) return null;
            return BUI.html`<div class="g-row g-${s.type}">
              <span class="g-k">${row.label ?? s.label}</span>
              <span class="g-v">${control(s, refresh)}</span>
            </div>`;
          }
          if (row.kind === "toggleWith") {
            const t = byKey.get(row.toggle);
            const dep = byKey.get(row.dep);
            if (!t || t.type !== "bool" || !dep) return null;
            const off = row.depAlwaysEnabled ? false : !t.get();
            // The dependent control is dimmed/disabled while its toggle is off.
            return BUI.html`<div class="g-row g-toggle-with">
              <span class="g-k">${row.label ?? t.label}</span>
              <span class="g-v g-v-multi">
                <span class="g-dep ${off ? "g-dep-off" : ""}">
                  ${inlineControl(dep, refresh)}
                </span>
                ${boolSwitch(t, refresh)}
              </span>
            </div>`;
          }
          // pair: two dependent controls side by side under one section label.
          const a = byKey.get(row.a);
          const b = byKey.get(row.b);
          if (!a || !b) return null;
          return BUI.html`<div class="g-row g-pair">
            <span class="g-k">${row.label}</span>
            <span class="g-v g-v-multi">
              ${inlineControl(a, refresh)}
              ${inlineControl(b, refresh)}
            </span>
          </div>`;
        };

        body = BUI.html`
          ${sections.map(
            (sec) => BUI.html`
              <div class="g-band"><bim-icon class="g-band-ico" icon=${sec.icon}></bim-icon>${sec.name}</div>
              ${sec.rows.map((row) => renderRow(row))}
            `,
          )}
        `;
      }

      return BUI.html`
        <bim-panel
          label="Graphics"
          icon="mdi:tune"
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .prop-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .prop-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .prop-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }

            /* ── Full-bleed rows (mirror properties' .p-row / .p-kv) ──────────
               Rows reach both panel edges; text is re-inset via the same 1.1rem
               left / 0.4rem right padding the panel chrome uses. One consistent
               compact scale (~0.78rem) like the properties rows. */
            /* ── Full-bleed rows (mirror properties' .p-row / .p-kv) ──────────
               Rows reach both panel edges; text is re-inset via the same 1.1rem
               left / 0.4rem right padding the panel chrome uses. One consistent
               compact scale (~0.78rem) like the properties rows. */
            .g-row { box-sizing: border-box; min-height: 32px; display: flex;
              align-items: center; justify-content: space-between; gap: 0.6rem;
              padding: 0.35rem 0.4rem 0.35rem 1.1rem; font-size: 0.78rem;
              line-height: 1.3; color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            /* Muted label on the LEFT (like .p-k, opacity ~0.6). Single line +
               ellipsis so a long label never wraps and overlaps its control. */
            .g-k { opacity: 0.6; flex: 0 1 auto; min-width: 0; max-width: 42%;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            /* Control on the RIGHT (like .p-v), right-aligned, never crushed. */
            .g-v { flex: 1 1 auto; min-width: 0; display: flex;
              align-items: center; justify-content: flex-end; }
            /* Multi-control right cell: dependent value(s) + toggle on one line,
               tight gap, right-aligned, wrap-free. */
            .g-v-multi { gap: 0.65rem; flex-wrap: nowrap; }

            /* Inline mini-labelled control (the dependent values that share a
               row). The mini-label is muted + tiny; the control sits right next
               to it with a compact field. */
            .g-inline { display: inline-flex; align-items: center; gap: 0.3rem;
              flex: 0 1 auto; min-width: 0; }
            .g-il { opacity: 0.55; font-size: 0.7rem; letter-spacing: 0.01em;
              white-space: nowrap; }
            /* A dependent control whose owning toggle is OFF: dimmed + inert. */
            .g-dep { display: inline-flex; align-items: center; min-width: 0;
              flex: 0 1 auto; }
            .g-dep-off { opacity: 0.4; pointer-events: none; }

            /* Section band — EXACTLY the properties panel's .p-psh band: muted,
               full-bleed, a subtle gray BACKGROUND (one step up from the panel)
               with top/bottom hairlines matching the same 1px contrast-20 used
               between rows — never a heavier rule, never the bright/gradient
               panel-title treatment. Subordinate to the "Graphics" card title. */
            .g-band { box-sizing: border-box; padding: 0.4rem 0.4rem 0.4rem 1.1rem;
              display: flex; align-items: center; gap: 0.4rem;
              font-size: 0.76rem; font-weight: 500; letter-spacing: 0.01em;
              color: var(--bim-ui_bg-contrast-70, #a7a7ab);
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-top: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            /* Per-section icon — muted to match the band text, never the accent. */
            .g-band-ico { flex: 0 0 auto; font-size: 0.9rem;
              color: var(--bim-ui_bg-contrast-70, #a7a7ab); }
            .g-band:first-child { border-top: none; }

            /* ── Slim, dark-themed controls ──────────────────────────────────
               Override BUI control custom-props so the widgets read as compact
               right-aligned controls (matching the searchbar field look used in
               the tree/properties inputs), not chunky default widgets. */
            .g-v bim-number-input,
            .g-v bim-color-input,
            .g-v bim-dropdown {
              /* Subtle app surface (not a near-black box) so the controls read as
                 part of the panel, like the app's other surfaces. */
              font-size: 0.78rem;
            }
            /* Number input: small dark field (not a big solid-purple block),
               right-aligned, fixed compact width. Slim the embedded slider too.
               Narrower (5.5rem) inside a shared/inline cell so two controls fit. */
            .g-number bim-number-input { flex: 0 0 auto; width: 7.5rem; }
            /* SLIDER FILL FLUSH TO BORDER.
               In BUI the slider renders as <bim-input>→.input (the rounded
               field, padded by --bim-input--p) → .slider → .slider-indicator
               (the purple fill: position:absolute; top:0; left:0; height:100%;
               width:value%; background:var(--bim-ui_main-base)). The fill is
               absolutely positioned to the .input CONTENT box, so the field's
               inner padding (--bim-input--p, which the shared rule above sets to
               0.15rem 0.35rem) shows as an inset band of field background all
               around the fill. Zero the padding for the slider so the fill
               reaches the rounded border edge-to-edge. The value text is a
               separate z-index:1 <bim-label> centered over the fill, so it stays
               readable. (--bim-slider--* are NOT real BUI hooks — the fill color
               is --bim-ui_main-base, already var(--bim-ui_accent-base) globally.) */
            .g-v bim-number-input {
            }
            .g-v bim-number-input::part(input) { text-align: right; }
            .g-inline bim-number-input { flex: 0 1 auto; width: 4.5rem; min-width: 3rem; }
            /* Color input: small swatch + compact hex, not an oversized control. */
            .g-color bim-color-input { flex: 0 0 auto; width: 6.5rem; }
            .g-v bim-color-input { /* swatch box size */ }
            /* Let the colour input take its NATURAL width (swatch + hex), with no
               grow/shrink — so its real rounded box renders at that size instead
               of a forced narrower width whose content overflows rightward into
               the gap / under the toggle. There is room for it in every row. */
            .g-inline bim-color-input { flex: 0 0 auto; }
            /* Dropdown CLOSED control: compact, right-aligned, and it inherits
               the shared field look above (bg-contrast-20 fill, 1px contrast-40
               outline). The OPEN popup is themed document-level (see
               ensureDropdownPopupStyle) because BUI relocates it to a top-level
               dialog outside this shadow scope. */
            .g-enum bim-dropdown { flex: 0 0 auto; min-width: 7rem; max-width: 10rem; }

            /* ── Library toggle (bim-checkbox[toggle]) sizing ────────────────
               The checkbox host is display:block and would stretch to fill the
               row's right cell (pushing/overlapping the dependent control). Pin
               it to its intrinsic switch width and keep it from growing so it
               sits flush-right without crowding its neighbour. The track/knob/
               on-colour all come from the library (purple track + #3C3C41 ball
               with an outline) — no per-app restyle. */
            .g-row bim-checkbox.g-toggle { flex: 0 0 2rem; width: 2rem; margin-left: 0.35rem; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0 0.4rem 0.4rem 1.1rem;">
              <div class="prop-vp" style="flex: 1 1 auto; min-height: 0; overflow-y: auto;
                margin-left: -1.1rem; margin-right: -0.4rem;">
                ${body}
              </div>
            </div>
          </div>
        </bim-panel>
      `;
    },
    { tick: 0 },
  );

  // The pipeline configures asynchronously after the first sized frame; the
  // panel may render before it's ready. Poll briefly until ready, then re-render
  // once so the real controls appear (cheap: stops the moment it succeeds).
  let attempts = 0;
  const poll = window.setInterval(() => {
    attempts += 1;
    if (ready(getWorld())) {
      update({ tick: 0 });
      window.clearInterval(poll);
    } else if (attempts > 120) {
      window.clearInterval(poll); // give up after ~60s
    }
  }, 500);

  return panel;
};
