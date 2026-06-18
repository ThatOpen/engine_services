import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

/**
 * WALKTHROUGH / first-person navigation — a headless CONTROLLER (no UI).
 *
 * FLY mode (no raycasts): WASD / arrow keys move the eye along the view
 * direction — forward/back on the full look vector (so looking up + W ascends),
 * strafe on the camera right — E/Q add explicit world up/down, and LEFT-button
 * drag turns the view. There is NO collision and NO floor-follow/gravity: it's
 * pure free flight (collision can be layered back on later as an option). The
 * orbit anchor (pivot dot) is off for the whole session, and the Hoverer is
 * GATED on stillness — off while moving/looking, on when standing still so you
 * can inspect elements from where you stand. `toggle()` enters/exits; entering
 * seeds the view from the current orbit pose, and exiting KEEPS the walk camera —
 * orbit controls are re-enabled from wherever the user walked to (no snap back).
 * Move speed (and an as-yet unused eye height, kept for the future collision
 * mode) are set via setters.
 *
 * This module owns ONLY the engine + state — it renders no button. It returns a
 * controller so a host (e.g. the bottom action toolbar) can drive it from a
 * single mdi:walk icon and reflect the active state via `onChange`.
 *
 * Movement is frame-rate independent (everything scales by dt). Defaults are in
 * MODEL UNITS (meters-ish); the speed setter adapts to other units.
 *
 * CAMERA DRIVE: drives the LIVE viewport camera. Orbit INPUT is disabled
 * (controls.enabled = false) AND the OBC camera component is paused
 * (camera.enabled = false) so its per-frame controls.update() can't revert us;
 * we then write `world.camera.three` (position + quaternion + matrix) directly
 * each frame — that's what the renderer reads, so movement is immediate.
 * Mouse-look is LEFT-button press-and-drag only (NO pointer lock — the platform
 * iframe is sandboxed without it, and requesting it only logs a "Blocked pointer
 * lock" error). On exit, orbit controls resume FROM the current walk pose (the
 * pivot is seated a short distance ahead of the eye); projection stays perspective.
 *
 * @param components engine components
 * @returns a {@link WalkthroughController}
 */

export interface WalkthroughController {
  /** Enter walkthrough if inactive, exit if active. */
  toggle(): void;
  /** Explicitly enter (no-op if already active). */
  enter(): void;
  /** Explicitly exit (no-op if inactive). */
  exit(): void;
  /** Whether walkthrough mode is currently active. */
  isActive(): boolean;
  /** Subscribe to active-state changes. Returns an unsubscribe fn. */
  onChange(listener: (active: boolean) => void): () => void;
  /** Set the eye height (model units, > 0). */
  setEyeHeight(value: number): void;
  /** Set the horizontal move speed (model units/sec, > 0). */
  setSpeed(value: number): void;
}

// Defaults in model units (assume meters). Eye height + speed are user-adjustable.
const DEFAULT_EYE = 1.7; // eye height above the floor
const DEFAULT_SPEED = 3.5; // horizontal move speed, units/sec
const RUN_MULT = 2.4; // Shift = run
const EXIT_PIVOT_DIST = 5; // model units ahead to seat the orbit pivot on exit
const MOUSE_SENS = 0.0022; // radians per pixel of mouse movement
const PITCH_LIMIT = Math.PI / 2 - 0.05; // clamp look up/down just shy of straight

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWorld = any;

