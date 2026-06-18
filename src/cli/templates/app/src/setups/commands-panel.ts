import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import { hider } from "./hider";

/**
 * COMMANDS — a docked side-panel (alongside Explorer / Files / Graphics) that is
 * both the keyboard-shortcut registry and its palette UI.
 *
 * A single `COMMANDS` table maps each viewer action to a shortcut + an mdi icon
 * and a `run()` wired to the EXISTING components (the `hider` controller for
 * visibility, the Highlighter for the current selection + clear, camera-controls
 * for focus). The panel lists every command with its shortcut (command-palette
 * style, click-to-run), and a global `keydown` handler dispatches the shortcuts —
 * ignored while typing in an input so search fields aren't hijacked.
 *
 * Self-contained: returns the panel element WITHOUT self-mounting (like
 * modelTree / graphicsPanel) and installs its own window keydown listener.
 *
 * @param components engine components
 */

interface ViewerCommand {
  id: string;
  label: string;
  icon: string;
  /** Display chips, e.g. ["Shift", "H"]. */
  keys: string[];
  /** Does this keydown event trigger the command? */
  match: (e: KeyboardEvent) => boolean;
  run: () => void;
}

const noMods = (e: KeyboardEvent) =>
  !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

// Don't hijack shortcuts while the user is typing in a field.
const typingInField = (e: KeyboardEvent) => {
  const path = (e.composedPath?.() ?? []) as HTMLElement[];
  const el = (path[0] ?? (e.target as HTMLElement)) || null;
  const active = (document.activeElement as HTMLElement) || null;
  const isField = (n: HTMLElement | null) =>
    !!n &&
    (n.isContentEditable ||
      /^(input|textarea|select)$/i.test(n.tagName) ||
      /^bim-(text|number)-input$/i.test(n.tagName));
  return path.some(isField) || isField(el) || isField(active);
};

export const commandsPanel = (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(OBF.Highlighter);
  const selectName = highlighter.config.selectName;
  const h = hider(components);

  const hasSelection = () => {
    const map = highlighter.selection[selectName];
    return !!map && Object.values(map).some((s) => s.size > 0);
  };

  const focusSelection = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = [...components.get(OBC.Worlds).list.values()][0] as any;
    const controls = world?.camera?.controls;
    if (!controls) return;
    const map = highlighter.selection[selectName];
    const hasSel = !!map && Object.values(map).some((s) => s.size > 0);
    try {
      const box = new THREE.Box3();
      if (hasSel) {
        const boxes = (await fragments.getBBoxes(map)) as THREE.Box3[];
        for (const b of boxes) box.union(b);
      } else {
        // Nothing selected → focus = zoom to fit the WHOLE model (union of all
        // loaded models' bounds). This makes a dedicated fit/home button unnecessary.
        for (const model of fragments.list.values()) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = (model as any).box as THREE.Box3 | undefined;
          if (b && !b.isEmpty()) box.union(b);
        }
      }
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      await controls.fitToSphere(sphere, true);
    } catch (error) {
      console.warn("[commands] focus failed", error);
    }
  };

  const clearSelection = () => void highlighter.clear(selectName);

  const COMMANDS: ViewerCommand[] = [
    {
      id: "focus",
      label: "Focus selection",
      icon: "mdi:image-filter-center-focus",
      keys: ["F"],
      match: (e) => e.key.toLowerCase() === "f" && noMods(e),
      run: () => void focusSelection(),
    },
    {
      id: "hide",
      label: "Hide selected",
      icon: "mdi:eye-off-outline",
      keys: ["H"],
      match: (e) => e.key.toLowerCase() === "h" && noMods(e),
      run: () => h.hideSelected(),
    },
    {
      id: "isolate",
      label: "Isolate selected",
      icon: "mdi:select-search",
      keys: ["Shift", "H"],
      match: (e) =>
        e.key.toLowerCase() === "h" &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey,
      run: () => h.isolateSelected(),
    },
    {
      id: "ghost",
      label: "Ghost selected",
      icon: "mdi:ghost-outline",
      keys: ["G"],
      match: (e) => e.key.toLowerCase() === "g" && noMods(e),
      run: () => h.ghostSelected(),
    },
    {
      id: "showAll",
      label: "Show all",
      icon: "mdi:eye-outline",
      keys: ["Shift", "A"],
      match: (e) =>
        e.key.toLowerCase() === "a" &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey,
      run: () => h.showAll(),
    },
    {
      id: "clear",
      label: "Clear selection",
      icon: "mdi:close",
      keys: ["Esc"],
      match: (e) => e.key === "Escape" && noMods(e),
      run: () => clearSelection(),
    },
  ];

  // ── Global shortcut dispatch ───────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (typingInField(e)) return;
    for (const cmd of COMMANDS) {
      if (cmd.match(e)) {
        e.preventDefault();
        cmd.run();
        return;
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);

  // ── Panel UI (command-palette list; mirrors graphics-panel chrome) ──
  const [panel, update] = BUI.Component.create<BUI.Panel, { query: string }>(
    (state) => {
      const q = state.query.trim().toLowerCase();
      const rows = COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q));
      return BUI.html`
        <bim-panel
          label="Commands"
          icon="mdi:keyboard"
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .cmd-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .cmd-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .cmd-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }
            .cmd-row { box-sizing: border-box; min-height: 32px; display: flex;
              align-items: center; gap: 0.55rem; padding: 0.35rem 0.4rem 0.35rem 1.1rem;
              font-size: 0.78rem; line-height: 1.3; cursor: pointer;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .cmd-row:hover { background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08)); }
            .cmd-ico { flex: 0 0 auto; color: #99a0ae; font-size: 0.95rem; }
            .cmd-label { flex: 1 1 auto; min-width: 0; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; }
            .cmd-keys { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.2rem; }
            .cmd-kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              font-size: 0.66rem; line-height: 1; padding: 0.12rem 0.35rem;
              border-radius: 0.25rem; color: var(--bim-ui_bg-contrast-80, #c9c9c9);
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08));
              border: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.18)); }
            .cmd-plus { opacity: 0.4; font-size: 0.66rem; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0.4rem 0.4rem 0.4rem 1.1rem; gap: 0.25rem;">
              <bim-text-input
                icon="mdi:magnify"
                icon-inside
                placeholder="Search commands…"
                style="flex: 0 0 auto; width: 100%; margin: 0 0 0.25rem -0.35rem;"
                @input=${(e: Event) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  update({ query: String((e.target as any).value ?? "") });
                }}
              ></bim-text-input>
              <div style="flex: 0 0 auto; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); margin: 0 -0.4rem 0.1rem -1.1rem;"></div>
              <div class="cmd-vp" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; margin-left: -1.1rem; margin-right: -0.4rem;">
                ${rows.length === 0
                  ? BUI.html`<div style="padding: 0.75rem 1.1rem;"><bim-label style="opacity: 0.6;">No commands.</bim-label></div>`
                  : rows.map(
                      (c) => BUI.html`
                        <div class="cmd-row" title=${c.label} @click=${() => c.run()}>
                          <bim-icon class="cmd-ico" icon=${c.icon}></bim-icon>
                          <span class="cmd-label">${c.label}</span>
                          <span class="cmd-keys">
                            ${c.keys.map(
                              (k, i) => BUI.html`${i > 0
                                ? BUI.html`<span class="cmd-plus">+</span>`
                                : null}<span class="cmd-kbd">${k}</span>`,
                            )}
                          </span>
                        </div>`,
                    )}
              </div>
            </div>
          </div>
        </bim-panel>
      `;
    },
    { query: "" },
  );

  return panel;
};
