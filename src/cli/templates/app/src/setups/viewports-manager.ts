import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { ViewportsManager } from "@thatopen/services";

// ─── RAW VIEWER + LAYER 1: deferred postproduction ───────────────────
// Building back up from the bare viewer one block at a time to find the orbit
// cost. ADDED so far: deferred postproduction (COLOR_PEN_SHADOWS). Still OMITTED:
// adaptive resolution, Hoverer, Highlighter/Raycaster, Outliner, frame overlay.
// Full version saved at `viewports-manager.full.ts.bak`.
export const viewportsManager = async (components: OBC.Components) => {
  const viewports = components.get(ViewportsManager);
  const { element, world } = await viewports.create();

  const renderer = world.renderer!;
  renderer.showLogo = false;

  // A <canvas> defaults to display:inline, which leaves a few px of baseline
  // descender space below it → a small margin at the viewer's bottom. Block kills it.
  renderer.three.domElement.style.display = "block";

  // Give the viewer the same card chrome as the bim-panels (1px contrast-20
  // border + 0.75rem radius), so it reads as a card alongside them.
  element.style.border = "1px solid var(--bim-ui_bg-contrast-20)";
  element.style.borderRadius = "0.75rem";
  element.style.overflow = "hidden";

  // Auto-anchor: library dynamicAnchor picks the surface on left-press (single
  // pick, no per-move cost) and sets the orbit pivot; we render a dot off its
  // onDynamicAnchorSet/Clear events (wired below).
  world.dynamicAnchor = true;
  world.camera.threePersp.near = 1;
  world.camera.threePersp.updateProjectionMatrix();

  await world.camera.controls.setLookAt(20, 20, 20, 0, 0, 0);

  // ── Enhanced camera controls (library feature, opt-in) ───────────────
  // Ortho-only: faster, proportional frustum zoom in orthographic (fixes the slow
  // ortho wheel zoom). Perspective zoom + orbit use the library defaults. Plan
  // mode is left untouched. Cleaned up automatically on camera dispose.
  world.camera.setupEnhancedControls({ orthoZoomSpeed: 0.15 });

  // ── Resize reconcile + "light resize" ────────────────────────────
  // While the window/container is actively resizing, the per-frame reconcile
  // would reallocate the deferred G-buffer every frame (expensive) → fps drops
  // during the drag. So: the MOMENT the size starts changing we turn
  // postproduction OFF (cheap forward render) and only do the lightweight
  // setSize each frame; the heavy `applyPostproductionSize` + postproduction
  // restore happen ONCE, after a quiet BUFFER (no size change for ~250ms), so it
  // never flickers on/off during a continuous drag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let postpro: any = null; // captured once the deferred pipeline is configured
  let resizing = false;
  let postproWasEnabled = true;
  let hovererWasEnabled = true;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const RESIZE_BUFFER = 250; // ms of stillness before restoring postproduction

  let lastW = -1;
  let lastH = -1;
  let lastDpr = -1;
  let lastChangeAt = -Infinity; // performance.now() of the previous size change
  const RAPID_MS = 200; // back-to-back changes faster than this ⇒ a live drag
  const applyResize = () => {
    if (!renderer.currentWorld) return;
    const w = element.clientWidth;
    const h = element.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (w === 0 || h === 0) return;
    if (w === lastW && h === lastH && dpr === lastDpr) return;
    lastW = w;
    lastH = h;
    lastDpr = dpr;

    const now = performance.now();
    const rapid = now - lastChangeAt < RAPID_MS;
    lastChangeAt = now;

    if (rapid && !resizing) {
      // SUSTAINED changing (a live window/container DRAG): switch to the cheap
      // path — the per-frame `renderer.resize()` realloc is what tanks fps, so we
      // do NOT touch the buffer during the drag. The canvas is set to CSS 100%
      // and simply STRETCHES the existing (fixed-size) buffer — cheap, slightly
      // soft. We also kill mouse events and drop postproduction. The one real
      // resize happens on settle.
      resizing = true;
      const canvas = renderer.three.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      element.style.pointerEvents = "none";
      if (postpro) {
        postproWasEnabled = postpro.enabled;
        postpro.enabled = false;
      }
      // No hover-highlight while actively resizing/dragging.
      try {
        const hv = components.get(OBF.Hoverer);
        hovererWasEnabled = hv.enabled;
        hv.enabled = false;
      } catch {
        /* hoverer not set up yet */
      }
    } else if (!rapid && !resizing) {
      // ISOLATED, one-shot change — e.g. a LAYOUT switch (panel docks/undocks),
      // which is INSTANTANEOUS. Do the full, correct resize right now and KEEP
      // postproduction on, so there's no flicker/disable on layout changes. If
      // this turns out to be the first frame of a drag, the next (rapid) change
      // flips us into the cheap path above.
      renderer.three.setPixelRatio(dpr);
      renderer.resize();
      world.camera.updateAspect();
      renderer.applyPostproductionSize?.();
      // Force one re-composite at the new size. The deferred pipeline only
      // recomposites on demand, so without this a stale frame (e.g. the clip
      // section's overlay rendering white at the wrong resolution) persists until
      // the next camera move.
      renderer.update();
    }

    // (Re)arm the settle buffer: finalize a DRAG once the size has been stable
    // for RESIZE_BUFFER ms (one real resize + restore interaction/postproduction).
    // For a one-shot change `resizing` stays false, so this is a no-op.
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      if (!resizing) return; // one-shot already handled immediately above
      resizing = false;
      element.style.pointerEvents = "";
      renderer.three.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.resize(); // reallocates to the settled container size
      world.camera.updateAspect();
      renderer.applyPostproductionSize?.();
      if (postpro) postpro.enabled = postproWasEnabled;
      // Re-composite at the settled size so the section overlay (and everything)
      // refreshes immediately instead of staying stale/white until a camera move.
      renderer.update();
      try {
        components.get(OBF.Hoverer).enabled = hovererWasEnabled;
      } catch {
        /* hoverer not set up */
      }
    }, RESIZE_BUFFER);
  };
  window.addEventListener("resize", applyResize);
  new ResizeObserver(applyResize).observe(element);
  renderer.onBeforeUpdate.add(applyResize);

  // ── LAYER 3: Hover highlight (Hoverer) ────────────────────────────
  // Animated proxy-mesh overlay on whichever element is under the cursor. Its
  // material is isolated into the base pass (below) so it shows over the
  // deferred composite. The Hoverer self-suppresses during camera drags.
  const hoverer = components.get(OBF.Hoverer);
  hoverer.world = world;
  // Continuous hover-follow (MOUSE_MOVE, the default). This used to drop FPS
  // because the picker's per-frame GPU readback stalled the frame — now fixed in
  // the library (FastModelPicker reads back asynchronously), so continuous hover
  // runs at full framerate.
  hoverer.enabled = true;
  hoverer.material = new THREE.MeshBasicMaterial({
    color: 0xb79bf0,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
  });

  // ── LAYER 4: click selection (Highlighter + Raycaster + Outliner) ──
  // GPU-picked click selection; rendered as an outline via the Outliner (wired
  // in setupPostproduction once the pipeline exists). selectMaterialDefinition
  // null = no fragment recolor (the Outliner draws the selection instead).
  components.get(OBC.Raycasters).get(world);
  const highlighter = components.get(OBF.Highlighter);
  highlighter.setup({ world, selectMaterialDefinition: null });

  // ── Auto-anchor pivot dot (driven by the library's dynamicAnchor) ──
  // dynamicAnchor picks the surface on left-press and fires onDynamicAnchorSet
  // with the pivot; we render a dot there. The dot is an HTML overlay projected
  // from the 3D pivot each frame — NOT a 3D mesh — so its colour is the EXACT app
  // accent purple (#6528d7); a 3D mesh gets recoloured by the deferred composite.
  if (!element.style.position) element.style.position = "relative";
  const anchorDotEl = document.createElement("div");
  anchorDotEl.style.cssText =
    "position:absolute; width:13px; height:13px; border-radius:50%;" +
    "background:#6528d7; transform:translate(-50%,-50%);" +
    "pointer-events:none; display:none; z-index:5;" +
    "box-shadow:0 0 0 2px rgba(255,255,255,0.35);";
  element.appendChild(anchorDotEl);
  let anchorWorld: THREE.Vector3 | null = null;
  const positionAnchorDot = () => {
    if (!anchorWorld) return;
    const ndc = anchorWorld.clone().project(world.camera.three);
    anchorDotEl.style.left = `${(ndc.x * 0.5 + 0.5) * element.clientWidth}px`;
    anchorDotEl.style.top = `${(-ndc.y * 0.5 + 0.5) * element.clientHeight}px`;
  };
  // Cache the pivot on press; show the dot only once a real drag starts (so a
  // click-to-select doesn't flash it).
  let anchorShown = false;
  world.onDynamicAnchorSet.add((point: THREE.Vector3) => {
    anchorWorld = point.clone();
    anchorShown = false;
    positionAnchorDot();
  });
  world.onDynamicAnchorClear.add(() => {
    anchorWorld = null;
    anchorShown = false;
    anchorDotEl.style.display = "none";
  });
  const DRAG_THRESHOLD = 6; // px before the dot appears
  let pressStart: { x: number; y: number } | null = null;
  element.addEventListener("pointerdown", (e) => {
    if (e.button === 0) pressStart = { x: e.clientX, y: e.clientY };
  });
  element.addEventListener("pointermove", (e) => {
    if (!pressStart || !anchorWorld || anchorShown) return;
    const dx = e.clientX - pressStart.x;
    const dy = e.clientY - pressStart.y;
    if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
      anchorShown = true;
      positionAnchorDot();
      anchorDotEl.style.display = "block";
    }
  });
  const clearPress = () => {
    pressStart = null;
  };
  element.addEventListener("pointerup", clearPress);
  element.addEventListener("pointercancel", clearPress);
  // Keep the dot glued to the 3D pivot as the camera orbits around it.
  renderer.onBeforeUpdate.add(positionAnchorDot);

  // ── LAYER 1: deferred postproduction (NO adaptive resolution yet) ──
  // Allocate the deferred pipeline once the viewport has a real (non-zero) size.
  const size = new THREE.Vector2();
  let configured = false;
  const setupPostproduction = () => {
    if (configured || !renderer.currentWorld) return;
    renderer.three.getSize(size);
    if (size.x < 2 || size.y < 2) return;

    const { postproduction } = renderer;
    // The platform's app iframe can fire an early resize before the deferred
    // pipeline is allocated. Bail WITHOUT marking `configured` so a later
    // resize / world-change retries once it exists — instead of throwing on
    // `postproduction.enabled` and leaving the pipeline half-configured.
    if (!postproduction) return;
    configured = true;

    postpro = postproduction; // let the resize handler toggle it during drags
    postproduction.enabled = true;
    postproduction.style = OBF.PostproductionAspect.COLOR_PEN_SHADOWS;

    // Keep the floor grid + hover overlay visible over the deferred composite.
    const grid = components.get(OBC.Grids).list.get(world.uuid);
    if (grid) postproduction.basePass.isolatedMaterials.push(grid.material);
    postproduction.basePass.isolatedMaterials.push(hoverer.material);

    void postproduction.deferred;
    postproduction.mode = OBF.PostproductionMode.DEFERRED;

    // ── LAYER 4 (cont.): selection Outline ──────────────────────────
    // The Outliner draws through the postproduction pipeline, so wire it after
    // the pipeline is up. Selecting (via the Highlighter "select" style) outlines
    // the element; deselecting removes it.
    const outliner = components.get(OBF.Outliner);
    outliner.world = world;
    outliner.color = new THREE.Color(0x6528d7);
    outliner.fillColor = new THREE.Color(0x6528d7);
    outliner.fillOpacity = 0.4;
    outliner.enabled = true;
    highlighter.events.select.onHighlight.add((map) => outliner.addItems(map));
    highlighter.events.select.onClear.add((map) => outliner.removeItems(map));

    // NOTE: adaptive resolution intentionally OFF here to measure the pipeline's
    // raw orbit cost. `renderer.cssSize`/`adaptiveResolution` come in a later layer.
  };
  renderer.onWorldChanged.add(setupPostproduction);
  renderer.onResize.add(setupPostproduction);
  setupPostproduction();

  return element;
};
