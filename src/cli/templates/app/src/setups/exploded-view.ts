import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";

/**
 * EXPLODED VIEW — a HEADLESS controller (no UI). The toolbar wires a single
 * `mdi:arrow-expand-vertical` button to `toggle()` / `isActive()` / `onChange()`.
 *
 * ── Technique ──────────────────────────────────────────────────────────────
 * Fragments has no runtime "translate these items" call; the supported path is
 * the Edit API's GLOBAL TRANSFORMS (each item placement is a global transform
 * with a `position`). So per model we:
 *  1. Group element localIds by IFCBUILDINGSTOREY (from the spatial structure)
 *     and order storeys by elevation (min-Y of each group's bbox).
 *  2. Map items → their global-transform ids; a transform shared across MORE
 *     than one storey is skipped (it can't be moved per-storey cleanly).
 *  3. SNAPSHOT each transform's original position ONCE.
 *  4. To explode at magnitude m: set each transform's Y to
 *     `originalY + storeyIndex × step × m` — ALWAYS absolute from the snapshot,
 *     never accumulated, so repeated explode/reset never drifts. m = 0 restores
 *     exactly.
 *
 * Edits are applied in the background (the Edit API can't do 60/s). Visibility &
 * selection are untouched (only transforms change).
 *
 *     const explode = explodedView(components);
 *     // toolbar: button @click=explode.toggle(); active styling = explode.isActive()
 *
 * @param components engine components
 */

const STOREY = "IFCBUILDINGSTOREY";
const DEFAULT_MAGNITUDE = 1.0;

export interface ExplodedViewController {
  /** Off→on (applies the default magnitude) / on→off (restores exactly). */
  toggle(): void;
  /** Whether the model is currently exploded (magnitude > 0). */
  isActive(): boolean;
  /** Subscribe to active changes (toggle / auto-reset). Returns an unsubscribe. */
  onChange(cb: (active: boolean) => void): () => void;
  /** Graded control (0→1). Kept for a future popover slider; 0 restores exactly. */
  setMagnitude(v: number): void;
}

interface ModelExplode {
  // global-transform localId → its storey index (0 = lowest). Only single-storey
  // transforms are included.
  gtToStorey: Map<number, number>;
  // global-transform localId → original position [x,y,z] (the snapshot).
  snapshot: Map<number, [number, number, number]>;
  // current global-transform objects (other fields preserved on UPDATE).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gts: Map<number, any>;
  step: number; // vertical units per storey index at magnitude 1
}

