import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { cameraTools } from "./camera-tools";
import { hider } from "./hider";
import { clipper } from "./clipper";
import { lengthMeasurement, areaMeasurement } from "./measurements";
import type { HelperPanelController } from "./helper-panel";
import { stylesTool } from "./styles-panel";

/**
 * A floating tool palette centered at the BOTTOM-CENTER of the viewport. Built
 * on BUI's native `bim-toolbar` (icon-only `bim-button`s with hover tooltips),
 * placed in a `bim-grid floating` overlay so the bar is interactive while empty
 * areas click through to the 3D scene. Styled to match the cards (dark
 * `bg-base`, rounded, subtle shadow).
 *
 * Tool kinds (the modules' integration contract):
 *  - ACTION  `{ label, icon, run() }`             — fire-and-forget.
 *  - MODE    `{ label, icon, activate(), deactivate() }` — mutually exclusive:
 *            activating one deactivates the current; clicking the active one
 *            turns it off.
 *  - TOGGLE  `{ label, icon, activate(), deactivate(), active?() }` — independent
 *            on/off (e.g. ortho).
 *  - PANEL   `{ label, icon, render(refresh) }` — toggles the bottom-left helper
 *            panel showing that tool's content (e.g. Styles). Mutually exclusive
 *            among panel tools; INDEPENDENT of viewport modes (opening Styles
 *            doesn't cancel an active section/measure mode, and vice versa).
 *
 * Only this file assembles the toolbar; other workers deliver tool controllers
 * (camera here; hider from hider.ts; clipper/measure to be added when ready).
 *
 * @param components engine components
 * @param container the viewport element to overlay
 */
type ActionTool = {
  kind: "action";
  label: string;
  icon: string;
  run: () => void | Promise<void>;
};
type ModeTool = {
  kind: "mode";
  label: string;
  icon: string;
  activate: () => void | Promise<void>;
  deactivate: () => void | Promise<void>;
};
type ToggleTool = {
  kind: "toggle";
  label: string;
  icon: string;
  activate: () => void | Promise<void>;
  deactivate: () => void | Promise<void>;
  active?: () => boolean;
};
type PanelTool = {
  kind: "panel";
  label: string;
  icon: string;
  render: (refresh: () => void) => unknown;
};
type Tool = ActionTool | ModeTool | ToggleTool | PanelTool;

export const toolbar = (
  components: OBC.Components,
  container: HTMLElement,
  helper: HelperPanelController, // the left-stack helper card (panel tools drive it)
) => {
  const cam = cameraTools(components);
  const vis = hider(components);
  // World for the MODE tools (clipper/measurements need a world + its canvas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const world = [...components.get(OBC.Worlds).list.values()][0] as any;
  // MODE controllers ({ label, icon, activate, deactivate }) — only built when a
  // world exists (it does: the viewport mounts before the toolbar).
  const modeTools: Tool[] = world
    ? [
        { kind: "mode", ...clipper(components, world) },
        { kind: "mode", ...lengthMeasurement(components, world) },
        { kind: "mode", ...areaMeasurement(components, world) },
      ]
    : [];

  // Groups → rendered as separate toolbar sections (auto-divider between them).
  // Order: [view: fit, ortho] | [tools: section/measure — pending] | [visibility].
  const groups: Tool[][] = [
    [
      { kind: "action", label: "Zoom to fit", icon: cam.fitAll.icon, run: cam.fitAll.run },
      {
        kind: "toggle",
        label: "Orthographic",
        icon: cam.orthoToggle.icon,
        activate: cam.orthoToggle.activate,
        deactivate: cam.orthoToggle.deactivate,
        active: cam.orthoToggle.active,
      },
    ] as Tool[],
    // Mode tools (section / measure) — mutually exclusive.
    modeTools,
    [
      { kind: "action", label: "Hide", icon: "mdi:eye-off-outline", run: vis.hideSelected },
      { kind: "action", label: "Isolate", icon: "mdi:select-search", run: vis.isolateSelected },
      { kind: "action", label: "Show all", icon: "mdi:eye-outline", run: vis.showAll },
    ] as Tool[],
    // Panel tools (open the bottom-left helper). Styles needs a world.
    world
      ? ([{ kind: "panel", ...stylesTool(components, world) }] as Tool[])
      : [],
  ].filter((g) => g.length > 0);

  // ── Active-state bookkeeping ───────────────────────────────────
  let activeMode: ModeTool | null = null; // mutual exclusion across all modes
  let activePanel: PanelTool | null = null; // exclusive among panel tools
  const onToggle = new Set<ToggleTool>(); // independent toggles that are on

  const isActive = (t: Tool) =>
    t.kind === "mode"
      ? t === activeMode
      : t.kind === "panel"
        ? t === activePanel
        : t.kind === "toggle"
          ? (t.active ? t.active() : onToggle.has(t))
          : false;

  const onClick = async (t: Tool) => {
    if (t.kind === "action") {
      await t.run();
    } else if (t.kind === "mode") {
      if (activeMode === t) {
        await t.deactivate();
        activeMode = null;
      } else {
        if (activeMode) await activeMode.deactivate();
        await t.activate();
        activeMode = t;
      }
    } else if (t.kind === "panel") {
      // Toggle the helper panel; exclusive among panel tools, independent of modes.
      if (activePanel === t) {
        activePanel = null;
        helper.clear();
      } else {
        activePanel = t;
        helper.show({
          title: t.label,
          icon: t.icon,
          render: () => t.render(() => helper.refresh()),
        });
      }
    } else {
      const on = isActive(t);
      if (on) {
        await t.deactivate();
        onToggle.delete(t);
      } else {
        await t.activate();
        onToggle.add(t);
      }
    }
    refresh();
  };

  let tick = 0;
  const refresh = () => barUpdate({ tick: (tick += 1) });

  const [bar, barUpdate] = BUI.Component.create<HTMLElement, { tick: number }>(
    // Param required: BUI.Component.create returns a single element (not the
    // [element, update] tuple) when the template has arity 0.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_state) => BUI.html`
      <bim-toolbar
        style="
          pointer-events: auto;
          padding: 0.15rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
          /* Uniform rhythm: inter-button gap = G; section padding = G/2 so the
             space across a divider (padA + padB) equals the inter-button gap and
             the divider sits centered with equal margins. */
        "
      >
        ${groups.map(
          (group) => BUI.html`
            <bim-toolbar-section label-hidden>
              ${group.map(
                (t) => BUI.html`
                  <bim-button
                    icon=${t.icon}
                    ?active=${isActive(t)}
                    @click=${() => onClick(t)}
                    style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
                  ><bim-tooltip placement="top">${t.label}</bim-tooltip></bim-button>
                `,
              )}
            </bim-toolbar-section>
          `,
        )}
      </bim-toolbar>
    `,
    { tick: 0 },
  );

  // Floating grid: bar docked bottom-center. Row 1 (1fr) empty filler above;
  // row 2 (auto) holds the bar in the center column, flanked by 1fr columns so
  // it stays horizontally centered. Empty areas click through.
  const grid = BUI.Component.create(() => {
    const onCreated = (element?: Element) => {
      if (!element) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = element as any;
      g.elements = { bar };
      g.layouts = {
        main: {
          template: `
            "fillL  fillC fillR" 1fr
            "restL  bar   restR" auto
            / 1fr auto 1fr
          `,
        },
      };
      g.layout = "main";
    };
    return BUI.html`
      <bim-grid style="padding: 1rem;" ${BUI.ref(onCreated)} floating></bim-grid>
    `;
  });
  container.append(grid);

  return bar;
};
