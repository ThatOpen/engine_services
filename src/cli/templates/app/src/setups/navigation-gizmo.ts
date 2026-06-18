import * as THREE from "three";
import * as OBC from "@thatopen/components";

/**
 * NAVIGATION GIZMO — a Blender/Spline-style axis-ball orientation widget pinned
 * TOP-RIGHT of the viewport. Replaces the old camera-views overlay.
 *
 * A small rounded dark DISC contains a soft axis triad that reflects the LIVE
 * camera orientation (it rotates with the camera): a neutral hub and three muted
 * axes (soft red/green/blue), each a ball on a SHORT, THICK rounded bar. No
 * labels, no outer ring. Colour is FIXED BY AXIS SIGN — +X/+Y/+Z are coloured
 * (ball + arm); −X/−Y/−Z are small flat-gray dots (no arm), regardless of facing.
 * Click a ball → orient + frame the model's union bbox in a SINGLE animated move
 * (one `setLookAt` whose distance is computed to frame the sphere — no separate
 * fitToSphere). Hovering an end gently brightens it. No home/fit button (the
 * Focus command zoom-to-fits the whole model when nothing is selected) and no
 * ortho/persp toggle (the bottom toolbar owns it).
 *
 * Same orient-on-click technique as a view-cube; this is the axis-ball variant.
 * The widget renders in its OWN tiny WebGL renderer (a fixed ~60px disc overlay,
 * tight around the triad) fully decoupled from the main viewport — a constant
 * on-screen size. The gizmo camera is ALWAYS ORTHOGRAPHIC (axonometric — the arms
 * never foreshorten), posed each frame to mirror the main camera's orientation,
 * so the end facing you is the axis the camera is looking down. Picking is a
 * single raycast against the six ball meshes → the nearest ball's axis direction.
 *
 * Self-mounts into the viewport overlay (like the old camera-views). Wire from
 * main.ts with one line, after the viewport exists:
 *
 *     navigationGizmo(components, viewerElement);
 *
 * @param components engine components
 * @param container optional viewport element to overlay; defaults to the first
 *                  world's renderer container.
 */

const SIZE = 60; // px, fixed on-screen widget size (~50% smaller)
const DIST = 5; // gizmo camera distance from the triad
const FRUSTUM = 1.08; // ortho half-extent — tight around the triad (little padding)
const R = 0.82; // ball distance from the hub

// Colour is FIXED BY AXIS SIGN: +X/+Y/+Z are coloured (ball + arm), the negatives
// are always flat gray — independent of facing.
const AXES: { dir: [number, number, number]; color: number; positive: boolean }[] = [
  { dir: [1, 0, 0], color: 0xcf6f6f, positive: true }, // +X soft red
  { dir: [-1, 0, 0], color: 0xcf6f6f, positive: false },
  { dir: [0, 1, 0], color: 0x86b572, positive: true }, // +Y soft green
  { dir: [0, -1, 0], color: 0x86b572, positive: false },
  { dir: [0, 0, 1], color: 0x7095c9, positive: true }, // +Z soft blue
  { dir: [0, 0, -1], color: 0x7095c9, positive: false },
];
const GRAY = new THREE.Color(0x6e7177); // negatives are always flat gray

interface Axis {
  ball: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  arm: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshBasicMaterial>;
  baseColor: THREE.Color; // fixed appearance colour (axis colour, or gray for −axes)
  baseScale: number;
  dir: THREE.Vector3;
}

