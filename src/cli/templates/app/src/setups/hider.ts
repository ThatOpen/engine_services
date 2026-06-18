import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

/**
 * Visibility actions driven by the CURRENT selection (the Highlighter "select"
 * set that the tree/viewport populate). Returns a controller for the toolbar to
 * wire to buttons — it does not render any UI itself.
 *
 * Suggested icons (ACTION buttons):
 *  - hideSelected    → "mdi:eye-off-outline"
 *  - isolateSelected → "mdi:select-search"   (alt: "mdi:eye")
 *  - showAll         → "mdi:eye-outline"     (alt: "mdi:restore")
 */
export interface HiderController {
  /** Hide the currently selected items. No-op if nothing is selected. */
  hideSelected(): void;
  /** Hide everything except the current selection. No-op if nothing is selected. */
  isolateSelected(): void;
  /** Reset: make every item visible again. */
  showAll(): void;
  /**
   * Ghost (x-ray) the current selection via the scalable per-element GPU state
   * texture (`model.setGhostItems`) — NO per-item recolor, so it scales to
   * millions of elements. No-op if nothing is selected.
   */
  ghostSelected(): void;
  /** Clear the ghost (x-ray) overlay on all loaded models. */
  clearGhost(): void;
}

export const hider = (components: OBC.Components): HiderController => {
  const hiderComp = components.get(OBC.Hider);
  const highlighter = components.get(OBF.Highlighter);
  const fragments = components.get(OBC.FragmentsManager);

  const currentSelection = (): OBC.ModelIdMap | undefined =>
    highlighter.selection.select;
  const hasItems = (map?: OBC.ModelIdMap) =>
    !!map && Object.values(map).some((set) => set.size > 0);

  // Making items visible must also un-ghost them — a shown element should never
  // linger as a ghost. unsetGhostItems is async (localId→itemId worker
  // conversion), so collect per-model tasks and update once they all land.
  const unghost = (map: OBC.ModelIdMap) => {
    const tasks: Promise<unknown>[] = [];
    for (const [modelId, set] of Object.entries(map)) {
      const model = fragments.list.get(modelId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (model && set.size > 0) tasks.push((model as any).unsetGhostItems?.([...set]));
    }
    if (tasks.length) void Promise.all(tasks).then(() => fragments.core.update(true));
  };

  const clearGhostAll = () => {
    for (const model of fragments.list.values()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any).clearGhost?.();
    }
    void fragments.core.update(true);
  };

  return {
    hideSelected() {
      const sel = currentSelection();
      if (!sel || !hasItems(sel)) return;
      void hiderComp.set(false, sel);
    },
    isolateSelected() {
      const sel = currentSelection();
      if (!sel || !hasItems(sel)) return;
      void hiderComp.isolate(sel);
      // The selection is the only thing visible now → un-ghost it so an isolated
      // element is never left ghosted.
      unghost(sel);
    },
    showAll() {
      void hiderComp.set(true);
      // Everything is visible again → nothing should stay ghosted.
      clearGhostAll();
    },
    ghostSelected() {
      const sel = currentSelection();
      if (!sel || !hasItems(sel)) return;
      const tasks: Promise<unknown>[] = [];
      for (const [modelId, set] of Object.entries(sel)) {
        const model = fragments.list.get(modelId);
        // setGhostItems is async (localId→itemId worker conversion) — update
        // only after every model's ghost state is written.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (model && set.size > 0) tasks.push((model as any).setGhostItems([...set], false));
      }
      void Promise.all(tasks).then(() => fragments.core.update(true));
    },
    clearGhost() {
      clearGhostAll();
    },
  };
};