export const walkthrough = (components: OBC.Components): WalkthroughController => {
  const fragments = components.get(OBC.FragmentsManager);
  const hoverer = components.get(OBF.Hoverer);

  const firstWorld = (): AnyWorld =>
    [...components.get(OBC.Worlds).list.values()][0];

  // ── State ──────────────────────────────────────────────────────
  let active = false;
  let eyeHeight = DEFAULT_EYE;
  let moveSpeed = DEFAULT_SPEED;

  // Active-state listeners (host UI reflects the toggle through these).
  const listeners = new Set<(active: boolean) => void>();
  const notify = () => {
    for (const cb of listeners) {
      try {
        cb(active);
      } catch (error) {
        console.warn("[walkthrough] onChange listener threw", error);
      }
    }
  };

  // First-person look (radians). Built into a YXZ euler each frame.
  let yaw = 0;
  let pitch = 0;
  const pos = new THREE.Vector3();

  const keys = new Set<string>();
  let raf = 0;
  let lastT = 0;
  let lookDirty = false;
  // Latches true on the FIRST real input (move or look). Until then the rendered
  // camera is left EXACTLY as it was on enter — so entering, and spamming the
  // toggle, never nudges/rotates the camera (the per-frame write is gated on it,
  // and exit only re-seats the orbit pivot when the camera was actually driven).
  let touched = false;

  // The OBC camera component's own `enabled` flag, paused during walkthrough so
  // its per-frame controls.update() can't revert our direct camera writes.
  let savedCamEnabled: boolean | null = null;
  // The Hoverer's original `enabled`. During walkthrough hover is GATED on
  // stillness (off while moving/looking, on when standing still); restored on exit.
  let savedHovererEnabled: boolean | null = null;
  // The world's `dynamicAnchor` (orbit pivot dot), disabled for the whole session
  // so no pivot appears while walking; restored on exit.
  let savedAnchor: boolean | null = null;
  let loggedKey = false; // one-shot: confirm WASD actually reaches the handler

  // Hover gate: enable the Hoverer only when STILL (no movement keys, not
  // dragging), and only if it was originally enabled. Guarded so we only write +
  // clear on a transition, not every frame.
  const applyHoverGate = (allowHover: boolean) => {
    if (savedHovererEnabled === null) return; // hoverer unavailable
    const want = allowHover ? savedHovererEnabled : false;
    try {
      if (hoverer.enabled !== want) {
        hoverer.enabled = want;
        if (!want) hoverer.clear?.();
      }
    } catch {
      /* non-fatal */
    }
  };

  // Reusable scratch (no per-frame allocation in the hot path).
  const _euler = new THREE.Euler(0, 0, 0, "YXZ");
  const _quat = new THREE.Quaternion();
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _step = new THREE.Vector3();
  const _WORLD_UP = new THREE.Vector3(0, 1, 0); // E/Q vertical axis

  // ── Direction vectors from yaw/pitch ───────────────────────────
  // FLY mode: forward is the FULL view direction (includes pitch), so looking up
  // + W ascends and looking down + S descends — true free flight, no raycasts.
  const updateDirs = () => {
    _euler.set(pitch, yaw, 0, "YXZ");
    _quat.setFromEuler(_euler);
    _forward.set(0, 0, -1).applyQuaternion(_quat);
    _right.set(1, 0, 0).applyQuaternion(_quat);
  };

  // ── Per-frame step ─────────────────────────────────────────────
  const tick = (now: number) => {
    if (!active) return;
    const world = firstWorld();
    const controls = world?.camera?.controls;
    if (!controls) {
      raf = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min((now - lastT) / 1000, 0.05); // clamp big gaps (tab switch)
    lastT = now;
    updateDirs();

    // FLY mode (no raycasts): WASD moves the eye along the view direction —
    // forward/back on _forward (full look dir, so up/down too), strafe on _right.
    // E / Q add explicit WORLD vertical (+Y / −Y) so the user can ascend/descend
    // without relying on pitch+W.
    let mf = 0;
    let mr = 0;
    let mv = 0;
    if (keys.has("w") || keys.has("arrowup")) mf += 1;
    if (keys.has("s") || keys.has("arrowdown")) mf -= 1;
    if (keys.has("d") || keys.has("arrowright")) mr += 1;
    if (keys.has("a") || keys.has("arrowleft")) mr -= 1;
    if (keys.has("e")) mv += 1;
    if (keys.has("q")) mv -= 1;
    let moved = false;
    if (mf !== 0 || mr !== 0 || mv !== 0) {
      const speed = (keys.has("shift") ? moveSpeed * RUN_MULT : moveSpeed) * dt;
      _step
        .set(0, 0, 0)
        .addScaledVector(_forward, mf)
        .addScaledVector(_right, mr)
        .addScaledVector(_WORLD_UP, mv);
      if (_step.lengthSq() > 0) {
        _step.normalize().multiplyScalar(speed);
        pos.add(_step);
        moved = true;
      }
    }

    // Hover only when STANDING STILL — off while moving (any WASD/E/Q held) or
    // looking (left-drag). Lets the user inspect elements from where they stand.
    applyHoverGate(mf === 0 && mr === 0 && mv === 0 && !dragging);

    // Drive the LIVE camera DIRECTLY every frame — but ONLY once the user has
    //    actually moved or looked. The OBC camera component's update() is paused
    //    (see enter), so camera-controls' update() can't run and revert us — we
    //    own the camera. Gating on `touched` means entering (and spamming
    //    enter/exit) leaves the rendered pose byte-for-byte untouched: no
    //    yaw/pitch round-trip re-orientation, no drift. `_quat` (from yaw/pitch)
    //    orients it; pos is the eye. Writing the THREE camera + its world matrix
    //    is what the renderer reads, so movement is immediate and never fought.
    if (moved || lookDirty) touched = true;
    lookDirty = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cam = world?.camera?.three as any;
    if (cam && touched) {
      cam.position.set(pos.x, pos.y, pos.z);
      cam.quaternion.copy(_quat);
      cam.updateMatrixWorld(true);
    }
    raf = requestAnimationFrame(tick);
  };

  // ── Enter / exit ───────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "e", "q", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
      if (!loggedKey) {
        loggedKey = true;
        console.log("[walkthrough] movement key reached handler:", k); // confirms key capture
      }
      keys.add(k);
      if (k.startsWith("arrow")) e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

  // Mouse-look: only while a LEFT-button drag is in progress (see pointerdown).
  // movementX/Y are valid during a drag with no pointer lock needed.
  let dragging = false;
  const onMouseMove = (e: MouseEvent) => {
    if (!active || !dragging) return;
    yaw -= e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
    lookDirty = true;
  };
  // Look = LEFT-button press-and-drag ONLY. We never request pointer lock — the
  // platform sandboxes the viewer in an iframe without `allow-pointer-lock`, so
  // requestPointerLock only logs a "Blocked pointer lock" error. movementX/Y are
  // valid during a drag regardless, so drag-look needs no lock.
  const onCanvasPointerDown = (e: PointerEvent) => {
    if (!active || e.button !== 0) return; // left button only
    dragging = true;
    hideHint();
  };
  const onWindowPointerUp = () => {
    dragging = false;
  };

  let canvas: HTMLCanvasElement | null = null;

  // ── Hint overlay (discoverability: how to drive walkthrough) ───
  let hintEl: HTMLElement | null = null;
  let hintTimer: number | undefined;
  const hideHint = () => {
    if (hintTimer !== undefined) {
      clearTimeout(hintTimer);
      hintTimer = undefined;
    }
    if (hintEl) {
      hintEl.remove();
      hintEl = null;
    }
  };
  const showHint = () => {
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    hideHint();
    const el = document.createElement("div");
    el.textContent = "Left-drag to look · WASD move · E/Q up/down · click Walk to exit";
    el.style.cssText = [
      "position: absolute",
      "left: 50%",
      "bottom: 4.5rem",
      "transform: translateX(-50%)",
      "z-index: 30",
      "pointer-events: none",
      "padding: 0.35rem 0.7rem",
      "font-size: 0.75rem",
      "white-space: nowrap",
      "color: var(--bim-ui_bg-contrast-100, #e3e3e3)",
      "background: rgba(20,20,24,0.85)",
      "border: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.2))",
      "border-radius: var(--bim-ui_size-2xs, 0.375rem)",
      "box-shadow: 0 2px 10px rgba(0,0,0,0.35)",
    ].join(";");
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(el);
    hintEl = el;
    hintTimer = window.setTimeout(hideHint, 4500);
  };

  const enter = () => {
    const world = firstWorld();
    const controls = world?.camera?.controls;
    const projection = world?.camera?.projection;
    canvas = world?.renderer?.three?.domElement ?? null;
    if (!controls || !canvas) {
      console.warn("[walkthrough] no world camera/canvas to drive");
      return;
    }
    console.log(
      "[walkthrough] enter — driving live camera",
      world?.camera?.three?.type,
      "| controls bound to rendered camera; loop starting",
    );
    // Seed the first-person view from the ACTUAL rendered camera transform (world
    // position + quaternion-forward), NOT controls.getPosition/getTarget — so the
    // view doesn't move at all on enter (no eye-height reset, no re-orient). Same
    // ground-truth source exit uses, so enter and exit are symmetric.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cam = world?.camera?.three as any;
    const p = new THREE.Vector3();
    if (cam) {
      // Force the world matrix current first — reading a stale matrixWorld (e.g.
      // mid-frame right after the previous exit's setLookAt) would seed a pose
      // that's slightly off, and repeated enter/exit would compound it.
      cam.updateMatrixWorld(true);
      cam.getWorldPosition(p);
      _forward.set(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    } else {
      controls.getPosition(p);
      const t = new THREE.Vector3();
      controls.getTarget(t);
      _forward.copy(t).sub(p).normalize();
    }

    // First-person must be perspective. (Only an Orthographic orbit re-projects on
    // enter; a Perspective orbit keeps the exact same view.)
    if (projection?.current === "Orthographic") void projection.set?.("Perspective");

    // Reconstruct yaw/pitch from the live forward → the first tick re-applies the
    // identical orientation (orbit cameras have no roll, so this is exact).
    yaw = Math.atan2(_forward.x, -_forward.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, _forward.y)));
    pos.copy(p);
    // FLY mode: enter exactly at the current eye point — no floor snap.

    controls.enabled = false; // stop orbit INPUT
    // Pause the OBC camera component's per-frame update so its controls.update()
    // can't re-apply the orbit pose and revert our direct camera writes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const camComp = world?.camera as any;
    // Snapshot the Hoverer's enabled state; the per-frame gate (applyHoverGate)
    // then toggles it by stillness. Clear any stuck overlay on entry.
    try {
      savedHovererEnabled = typeof hoverer?.enabled === "boolean" ? hoverer.enabled : null;
      hoverer?.clear?.();
    } catch {
      /* hoverer not ready — non-fatal */
    }
    // Disable the orbit anchor (pivot dot) for the whole walkthrough — no pivot
    // should appear while walking. Restored on exit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = world as any;
    if (w && typeof w.dynamicAnchor === "boolean") {
      savedAnchor = w.dynamicAnchor;
      w.dynamicAnchor = false;
    }
    savedCamEnabled = typeof camComp?.enabled === "boolean" ? camComp.enabled : null;
    if (savedCamEnabled !== null) camComp.enabled = false;
    active = true;
    dragging = false;
    loggedKey = false;
    // Start "untouched": the first tick must NOT write the camera (that would
    // re-orient via the lossy yaw/pitch round-trip). Only real input sets it.
    touched = false;
    lookDirty = false;
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onWindowPointerUp);
    document.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("pointerdown", onCanvasPointerDown);
    // Start the movement loop + notify. Look is press-and-drag only — no
    // pointer-lock request (the sandboxed iframe blocks it and only logs an
    // error); WASD fly + drag-look need no lock.
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
    notify();
    showHint();
  };

  const exit = () => {
    if (!active) return;
    active = false;
    dragging = false;
    keys.clear();
    hideHint();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("pointerup", onWindowPointerUp);
    document.removeEventListener("mousemove", onMouseMove);
    canvas?.removeEventListener("pointerdown", onCanvasPointerDown);

    const world = firstWorld();
    const controls = world?.camera?.controls;
    // Re-enable the OBC camera component so its update loop (and orbit) resumes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const camComp = world?.camera as any;
    if (savedCamEnabled !== null && camComp) camComp.enabled = savedCamEnabled;
    savedCamEnabled = null;
    // Restore the Hoverer's original enabled state and the orbit anchor.
    try {
      if (savedHovererEnabled !== null) hoverer.enabled = savedHovererEnabled;
    } catch {
      /* non-fatal */
    }
    savedHovererEnabled = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = world as any;
    if (w && savedAnchor !== null) w.dynamicAnchor = savedAnchor;
    savedAnchor = null;
    if (controls) {
      controls.enabled = true;
    }
    // Only re-seat the orbit pivot if the user ACTUALLY drove the camera this
    // session. If nothing was touched (e.g. spamming the toggle), the camera is
    // exactly where orbit left it, its target is still valid, and re-posing would
    // only risk nudging it — so we leave it completely alone (true no-op exit).
    if (controls && touched) {
      // KEEP the walk camera: re-seed orbit controls FROM the ACTUAL rendered
      // first-person transform (ground truth — not our yaw/pitch state, in case
      // they ever diverge), with the orbit pivot a short distance ahead along the
      // look direction. No snap-back to the pre-walk pose, no re-frame. Stays in
      // perspective (the walk projection).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cam = world?.camera?.three as any;
      const eye = new THREE.Vector3();
      const fwd = new THREE.Vector3(0, 0, -1);
      if (cam) {
        cam.getWorldPosition(eye);
        fwd.applyQuaternion(cam.quaternion).normalize();
      } else {
        updateDirs();
        eye.copy(pos);
        fwd.copy(_forward);
      }
      // The orbit pivot sits `dist` ahead along the look dir. CRITICAL: the eye↔
      // target distance must stay within the controls' min/max, or setLookAt CLAMPS
      // it by MOVING the eye (the intermittent exit jump — only when dolly limits
      // are active). Clamp the pivot distance into [minDistance, maxDistance] so the
      // resting distance is valid and the eye stays EXACTLY where the user stood.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cc = controls as any;
      const minD = typeof cc.minDistance === "number" ? cc.minDistance : 0;
      const maxD = typeof cc.maxDistance === "number" ? cc.maxDistance : Infinity;
      let dist = EXIT_PIVOT_DIST;
      if (Number.isFinite(minD) && dist < minD) dist = minD;
      if (Number.isFinite(maxD) && dist > maxD) dist = maxD;
      const setPose = () =>
        controls.setLookAt(
          eye.x, eye.y, eye.z,
          eye.x + fwd.x * dist,
          eye.y + fwd.y * dist,
          eye.z + fwd.z * dist,
          false,
        );
      void setPose();
      // Apply immediately so the next render is already at the walk pose...
      try {
        controls.update(0);
      } catch {
        /* some controls builds reject delta 0 — harmless */
      }
      // ...and guard against any engine system that reframes the camera on the
      // orbit→resume transition (auto-anchor / aspect / fit). Re-assert the pose
      // for a few frames; stop as soon as it holds. Logs once if it ever drifts,
      // so a persistent reframer is visible instead of silently winning.
      if (cam) {
        let tries = 0;
        const hold = () => {
          if (active) return; // a new walkthrough started — stop
          const cur = new THREE.Vector3();
          cam.getWorldPosition(cur);
          if (cur.distanceToSquared(eye) > 1e-6) {
            if (tries === 0) {
              console.log("[walkthrough] exit pose drifted — re-asserting", cur.distanceTo(eye));
            }
            void setPose();
            // Cap tight: the transition reframe happens in the first frame(s);
            // a low cap avoids fighting a fast user orbit started right after.
            if (++tries < 3) requestAnimationFrame(hold);
          }
        };
        requestAnimationFrame(hold);
      }
    }
    notify();
  };

  const toggle = () => (active ? exit() : enter());

  // A model unload while walking → bail out safely (geometry it stood on is gone).
  fragments.list.onItemDeleted.add(() => {
    if (active) exit();
  });

  // ── Controller (no UI) ─────────────────────────────────────────
  return {
    toggle,
    enter: () => {
      if (!active) enter();
    },
    exit: () => {
      if (active) exit();
    },
    isActive: () => active,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setEyeHeight: (value) => {
      if (Number.isFinite(value) && value > 0) eyeHeight = value;
    },
    setSpeed: (value) => {
      if (Number.isFinite(value) && value > 0) moveSpeed = value;
    },
  };
};
