import * as BUI from "@thatopen/ui";
import type { InspectionInstances, InstanceRow } from "./inspection";
import { toolPlaceholderUri } from "../assets/tool-placeholder";
import { cardHeader } from "./card-header";

/**
 * OBJECTS outliner panel (UI-reorg increment b). Lists every created clip plane
 * and measurement from the unified {@link InspectionInstances} API, each row with
 * hide/show, enable/disable (clip planes only) and delete. Re-renders on the
 * inspection `onChanged` event (the row actions themselves fire it via the tools,
 * so handlers don't re-render manually). Returns its `bim-panel` WITHOUT
 * self-mounting — main.ts docks it in the activity-bar "Objects" layout.
 *
 * @param inspection unified clip-plane + measurement instance list (from W1)
 * @returns the `bim-panel` element
 */
const iconFor = (r: InstanceRow): string => {
  if (r.kind === "clip") return "mdi:scissors-cutting";
  switch (r.type) {
    case "Length": return "mdi:ruler";
    case "Area": return "mdi:vector-square";
    case "Angle": return "mdi:angle-acute";
    default: return "mdi:cube-outline";
  }
};

export const objectsPanel = (inspection: InspectionInstances) => {
  // bim-tooltip portals itself into a body-level container while shown and only
  // hides on its parent button's `mouseleave`. A row action (delete / toggle)
  // fires inspection.onChanged → the row re-renders and the button is removed —
  // so the parent never sees `mouseleave` and the portaled tooltip is left
  // orphaned on screen. Firing `mouseleave` on the button first runs the
  // tooltip's hide (re-parents + clears it) BEFORE the row removes, so no stale
  // tooltip lingers after delete/toggle.
  const dismissTip = (e: Event) =>
    (e.currentTarget as HTMLElement | null)?.dispatchEvent(new MouseEvent("mouseleave"));

  const rowHtml = (r: InstanceRow) => BUI.html`
    <div class="ob-row">
      <bim-icon class="ob-ico" icon=${iconFor(r)}></bim-icon>
      <span class="ob-lbl" title=${r.label}>${r.label}</span>
      <bim-button
        class="ob-act"
        icon=${r.visible ? "mdi:eye-outline" : "mdi:eye-off-outline"}
        @click=${(e: Event) => { dismissTip(e); r.setVisible(!r.visible); }}
      ><bim-tooltip>${r.visible ? "Hide" : "Show"}</bim-tooltip></bim-button>
      ${r.enabled !== undefined
        ? BUI.html`<bim-button
            class="ob-act"
            icon=${r.enabled ? "mdi:toggle-switch-outline" : "mdi:toggle-switch-off-outline"}
            @click=${(e: Event) => { dismissTip(e); r.setEnabled?.(!r.enabled); }}
          ><bim-tooltip>${r.enabled ? "Disable cut" : "Enable cut"}</bim-tooltip></bim-button>`
        : null}
      <bim-button
        class="ob-act"
        icon="mdi:trash-can-outline"
        @click=${(e: Event) => { dismissTip(e); r.remove(); }}
      ><bim-tooltip>Delete</bim-tooltip></bim-button>
    </div>`;

  // A titled group ("Clip planes" / "Measurements") when its rows are present.
  const group = (title: string, rows: InstanceRow[]) =>
    rows.length === 0
      ? null
      : BUI.html`
          <div class="ob-grp">${title}</div>
          ${rows.map(rowHtml)}`;

  const [panel, update] = BUI.Component.create<BUI.Panel, { tick: number }>(
    // Arity >= 1 (state param) is REQUIRED — an arity-0 callback makes
    // Component.create return a single element, not [el, update].
    (_s) => {
      const rows = inspection.list();
      const clips = rows.filter((r) => r.kind === "clip");
      const measures = rows.filter((r) => r.kind === "measurement");
      return BUI.html`
        <bim-panel
          label="Objects"
          icon="mdi:cube-outline"
          header-hidden
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .ob-scroll { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;
              overflow-y: auto; padding: 0.4rem 0 0.6rem; }
            .ob-scroll::-webkit-scrollbar { width: 0.4rem; }
            .ob-scroll::-webkit-scrollbar-thumb { border-radius: 0.25rem;
              background-color: var(--bim-scrollbar--c, #3C3C41); }
            .ob-grp { padding: 0.45rem 0.75rem 0.2rem; font-size: 0.68rem;
              font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
              color: var(--bim-ui_bg-contrast-60, #99a0ae); }
            .ob-row { display: flex; align-items: center; gap: 0.4rem;
              padding: 0.1rem 0.5rem 0.1rem 0.75rem; min-height: 1.7rem; }
            .ob-row:hover { background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.06)); }
            .ob-ico { flex: 0 0 auto; font-size: 0.9rem;
              color: var(--bim-ui_bg-contrast-60, #99a0ae); }
            .ob-lbl { flex: 1 1 auto; min-width: 0; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; font-size: 0.74rem;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3); }
            .ob-act { flex: 0 0 auto; }
            /* Shared empty-state look (same svg placeholder + faded label as the
               Properties panel) so all panels read consistently when empty. */
            .ob-empty { display: flex; flex-direction: column; align-items: center;
              justify-content: center; gap: 0.75rem; height: 100%; min-height: 12rem;
              padding: 1rem; text-align: center; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            ${cardHeader("mdi:cube-outline", "Objects", "1.1rem")}
            <div class="ob-scroll">
            ${rows.length === 0
              ? BUI.html`<div class="ob-empty">
                  <img src=${toolPlaceholderUri} alt="" style="width: 7.5rem; height: auto; opacity: 0.9;" />
                  <bim-label style="opacity: 0.55; white-space: normal;">No clip planes or measurements yet. Create them from the Inspection toolbar.</bim-label>
                </div>`
              : BUI.html`${group("Clip planes", clips)}${group("Measurements", measures)}`}
            </div>
          </div>
        </bim-panel>`;
    },
    { tick: 0 },
  );

  // Re-render whenever an instance is added/removed or its state changes.
  inspection.onChanged.add(() => update({ tick: 0 }));

  return panel;
};