export const explodedView = (
  components: OBC.Components,
): ExplodedViewController => {
  const fragments = components.get(OBC.FragmentsManager);
  // The Edit API; opt into the in-place incremental edit path (cheaper than a
  // per-edit delta-model rebuild). Harmless if already enabled.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fragments.core as any).settings.incrementalEdit = true;
  } catch {
    /* setting may not exist on older cores — edits still work, just slower */
  }

  let magnitude = 0;
  let active = false;
  let busy = false;
  const prepared = new Map<string, ModelExplode>();
  const listeners = new Set<(active: boolean) => void>();

  const setActive = (a: boolean) => {
    if (a === active) return;
    active = a;
    for (const cb of listeners) cb(a);
  };

  // Collect, per storey node, all descendant element localIds.
  const collectStoreys = (root: FRAGS.SpatialTreeItem) => {
    const storeys: number[][] = [];
    const descendants = (node: FRAGS.SpatialTreeItem, acc: number[]) => {
      if (node.localId !== null && node.localId !== undefined && node.localId >= 0) {
        acc.push(node.localId);
      }
      node.children?.forEach((c) => descendants(c, acc));
    };
    const walk = (node: FRAGS.SpatialTreeItem) => {
      if ((node.category ?? "").toUpperCase() === STOREY) {
        const ids: number[] = [];
        descendants(node, ids);
        if (ids.length) storeys.push(ids);
      } else {
        node.children?.forEach(walk);
      }
    };
    walk(root);
    return storeys;
  };

  // Build the explode plan for one model (snapshot + storey→transform map).
  const prepareModel = async (
    model: FRAGS.FragmentsModel,
  ): Promise<ModelExplode | null> => {
    const structure = await model.getSpatialStructure();
    if (!structure) return null;
    let storeys = collectStoreys(structure);
    if (storeys.length < 2) return null; // nothing to separate

    // Order storeys by elevation (min-Y of the group's merged bbox).
    const withY = await Promise.all(
      storeys.map(async (ids) => {
        let minY = Number.POSITIVE_INFINITY;
        try {
          const boxes = (await fragments.getBBoxes({
            [model.modelId]: new Set(ids),
          })) as THREE.Box3[];
          for (const b of boxes) if (!b.isEmpty()) minY = Math.min(minY, b.min.y);
        } catch {
          /* leave at +Inf → sorts last; harmless */
        }
        return { ids, minY };
      }),
    );
    withY.sort((a, b) => a.minY - b.minY);
    storeys = withY.map((s) => s.ids);

    // Map global-transform ids → storey index; mark cross-storey ones for skip.
    const gtToStorey = new Map<number, number>();
    const skip = new Set<number>();
    for (let i = 0; i < storeys.length; i += 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gtIds: Iterable<number> = await (model as any).getGlobalTranformsIdsOfItems(
        storeys[i],
      );
      for (const gt of gtIds) {
        if (skip.has(gt)) continue;
        if (gtToStorey.has(gt) && gtToStorey.get(gt) !== i) {
          gtToStorey.delete(gt); // shared across storeys → can't move cleanly
          skip.add(gt);
        } else {
          gtToStorey.set(gt, i);
        }
      }
    }
    if (gtToStorey.size === 0) return null;

    // Snapshot original positions.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gts: Map<number, any> = await model.getGlobalTransforms();
    const snapshot = new Map<number, [number, number, number]>();
    for (const [id, gt] of gts) {
      if (!gtToStorey.has(id)) continue;
      const p = gt.position as number[];
      snapshot.set(id, [p[0], p[1], p[2]]);
    }

    // Vertical step per storey index: a fraction of the model's height so the
    // explode reads clearly regardless of model scale.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const box = (model as any).box as THREE.Box3 | undefined;
    const height = box && !box.isEmpty() ? box.max.y - box.min.y : 10;
    const step = (height * 0.45) / Math.max(1, storeys.length - 1);

    return { gtToStorey, snapshot, gts, step };
  };

  const rebuild = async () => {
    prepared.clear();
    for (const model of fragments.list.values()) {
      try {
        const plan = await prepareModel(model);
        if (plan) prepared.set(model.modelId, plan);
      } catch (error) {
        console.warn("[exploded-view] prepare failed", model.modelId, error);
      }
    }
    // Re-apply the current magnitude to freshly-loaded models.
    if (magnitude > 0) void apply();
  };

  // Apply the current magnitude across all prepared models. Always sets the
  // absolute position from the snapshot (no accumulation → no drift).
  const apply = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const [modelId, plan] of prepared) {
        const model = fragments.list.get(modelId);
        if (!model) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requests: any[] = [];
        for (const [id, orig] of plan.snapshot) {
          const i = plan.gtToStorey.get(id) ?? 0;
          const gt = plan.gts.get(id);
          if (!gt) continue;
          requests.push({
            type: FRAGS.EditRequestType.UPDATE_GLOBAL_TRANSFORM,
            localId: id,
            data: {
              ...gt,
              position: [orig[0], orig[1] + i * plan.step * magnitude, orig[2]],
            },
          });
        }
        if (requests.length === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (fragments.core as any).editor.edit(modelId, requests);
      }
      await fragments.core.update(true);
    } catch (error) {
      console.warn("[exploded-view] apply failed", error);
    } finally {
      busy = false;
    }
  };

  const setMagnitude = (v: number) => {
    magnitude = Math.max(0, Math.min(1, v));
    void apply();
    setActive(magnitude > 0);
  };

  // Recompute the plan whenever the loaded models change.
  fragments.core.onModelLoaded.add(() => void rebuild());
  fragments.list.onItemDeleted.add(() => void rebuild());
  void rebuild();

  return {
    toggle() {
      setMagnitude(active ? 0 : DEFAULT_MAGNITUDE);
    },
    isActive() {
      return active;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setMagnitude,
  };
};
