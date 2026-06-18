import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

/**
 * Central single-active-tool manager (explicit-state discipline per the grimoire
 * interaction-editing/modal-tools/state-machine-discipline): exactly ONE modal
 * tool (Section / Measure / future walkthrough …) is active at a time, and while
 * ANY tool is active the viewer's passive interactions — the Hoverer overlay and
 * the Highlighter (hover + click-select) — are suppressed so they don't fight the
 * tool's own picking. Both are restored when the last tool exits.
 *
 * A tool registers a {@link ManagedTool} and calls {@link setActive} on enter /
 * {@link clearActive} on exit. When another tool takes over, the manager calls
 * the previous tool's {@link ManagedTool.onDeactivate} (LOCAL teardown only — it
 * must not call back into the manager, to avoid re-entrancy).
 *
 * Reachable as a per-Components singleton via {@link toolModeManager} so panels
 * (and later walkthrough/others) can route through the same instance. (Flagging:
 * a plain memoised singleton, not an OBC.Component — say if you'd rather it be
 * components.get()-able and I'll wrap it.)
 */
export interface ManagedTool {
  readonly id: string;
  /**
   * Human-readable description of what the user is doing while this tool is
   * active (e.g. "Drawing clipping plane", "Measuring length"). Surfaced by the
   * active-tool HUD — which only reads this, so any future tool that registers a
   * label shows up there with no HUD changes. May be a function for tools whose
   * label varies while active (call {@link ToolModeManager.refresh} to update).
   */
  readonly label: string | (() => string);
  /** Optional mdi icon name (e.g. "mdi:scissors-cutting") shown next to the label. */
  readonly icon?: string;
  /** Called when another tool takes over; do LOCAL teardown only (no manager calls). */
  onDeactivate(): void;
}

export class ToolModeManager {
  // Always a real tool — the resting default is `selectTool` (never null), so
  // SELECT is a first-class state: reflected by the HUD, and entered via the same
  // setActive() exclusivity path as every other tool (so clicking Select
  // deactivates whatever modal tool was active, just like clip↔measure).
  private _active: ManagedTool;
  private _suppressed = false;
  private _prevHovererEnabled = true;
  private _prevHighlighterEnabled = true;

  /** Fires whenever the active tool changes (carries the new active tool, which
   *  is `selectTool` in the default mode). `| null` kept for HUD back-compat. */
  readonly onActiveChanged = new OBC.Event<ManagedTool | null>();

  /**
   * The default SELECT tool — plain object hover + click-select. It is the
   * resting active tool (on load and after any modal tool exits) and is the ONE
   * tool that does NOT suppress viewer interaction (Select IS that mode).
   */
  private readonly selectTool: ManagedTool = {
    id: ToolModeManager.SELECT_ID,
    label: "Select",
    icon: "mdi:cursor-default",
    onDeactivate: () => {},
  };

  constructor(private readonly components: OBC.Components) {
    this._active = this.selectTool;
  }

  /**
   * Id of the implicit default mode: idle / plain object-selection. Active on load
   * and whenever no modal tool is engaged. The Select toolbar button maps to it,
   * and the HUD reflects it as the resting state.
   */
  static readonly SELECT_ID = "select";

  get active(): ManagedTool {
    return this._active;
  }

  /** The active tool's id ({@link ToolModeManager.SELECT_ID} in the default mode). */
  getActiveId(): string {
    return this._active.id;
  }

  /** True in the default object-selection mode (no modal tool active). */
  get isSelectMode(): boolean {
    return this._active === this.selectTool;
  }

  /**
   * Return to SELECT (the default): exit whatever modal tool is active so the
   * viewer is back to idle hover + click-select. No-op if already in select. The
   * Select toolbar button calls this; individual tools still exit via clearActive.
   */
  selectMode() {
    this.setActive(this.selectTool);
  }

  /** Make `tool` the single active tool, deactivating the previous one. */
  setActive(tool: ManagedTool) {
    if (this._active === tool) return;
    this._active.onDeactivate(); // tear down the previous tool (selectTool: no-op)
    this._active = tool;
    // Suppress passive hover/select for MODAL tools only — selectTool IS that mode.
    this._applySuppression(tool !== this.selectTool);
    this.onActiveChanged.trigger(this._active);
  }

  /** Exit `tool` back to the default SELECT tool (no-op unless it's the active one). */
  clearActive(tool: ManagedTool) {
    if (this._active !== tool) return;
    this.setActive(this.selectTool);
  }

  /**
   * Re-emit the current active tool without changing it — for a tool whose
   * dynamic {@link ManagedTool.label} changed while it stayed active (e.g. the
   * measurement tool switching length → area), so the HUD re-reads the label.
   */
  refresh() {
    this.onActiveChanged.trigger(this._active);
  }

  private _applySuppression(suppress: boolean) {
    if (suppress === this._suppressed) return; // only act on a real transition
    const hoverer = this.components.get(OBF.Hoverer);
    const highlighter = this.components.get(OBF.Highlighter);
    if (suppress) {
      this._prevHovererEnabled = hoverer.enabled;
      this._prevHighlighterEnabled = highlighter.enabled;
      hoverer.enabled = false;
      highlighter.enabled = false;
    } else {
      hoverer.enabled = this._prevHovererEnabled;
      highlighter.enabled = this._prevHighlighterEnabled;
    }
    this._suppressed = suppress;
  }
}

const instances = new WeakMap<OBC.Components, ToolModeManager>();

/** Per-Components singleton accessor. */
export const toolModeManager = (components: OBC.Components): ToolModeManager => {
  let manager = instances.get(components);
  if (!manager) {
    manager = new ToolModeManager(components);
    instances.set(components, manager);
  }
  return manager;
};