export const navigationGizmo = (
  components: OBC.Components,
  container?: HTMLElement,
) => {
  const fragments = components.get(OBC.FragmentsManager);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstWorld = (): any => [...components.get(OBC.Worlds).list.values()][0];

  // ── Overlay DOM (pinned top-right, click-through except on the widget) ──
  const root = document.createElement("div");
  root.className = "nav-gizmo";
  root.style.cssText = [
    "position: absolute",
    "top: 1rem",
    "right: 1rem",
    "z-index: 20",
    "display: flex",
    "flex-direction: column",
    "align-items: center",
    "gap: 0.25rem",
    "pointer-events: none",
  ].join(";");

  // The subtle dark DISC is the canvas itself (the alpha renderer clears
  // transparent, so this soft CSS background + round clip shows through). No bold
  // outer ring — just the disc + a faint shadow for separation.
  const canvas = document.createElement("canvas");
  canvas.style.cssText = [
    `width:${SIZE}px`,
    `height:${SIZE}px`,
    "pointer-events:auto",
    "cursor:pointer",
    "border-radius:50%",
    // Opaque circular background matching the panels (BUI theme base colour).
    "background:var(--bim-ui_bg-base, var(--bim-ui_bg-contrast-20, #1b1b1f))",
    "box-shadow:0 1px 6px rgba(0,0,0,0.28)",
  ].join(";");
  root.appendChild(canvas);

  // ── Gizmo scene (own renderer, fully decoupled from the main viewport) ──
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const gizmoCam = new THREE.OrthographicCamera(
    -FRUSTUM, FRUSTUM, FRUSTUM, -FRUSTUM, 0.1, 100,
  );

  // Small neutral center hub.
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x8a8f96 }),
    ),
  );

  // Six axis ends: a ball + a SHORT, THICK rounded bar (capsule) from the hub.
  // Appearance is FIXED BY SIGN: +axes coloured (ball + arm), −axes flat gray
  // (small ball, no arm).
  const BALL_R = 0.12; // ball radius
  const ARM_R = 0.05; // arm (capsule) radius — fat
  const ARM_INNER = 0.08; // bar starts just outside the hub
  const ARM_OUTER = R - BALL_R; // bar ends just inside the ball
  const ARM_LEN = ARM_OUTER - ARM_INNER - 2 * ARM_R; // cylinder length (caps add 2·R)
  const ARM_MID = (ARM_INNER + ARM_OUTER) / 2; // centre offset along the axis
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const axes: Axis[] = [];
  for (const a of AXES) {
    const dir = new THREE.Vector3(...a.dir);
    const baseColor = a.positive ? new THREE.Color(a.color) : GRAY.clone();
    const baseScale = 1; // negatives are full-size too — just gray + no arm

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 20, 16),
      new THREE.MeshBasicMaterial({ color: baseColor.clone(), transparent: true, opacity: a.positive ? 1 : 0.7 }),
    );
    ball.position.copy(dir).multiplyScalar(R);
    ball.scale.setScalar(baseScale);
    ball.renderOrder = 2;
    scene.add(ball);

    // Capsule points along +Y by default → rotate to the axis, centre it on the
    // hub→ball midpoint. Only the coloured (+) axes show an arm.
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(ARM_R, ARM_LEN, 6, 12),
      new THREE.MeshBasicMaterial({ color: baseColor.clone(), transparent: true }),
    );
    arm.quaternion.setFromUnitVectors(_yAxis, dir);
    arm.position.copy(dir).multiplyScalar(ARM_MID);
    arm.renderOrder = 1;
    arm.visible = a.positive;
    scene.add(arm);

    axes.push({ ball, arm, dir, baseColor, baseScale });
  }

  // ── Pose the gizmo camera to mirror the main camera each frame ──
  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _lastQuat = new THREE.Quaternion(0, 0, 0, 0);
  const poseGizmo = (): boolean => {
    const main = firstWorld()?.camera?.three as THREE.Camera | undefined;
    if (!main) return false;
    main.getWorldDirection(_fwd); // direction the main camera looks (into scene)
    gizmoCam.position.copy(_fwd).multiplyScalar(-DIST); // mirror that viewpoint
    _up.set(0, 1, 0).applyQuaternion(main.quaternion); // honor camera roll
    gizmoCam.up.copy(_up);
    gizmoCam.lookAt(0, 0, 0);
    return true;
  };

  const WHITE = new THREE.Color(0xffffff);
  let hovered: Axis | null = null;

  let hoverDirty = false;
  const render = () => {
    if (!poseGizmo()) return;
    renderer.render(scene, gizmoCam);
  };

  // Render only when the orientation changed (or a hover changed) — cheap.
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    void raf;
    const main = firstWorld()?.camera?.three as THREE.Camera | undefined;
    if (!main) return;
    if (hoverDirty || !main.quaternion.equals(_lastQuat)) {
      _lastQuat.copy(main.quaternion);
      hoverDirty = false;
      render();
    }
  };

  // ── Picking: nearest ball under the cursor ─────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ballMeshes = axes.map((ax) => ax.ball);
  const pickBall = (ev: PointerEvent | MouseEvent): Axis | null => {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, gizmoCam);
    const hit = raycaster.intersectObjects(ballMeshes, false)[0];
    if (!hit) return null;
    return axes.find((ax) => ax.ball === hit.object) ?? null;
  };

  const setHover = (ax: Axis | null) => {
    if (hovered === ax) return;
    if (hovered) {
      hovered.ball.scale.setScalar(hovered.baseScale);
      hovered.ball.material.color.copy(hovered.baseColor);
    }
    hovered = ax;
    if (ax) {
      ax.ball.scale.setScalar(ax.baseScale * 1.18); // subtle grow
      ax.ball.material.color.copy(ax.baseColor).lerp(WHITE, 0.22); // gentle brighten
    }
    canvas.style.cursor = ax ? "pointer" : "default";
    hoverDirty = true;
  };

  // ── Orient + frame in ONE animated move ────────────────────────
  // Compute the framing distance ourselves and issue a SINGLE setLookAt (which
  // tweens position + target together) — no separate fitToSphere, so a gizmo
  // click is one continuous orient-and-frame motion, not two.
  const unionBox = () => {
    const box = new THREE.Box3();
    for (const model of fragments.list.values()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (model as any).box as THREE.Box3 | undefined;
      if (b && !b.isEmpty()) box.union(b);
    }
    return box;
  };

  const orientTo = (dir: THREE.Vector3) => {
    const world = firstWorld();
    const controls = world?.camera?.controls;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const main = world?.camera?.three as any;
    if (!controls?.setLookAt || !main) return;
    try {
      const box = unionBox();
      if (box.isEmpty()) return; // nothing loaded → no-op gracefully
      // Frame the actual MODEL AABB (not its bounding sphere — the sphere over-
      // estimates ~1.7× for a box, landing the camera too far). For an axis view
      // the distance is driven by the box's two PERPENDICULAR extents (fit the
      // larger against the narrower fov half-angle) plus half the depth along the
      // axis so the camera sits just outside the box. ONE animated setLookAt.
      const v = dir.clone().normalize();
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const dims = [size.x, size.y, size.z];
      const ax = Math.abs(v.x) > 0.5 ? 0 : Math.abs(v.y) > 0.5 ? 1 : 2; // dominant axis
      const depth = dims[ax] || 1;
      const perp = dims.filter((_, i) => i !== ax);
      const maxPerp = Math.max(perp[0] || 0, perp[1] || 0, 1e-3);
      if (main.isPerspectiveCamera) {
        const vHalf = THREE.MathUtils.degToRad(main.fov || 50) / 2;
        const aspect = main.aspect || 1;
        const hHalf = Math.atan(Math.tan(vHalf) * aspect);
        const fit = Math.max(0.001, Math.min(vHalf, hHalf));
        const d = (maxPerp / 2 / Math.tan(fit) + depth / 2) * 1.12;
        const eye = v.multiplyScalar(d).add(center);
        void controls.setLookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z, true);
      } else {
        // Orthographic: distance is cosmetic; place outside the box and tween the
        // ortho zoom CONCURRENTLY (same frame → one smooth motion) to fit it.
        const d = depth / 2 + maxPerp * 2;
        const eye = v.multiplyScalar(d).add(center);
        void controls.setLookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z, true);
        const fw = main.right - main.left;
        const fh = main.top - main.bottom;
        const zoom = Math.min(fw, fh) / (maxPerp * 1.12);
        if (typeof controls.zoomTo === "function" && Number.isFinite(zoom) && zoom > 0) {
          void controls.zoomTo(zoom, true);
        }
      }
    } catch (error) {
      console.warn("[navigation-gizmo] orient failed", error);
    }
  };

  // ── Interaction ────────────────────────────────────────────────
  canvas.addEventListener("pointermove", (ev) => setHover(pickBall(ev)));
  canvas.addEventListener("pointerleave", () => setHover(null));
  canvas.addEventListener("click", (ev) => {
    const b = pickBall(ev);
    if (b) void orientTo(b.dir);
  });

  // ── Mount + start ──────────────────────────────────────────────
  const resolveContainer = (): HTMLElement | undefined => {
    if (container) return container;
    const world = firstWorld();
    const canvasEl = world?.renderer?.three?.domElement as HTMLElement | undefined;
    return (canvasEl?.parentElement as HTMLElement | undefined) ?? undefined;
  };
  const host = resolveContainer();
  if (host) {
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(root);
  } else {
    console.warn("[navigation-gizmo] no viewport found to overlay; append the returned element manually");
  }

  render(); // initial paint
  loop();

  return root;
};
