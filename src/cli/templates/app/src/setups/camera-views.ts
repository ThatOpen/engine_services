import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as BUI from "@thatopen/ui";
import { cameraTools } from "./camera-tools";

/**
 * Camera navigation — a COMPACT floating overlay pinned top-right of the
 * viewport (mirrors visibility-toolbar's self-mounting floating-grid overlay).
 *
 * Controls:
 *  - View presets (Iso / Top / Bottom / Front / Back / Left / Right) via a
 *    compact dropdown. Each frames the union bounding box of all loaded models:
 *    `setLookAt` along the preset axis, then `fitToSphere` to frame precisely
 *    while keeping the new direction.
 *  - Zoom-to-fit + Perspective⇄Orthographic toggle — reused from
 *    `cameraTools(components)` (no reimplementation).
 *
 * Self-mounts into the viewport overlay. Wire from main.ts with one line
 * (after the viewport exists), like the visibility toolbar:
 *
 *     cameraViews(components, viewerElement);
 *
 * @param components engine components
 * @param container optional viewport element to overlay; if omitted, the first
 *                  world's renderer container is used.
 */

// Preset → camera direction (from target toward camera). Normalized + scaled by
// the model radius at apply time.
const VIEWS: Record<string, [number, number, number]> = {
  Iso: [1, 0.8, 1],
  Top: [0, 1, 0],
  Bottom: [0, -1, 0],
  Front: [0, 0, 1],
  Back: [0, 0, -1],
  Left: [-1, 0, 0],
  Right: [1, 0, 0],
};

export const cameraViews = (
  components: OBC.Components,
  container?: HTMLElement,
) => {
  const fragments = components.get(OBC.FragmentsManager);
  const cam = cameraTools(components);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstWorld = (): any => [...components.get(OBC.Worlds).list.values()][0];

  const unionBox = () => {
    const box = new THREE.Box3();
    for (const model of fragments.list.values()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (model as any).box as THREE.Box3 | undefined;
      if (b && !b.isEmpty()) box.union(b);
    }
    return box;
  };

  const setView = async (name: string) => {
    const dir = VIEWS[name];
    if (!dir) return;
    const controls = firstWorld()?.camera?.controls;
    if (!controls?.setLookAt) return;
    const box = unionBox();
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius || 1;
    const c = sphere.center;
    const v = new THREE.Vector3(dir[0], dir[1], dir[2])
      .normalize()
      .multiplyScalar(r * 3);
    try {
      // Move to the preset direction, then frame the sphere exactly (keeps the
      // new direction, snaps the distance to fit).
      await controls.setLookAt(
        c.x + v.x, c.y + v.y, c.z + v.z,
        c.x, c.y, c.z,
        true,
      );
      await controls.fitToSphere(sphere, true);
    } catch (error) {
      console.warn("[camera-views] setView failed", error);
    }
  };

  let busy = false;
  const run = async (fn: () => void | Promise<void>) => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (error) {
      console.warn("[camera-views] action failed", error);
    } finally {
      busy = false;
    }
  };

  let tick = 0;
  const [bar, barUpdate] = BUI.Component.create<HTMLElement, { tick: number }>(
    // Param required: create() returns a single element (not the [element,
    // update] tuple) when the template has arity 0.
    (_state) => {
      // Guard: the very first render can run before a world exists, and reading
      // the projection spreads the (possibly empty/not-yet-ready) worlds list.
      let ortho = false;
      try {
        ortho = cam.orthoToggle.active();
      } catch {
        /* world not ready yet — default to perspective icon, re-render later */
      }
      return BUI.html`
        <bim-toolbar
          style="
            pointer-events: auto; overflow: visible; padding: 0.15rem;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
          "
        >
          <bim-toolbar-section label-hidden style="background: transparent;">
            <bim-dropdown
              icon="mdi:camera-control"
              style="min-width: 6rem;"
              @change=${(e: Event) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const picked = (e.target as any).value?.[0];
                if (picked) void run(() => setView(String(picked)));
              }}
            >
              ${Object.keys(VIEWS).map(
                (name) => BUI.html`<bim-option label=${name}></bim-option>`,
              )}
            </bim-dropdown>
          </bim-toolbar-section>
          <bim-toolbar-section label-hidden style="background: transparent;">
            <bim-button
              icon=${cam.fitAll.icon}
              @click=${() => run(() => cam.fitAll.run())}
              style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
            ><bim-tooltip placement="bottom">${cam.fitAll.label}</bim-tooltip></bim-button>
            <bim-button
              icon=${ortho ? "mdi:perspective-less" : "mdi:perspective-more"}
              @click=${() =>
                run(async () => {
                  if (cam.orthoToggle.active()) await cam.orthoToggle.deactivate();
                  else await cam.orthoToggle.activate();
                  barUpdate({ tick: ++tick });
                })}
              style="width: 1.9rem; min-width: 1.9rem; height: 1.9rem;"
            ><bim-tooltip placement="bottom">${
              ortho
                ? "Orthographic — switch to Perspective"
                : "Perspective — switch to Orthographic"
            }</bim-tooltip></bim-button>
          </bim-toolbar-section>
        </bim-toolbar>
      `;
    },
    { tick: 0 },
  );

  // ── Floating grid overlay: bar pinned TOP-RIGHT; empty areas click through ──
  const grid = BUI.Component.create(() => {
    const onCreated = (element?: Element) => {
      if (!element) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = element as any;
      g.elements = { bar };
      g.layouts = {
        main: {
          template: `
            "restL bar"   auto
            "fillL fillR" 1fr
            / 1fr auto
          `,
        },
      };
      g.layout = "main";
    };
    return BUI.html`
      <bim-grid style="padding: 1rem;" ${BUI.ref(onCreated)} floating></bim-grid>
    `;
  });

  const resolveContainer = (): HTMLElement | undefined => {
    if (container) return container;
    const world = [...components.get(OBC.Worlds).list.values()][0] as
      | { renderer?: { three?: { domElement?: HTMLElement } } }
      | undefined;
    const canvas = world?.renderer?.three?.domElement;
    return (canvas?.parentElement as HTMLElement | undefined) ?? undefined;
  };

  const host = resolveContainer();
  if (host) host.append(grid);
  else
    console.warn(
      "[camera-views] no viewport found to overlay; append the returned element manually",
    );

  return bar;
};
