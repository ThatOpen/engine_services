import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { TilesRenderer } from "3d-tiles-renderer";
import { SparkRenderer } from "@sparkjsdev/spark";

import { HiddenTilesPlugin } from "./reality-capture/lib/hidden-tiles-plugin";
import { PointTilePlugin, setPointSize as setPointSizePx } from "./reality-capture/lib/point-tile-plugin";
import { SplatTilePlugin } from "./reality-capture/lib/splat-tile-plugin";
import { frame } from "./reality-capture/lib/render-frame";

// Reality-capture (standard loose 3D Tiles) viewer for bim-viewer.
//
// SELF-CONTAINED + ISOLATED. This renders a standard 3D Tiles dataset (point
// clouds or Gaussian splats) in its OWN three.js WebGLRenderer + Scene + camera
// + orbit loop, mounted in an overlay over the app — it deliberately does NOT
// touch bim-viewer's OBC world. That world runs a deferred PEN/MRT
// postproduction pipeline that points/splats can't render through, so they get
// an isolated forward renderer instead.
//
// STORAGE MODEL: the main visible file is a standard `tileset.json`; each tile's
// `content.uri` is a relative path (`tiles/n…_d….spz` for splats, `…_d….pnt`
// for points), and the tileset carries a top-level `hiddenFiles` map of
// `content.uri -> hiddenFileId`. Tiles live as platform HIDDEN files and are
// streamed ONE FILE PER TILE via `client.downloadHiddenFile(id)` through the
// HiddenTilesPlugin's fetchData hook. The Q1 LRU/count-budget governor bounds
// how many tiles are resident/loading at once.
//
// The render core (Point/Splat plugins, decode worker, render-frame) is the
// platform_cde tiles-viewer prototype copied into ./reality-capture/lib. Only
// this outer controller is new: it mounts an overlay (or a caller-supplied
// container) instead of a CDEManager dialog, and takes the file bytes from the
// platform client.
//
// CLIENT WIRING: bim-viewer creates its PlatformClient in main.ts via
// `PlatformClient.fromPlatformContext()` and hands it to the panels (e.g.
// `filesPanel(components, client)`). There is no clean singleton/OBC component
// holding it, so this factory takes the client too — pass it in, or call
// `controller.setClient(client)` before `loadThreeTZ`. See the report for the
// exact wiring point the files-panel owner must hook.

const BG = new THREE.Color(0x11151a);

type Format = "points" | "splats";

// ---------------------------------------------------------------------------
// NAV-PERF tuning (ported from the reality-capture-viewer prototype's main.ts).
// Spark re-sorts EVERY resident splat each frame, so smoothness is bounded by
// the splat COUNT actually drawn — not resolution. Three levers, in order of
// impact:
//   1. LRU cache so non-visible tiles get evicted -> Spark's global buffer only
//      holds the visible cut (the 4.6 -> 70 fps win in the prototype).
//   2. A count-budget governor: while MOVING, raise errorTarget to cap the
//      visible primitive count to a motion budget; while PARKED, step
//      errorTarget DOWN toward a floor to refine coarse -> fine.
//   3. An idle snapshot: once parked + refined + tile queues empty, render the
//      heavy scene ONCE into a render target and just BLIT that texture each
//      frame (cheap), capping the live set back to "light" so the next motion
//      is instant. On camera move, drop the frozen texture and render live.
// ---------------------------------------------------------------------------

// 100% slider reference unused here; budgets are fixed to the prototype values.
const SPLAT_MOTION_BUDGET = 200_000; // splat-count cap while moving
const POINT_MOTION_BUDGET = 1_500_000; // point-count cap while moving (points cheaper than splats)
const IDLE_POINT_BUDGET = 25_000_000; // cap when parked (bounds the snapshot capture)

// errorTarget clamps (mirror the prototype's scaleET clamp + refine floors).
const ET_MIN = 8;
const ET_MAX = 8192;
const SPLAT_REFINE_FLOOR = 8;
const POINT_REFINE_FLOOR = 14;
const SPLAT_REFINE_STEP = 0.78; // gentle (Spark rebuilds its global sort on each add)
const POINT_REFINE_STEP = 0.55; // bigger jumps -> reads as "all at once"

// errorTarget the governor settles on while moving — remembered so we can snap
// the live set back to it after taking the idle snapshot.
const SPLAT_MOTION_ET = 48;
const POINT_MOTION_ET = 16;

// PHASE 1 occlusion pass depth convention. W3's deferred depth is REVERSED-Z
// (DEPTH_COMPONENT32F, far=0/near=1). Per W3's converged hook (d2528f06): Spark's
// draw doesn't ride three's auto depthFunc inversion, so we set GreaterEqualDepth
// on the splat materials OURSELVES to match reversed-Z. Set this false ONLY if a
// live test shows occlusion INVERTED (splats hidden where they should show), i.e.
// three did auto-invert after all → default LessEqualDepth would be correct.
const OCCLUSION_USE_GEQUAL = true;

// Apply the reversed-Z depth state to every resident SplatMesh in a scene so a
// separate splat render call (the deferred occlusion pass OR the postpro-off
// fallback) occludes correctly. depthWrite stays off (never touch the borrowed
// BIM depth). Cheap per-call property assigns.
function applySplatDepthState(scene: THREE.Object3D) {
  if (!OCCLUSION_USE_GEQUAL) return;
  scene.traverse((o: any) => {
    const m = o.material;
    if (m && typeof o.opacity === "number" && o.userData?.splatCount) {
      m.depthFunc = THREE.GreaterEqualDepth;
      m.depthWrite = false;
    }
  });
}

// Set tiles.lruCache min/max sizes so non-visible tiles are evicted and Spark's
// global buffer only holds the visible cut. Mirrors prototype configureCache().
function configureCache(t: TilesRenderer, maxItems: number, maxMB: number) {
  const lru = (t as any).lruCache;
  if (!lru) return;
  lru.maxSize = maxItems;
  lru.minSize = Math.floor(maxItems * 0.66);
  lru.maxBytesSize = maxMB * 1024 * 1024;
  lru.minBytesSize = Math.floor(maxMB * 0.66) * 1024 * 1024;
}

// Tile streaming concurrency: 1 while moving (spread the per-tile rebuild spikes
// for smoothness), higher while parked (burst-load the refine in one go). Points
// have no Spark global rebuild, so they can stream more aggressively.
function setSplatJobs(t: TilesRenderer, n: number) {
  try {
    (t as any).parseQueue.maxJobs = n;
    (t as any).downloadQueue.maxJobs = Math.max(n, 4);
  } catch {
    /* queues not present yet */
  }
}

// Are both tile queues drained? (snapshot gate)
function queuesEmpty(t: TilesRenderer): boolean {
  const dq = (t as any).downloadQueue?.items?.length || 0;
  const pq = (t as any).parseQueue?.items?.length || 0;
  return dq + pq === 0;
}

// Visible-primitive counters (mirror the prototype). Splats sum userData.splatCount;
// points sum the position-attribute vertex count over visible THREE.Points.
function countSplats(group: THREE.Object3D): number {
  let splats = 0;
  group.traverse((o: any) => {
    if (o.visible && o.userData?.splatCount) splats += o.userData.splatCount;
  });
  return splats;
}
function countPoints(group: THREE.Object3D): number {
  let pts = 0;
  group.traverse((o: any) => {
    if (o.visible && o instanceof THREE.Points) {
      pts += (o.geometry.getAttribute("position") as THREE.BufferAttribute).count;
    }
  });
  return pts;
}

// Minimal structural type for the platform client: download the tileset main
// file by id (downloadFile) + each tile blob by hidden-file id
// (downloadHiddenFile). PlatformClient / EngineServicesClient from
// "@thatopen/services" both satisfy this.
export interface ThreeTZClient {
  downloadFile(fileId: string, params?: any): Promise<Response>;
  downloadHiddenFile(hiddenId: string): Promise<Response>;
}

export interface RealityCaptureController {
  /** Download a tileset.json by file id and render it in an isolated overlay (or `container`). */
  loadThreeTZ(fileId: string, container?: HTMLElement): Promise<void>;
  /**
   * PHASE 0 co-located mode: download a tileset.json by id and render it INSIDE
   * the bim-viewer OBC world scene, driven by the world camera, so the splats /
   * point cloud sit in the SAME 3D space as the BIM model. Returns when the
   * tileset has begun streaming. See `loadIntoWorld` for the occlusion model.
   */
  loadIntoWorld(fileId: string, opts?: LoadIntoWorldOpts): Promise<void>;
  /**
   * Set the alignment transform of a co-located dataset (manual registration).
   * `matrix` maps dataset-local space → BIM world space. `fileId` selects the
   * dataset (default: the active one). Persist/restore to remember an alignment.
   */
  setTransform(matrix: THREE.Matrix4, fileId?: string): void;
  /** Current alignment transform of a dataset (default active), or null. */
  getTransform(fileId?: string): THREE.Matrix4 | null;
  /** Show/hide the interactive align gizmo (attached to the active dataset). */
  showGizmo(on: boolean): void;
  /** Set the align gizmo mode. */
  setGizmoMode(mode: "translate" | "rotate" | "scale"): void;
  /** Make a loaded dataset the active one (gizmo target). */
  setActiveDataset(fileId: string): void;
  /** Unload one co-located dataset (tears down the world view if it was last). */
  removeDataset(fileId: string): void;
  /** Ids of all currently co-located datasets. */
  listDatasets(): string[];
  /** Show/hide a co-located dataset without unloading it (default active). */
  setDatasetVisible(on: boolean, fileId?: string): void;
  /** Is a co-located dataset visible? (default active; false if none). */
  isDatasetVisible(fileId?: string): boolean;
  /** Point size in px (point clouds; global to all point datasets). */
  setPointSize(px: number): void;
  /** Global splat opacity 0..1 for a dataset (default active). */
  setSplatOpacity(opacity: number, fileId?: string): void;
  /** Tune the governor's while-moving primitive budget for a dataset (default active). */
  setMotionBudget(count: number, fileId?: string): void;
  /** Provide the platform client if it wasn't passed to the factory. */
  setClient(client: ThreeTZClient): void;
  /** Stop the loop, dispose everything, remove the overlay / co-located group. Idempotent. */
  clear(): void;
}

export interface LoadIntoWorldOpts {
  /**
   * Initial alignment transform (e.g. restored from app-data). If omitted, an
   * auto-fit is applied on first load: the dataset is centred at the BIM world
   * origin so it lands roughly where the model is, ready for manual nudging.
   */
  transform?: THREE.Matrix4;
  /**
   * Keep the deferred postproduction pipeline ON. Default false → we switch the
   * world to a forward render while the dataset is shown, which gives correct
   * splat-vs-BIM occlusion FOR FREE (three draws opaque BIM first writing depth,
   * then Spark's splats with depthTest:true are clipped behind it). With
   * postproduction ON, splats can't go through the capture pass, so they'd draw
   * over the BIM (no occlusion) until the deferred depth target is exposed (W1/W3).
   */
  keepPostproduction?: boolean;
  /**
   * Show the interactive align gizmo on load (default true). Drag to register the
   * dataset against the BIM model; W/E/R switch translate/rotate/scale.
   */
  gizmo?: boolean;
  /**
   * Called whenever the user finishes moving the align gizmo, with the new
   * dataset-local → world transform. Persist it (e.g. into app-data) and feed it
   * back as `opts.transform` next time to remember the alignment.
   */
  onTransformChange?: (matrix: THREE.Matrix4) => void;
}

// Recursively collect every content URI referenced by a tileset (root + children).
function collectContentURIs(node: any, out: string[]) {
  if (!node || typeof node !== "object") return;
  const c = node.content;
  if (c) {
    const uri = c.uri ?? c.url;
    if (typeof uri === "string") out.push(uri);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectContentURIs(child, out);
  }
}

function detectFormat(uris: string[]): Format {
  for (const uri of uris) {
    const u = uri.toLowerCase();
    if (u.includes(".spz")) return "splats";
    if (u.includes(".pnt")) return "points";
  }
  return "points";
}

/**
 * Build an isolated 3D Tiles viewer controller for bim-viewer.
 *
 * @param _components the engine components (kept for parity/future wiring; the
 *   overlay is intentionally independent of the OBC world's renderer).
 * @param client OPTIONAL platform client (PlatformClient/EngineServicesClient).
 *   If omitted, call `controller.setClient(client)` before `loadThreeTZ`.
 */
export function realityCaptureViewer(
  _components: OBC.Components,
  client?: ThreeTZClient,
): RealityCaptureController {
  let activeClient: ThreeTZClient | undefined = client;

  // Per-session disposables (one tileset at a time). clear() tears these down.
  interface Session {
    overlay: HTMLElement;
    ownsOverlay: boolean; // true => we created the fullscreen overlay and must remove it
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    tiles: TilesRenderer | null;
    sparkRenderer: any;
    onResize: () => void;
    disposed: boolean;
    // idle-snapshot disposables (created lazily on first load)
    snapRT: THREE.WebGLRenderTarget | null;
    blitScene: THREE.Scene | null;
    blitQuad: THREE.Mesh | null;
    blitMat: THREE.ShaderMaterial | null;
    blitGeom: THREE.BufferGeometry | null;
  }
  let session: Session | null = null;

  // PHASE 0 co-located mode (it borrows the OBC world's renderer/scene/camera
  // instead of owning them). MULTIPLE datasets can be loaded into the BIM world
  // at once — each is a `WorldDataset` in `worldDatasets`. A single shared
  // `WorldCtx` holds the world handles, the ONE align gizmo (attached to the
  // ACTIVE dataset), the camera-controls listeners, and the shared rAF tick that
  // updates every dataset. The ctx is created lazily on the first load and torn
  // down (restoring postproduction) when the last dataset is removed.
  interface WorldDataset {
    id: string;
    root: THREE.Group; // alignment-transform target (dataset-local → BIM world)
    splatContainer: THREE.Group;
    pointContainer: THREE.Group;
    tiles: TilesRenderer | null;
    spark: any;
    format: Format;
    splatBudget: number;
    pointBudget: number;
    splatOpacity: number;
    visible: boolean;
    originFitted: boolean;
    hasExplicitTransform: boolean;
    parentScene: THREE.Scene; // scene the root/spark were added to (world or splat)
    onTransformChange?: (m: THREE.Matrix4) => void;
    emitTransform: () => void;
    dispose: () => void;
  }
  interface WorldCtx {
    world: any;
    scene3: THREE.Scene;
    renderer3: THREE.WebGLRenderer;
    getCam: () => THREE.Camera;
    controls: any;
    gizmo: TransformControls;
    gizmoHelper: THREE.Object3D;
    gizmoEnabled: boolean;
    postpro: any;
    prevPostpro: boolean;
    disabledPostpro: boolean; // did WE turn postproduction off? (restore on teardown)
    keepPostproduction: boolean;
    // PHASE 1 — "both" PEN + occluded splats. When on, postproduction stays
    // enabled; splats live in `splatScene` and are drawn by the deferred
    // pipeline's `splatOcclusionPass` hook (after composite, BIM depth borrowed),
    // so they're occluded by BIM with the PEN look kept. Off → forward path
    // (postproduction disabled, splats in world.scene, free occlusion, no PEN).
    deferredOcclusion: boolean;
    splatScene: THREE.Scene | null; // holds dataset roots + Spark when deferredOcclusion
    lastMoveT: number;
    frameNo: number;
    raf: number;
    disposed: boolean;
    overlay: { el: HTMLElement; refresh: () => void; dispose: () => void } | null;
    onCtrl: () => void;
    onRest: () => void;
    onKey: (e: KeyboardEvent) => void;
  }
  const worldDatasets = new Map<string, WorldDataset>();
  let worldCtx: WorldCtx | null = null;
  let activeDatasetId: string | null = null;
  // Assigned to the returned controller so the in-viewport control overlay can
  // drive the public API. Non-null by the time any overlay handler fires.
  let rcApi: RealityCaptureController | null = null;

  // Tear down the fullscreen-overlay session (loadThreeTZ), if any.
  function clearOverlay() {
    const s = session;
    if (!s) return;
    session = null;
    s.disposed = true;
    window.removeEventListener("resize", s.onResize);
    try { s.tiles?.dispose(); } catch { /* noop */ }
    try { s.controls.dispose(); } catch { /* noop */ }
    try { s.sparkRenderer?.dispose?.(); } catch { /* noop */ }
    try {
      s.snapRT?.dispose();
      s.blitGeom?.dispose();
      s.blitMat?.dispose();
    } catch { /* noop */ }
    try {
      s.renderer.dispose();
      s.renderer.forceContextLoss();
    } catch { /* noop */ }
    try {
      if (s.ownsOverlay) s.overlay.remove();
      else s.overlay.replaceChildren(); // caller-owned container: just empty it
    } catch { /* noop */ }
  }

  const activeDataset = (): WorldDataset | null =>
    (activeDatasetId && worldDatasets.get(activeDatasetId)) || null;
  const targetDataset = (id?: string): WorldDataset | null =>
    id ? worldDatasets.get(id) ?? null : activeDataset();

  // Attach the shared gizmo to a dataset's alignment root + make it the gizmo's
  // persistence target. No-op if the id isn't loaded.
  function setActiveDataset(id: string) {
    const ds = worldDatasets.get(id);
    const ctx = worldCtx;
    if (!ds || !ctx) return;
    activeDatasetId = id;
    ctx.gizmo.attach(ds.root);
    ctx.gizmoHelper.visible = ctx.gizmoEnabled && ds.visible;
    ctx.overlay?.refresh();
  }

  // Remove ONE co-located dataset; tear the shared ctx down when the last goes.
  function removeDataset(id: string) {
    const ds = worldDatasets.get(id);
    if (!ds) return;
    worldDatasets.delete(id);
    try { ds.dispose(); } catch { /* noop */ }
    if (activeDatasetId === id) {
      const next = worldDatasets.keys().next();
      activeDatasetId = next.done ? null : next.value;
      if (activeDatasetId) setActiveDataset(activeDatasetId);
    }
    if (worldDatasets.size === 0) teardownWorldCtx();
    else { worldCtx?.overlay?.refresh(); worldCtx?.world?.renderer?.update?.(); }
  }

  function teardownWorldCtx() {
    const ctx = worldCtx;
    if (!ctx) return;
    worldCtx = null;
    activeDatasetId = null;
    ctx.disposed = true;
    cancelAnimationFrame(ctx.raf);
    ctx.controls?.removeEventListener?.("control", ctx.onCtrl);
    ctx.controls?.removeEventListener?.("controlstart", ctx.onCtrl);
    ctx.controls?.removeEventListener?.("rest", ctx.onRest);
    ctx.controls?.removeEventListener?.("sleep", ctx.onRest);
    window.removeEventListener("keydown", ctx.onKey);
    if (ctx.controls) ctx.controls.enabled = true; // in case teardown lands mid-drag
    // Unregister the Phase-1 occlusion hook so the pipeline stops calling us.
    if (ctx.deferredOcclusion && ctx.postpro && "splatOcclusionPass" in ctx.postpro) {
      ctx.postpro.splatOcclusionPass = undefined;
    }
    try {
      ctx.gizmo.detach();
      (ctx.splatScene ?? ctx.scene3).remove(ctx.gizmoHelper);
      ctx.gizmo.dispose();
    } catch { /* noop */ }
    if (ctx.postpro && ctx.disabledPostpro) ctx.postpro.enabled = ctx.prevPostpro;
    ctx.overlay?.dispose();
    try { ctx.world.renderer.update(); } catch { /* noop */ }
  }

  // Remove ALL co-located datasets (and the shared ctx).
  function clearWorldAll() {
    for (const id of [...worldDatasets.keys()]) removeDataset(id);
  }

  // Public clear(): tear down everything (overlay + all co-located datasets).
  function clear() {
    clearWorldAll();
    clearOverlay();
  }

  async function loadThreeTZ(fileId: string, container?: HTMLElement) {
    if (!activeClient) {
      throw new Error(
        "realityCaptureViewer: no platform client — pass it to the factory or call setClient() first",
      );
    }
    // Only one session at a time.
    clear();

    // --- overlay / mount --------------------------------------------------
    let overlay: HTMLElement;
    let mount: HTMLElement;
    const ownsOverlay = !container;
    let status: HTMLElement | null = null;

    if (container) {
      overlay = container;
      overlay.replaceChildren();
      mount = container;
    } else {
      overlay = document.createElement("div");
      Object.assign(overlay.style, {
        position: "absolute",
        inset: "0",
        zIndex: "1000",
        background: BG.getStyle(),
        display: "flex",
        flexDirection: "column",
      });

      const header = document.createElement("div");
      Object.assign(header.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.75rem 1rem",
        flexShrink: "0",
        borderBottom: "1px solid var(--bim-ui_bg-contrast-20)",
        color: "var(--bim-ui_main-base, #fff)",
      });

      status = document.createElement("div");
      status.style.opacity = "0.7";
      status.textContent = "Loading…";

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Close";
      Object.assign(closeBtn.style, {
        cursor: "pointer",
        padding: "0.4rem 0.9rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--bim-ui_bg-contrast-40, #555)",
        background: "var(--bim-ui_bg-contrast-20, #333)",
        color: "var(--bim-ui_main-base, #fff)",
      });
      closeBtn.addEventListener("click", () => clear());

      header.appendChild(status);
      header.appendChild(closeBtn);

      mount = document.createElement("div");
      Object.assign(mount.style, {
        flex: "1",
        overflow: "hidden",
        position: "relative",
        minHeight: "0",
      });

      overlay.appendChild(header);
      overlay.appendChild(mount);
      document.body.appendChild(overlay);
    }

    // --- three.js core (own renderer; NOT the OBC world) ------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(BG, 1);
    Object.assign(renderer.domElement.style, {
      width: "100%",
      height: "100%",
      display: "block",
    });
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50000);
    camera.position.set(15, 12, 15);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    controls.target.set(0, 0, 0);

    const pointContainer = new THREE.Group();
    pointContainer.matrixAutoUpdate = false;
    scene.add(pointContainer);
    const splatContainer = new THREE.Group();
    splatContainer.rotation.x = Math.PI; // splats are Y-up
    scene.add(splatContainer);

    const s: Session = {
      overlay,
      ownsOverlay,
      renderer,
      controls,
      tiles: null,
      sparkRenderer: null,
      onResize: () => {},
      disposed: false,
      snapRT: null,
      blitScene: null,
      blitQuad: null,
      blitMat: null,
      blitGeom: null,
    };
    session = s;

    let format: Format = "points";
    let originSet = false;

    // --- idle-snapshot machinery (full-screen blit of a frozen RT) ---------
    // Allocate the RT at the drawing-buffer size; a tiny ortho quad samples it.
    const blitMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null as THREE.Texture | null } },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader:
        "precision highp float; varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor = texture2D(uTex, vUv); }",
      depthTest: false,
      depthWrite: false,
    });
    const blitGeom = new THREE.PlaneGeometry(2, 2);
    const blitQuad = new THREE.Mesh(blitGeom, blitMat);
    blitQuad.frustumCulled = false;
    const blitScene = new THREE.Scene();
    blitScene.add(blitQuad);
    const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    s.blitScene = blitScene;
    s.blitQuad = blitQuad;
    s.blitMat = blitMat;
    s.blitGeom = blitGeom;

    // Snapshot state machine flags.
    let showFrozen = false; // currently blitting the frozen texture
    let snapshotDone = false; // a valid snapshot has been captured at this pose
    let lastMoveT = performance.now();

    function ensureSnapRT(w: number, h: number) {
      if (!s.snapRT) {
        s.snapRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
        blitMat.uniforms.uTex.value = s.snapRT.texture;
      } else if (s.snapRT.width !== w || s.snapRT.height !== h) {
        s.snapRT.setSize(w, h);
      }
    }

    function resize() {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (s.tiles) s.tiles.setResolutionFromRenderer(camera, renderer);
      // snapshot is resolution-specific: resize the RT and invalidate it.
      const db = new THREE.Vector2();
      renderer.getDrawingBufferSize(db);
      ensureSnapRT(Math.max(1, Math.floor(db.x)), Math.max(1, Math.floor(db.y)));
      showFrozen = false;
      snapshotDone = false;
    }
    s.onResize = () => resize();
    window.addEventListener("resize", s.onResize);

    // Any user input invalidates the frozen snapshot and snaps the live set
    // back to "light" so the resulting motion is immediately smooth.
    const onInteractStart = () => {
      showFrozen = false;
      snapshotDone = false;
      lastMoveT = performance.now();
      if (s.tiles) {
        const floorET = format === "splats" ? SPLAT_MOTION_ET : POINT_MOTION_ET;
        s.tiles.errorTarget = Math.max(s.tiles.errorTarget, floorET);
        setSplatJobs(s.tiles, 1); // spread spikes while moving
      }
    };
    const onInteractEnd = () => {
      if (s.tiles) setSplatJobs(s.tiles, 16); // burst-load the refine
    };
    controls.addEventListener("start", onInteractStart);
    controls.addEventListener("end", onInteractEnd);

    function frameCamera(center: THREE.Vector3, radius: number) {
      const r = Math.max(2, radius);
      controls.target.copy(center);
      camera.position.set(center.x + r * 0.9, center.y + r * 0.7, center.z + r * 0.9);
      camera.near = r / 500;
      camera.far = r * 200;
      camera.updateProjectionMatrix();
      controls.update();
    }

    // --- motion detection: compare the camera world transform frame-to-frame.
    // controls.update() under-reports wheel-zoom, so also diff position+quaternion
    // (position changes on orbit/pan/zoom; target via controls covers pan).
    const _prevPos = new THREE.Vector3(Infinity, Infinity, Infinity);
    const _prevQuat = new THREE.Quaternion(2, 2, 2, 2);
    const _prevTarget = new THREE.Vector3(Infinity, Infinity, Infinity);
    let frameNo = 0;

    function animate() {
      if (s.disposed) return;
      requestAnimationFrame(animate);

      const now = performance.now();
      const fromControls = controls.update();
      const moved =
        _prevPos.distanceToSquared(camera.position) > 1e-10 ||
        _prevTarget.distanceToSquared(controls.target) > 1e-10 ||
        Math.abs(_prevQuat.dot(camera.quaternion)) < 0.9999999;
      _prevPos.copy(camera.position);
      _prevTarget.copy(controls.target);
      _prevQuat.copy(camera.quaternion);
      const ctrlChanged = fromControls || moved;
      if (ctrlChanged) lastMoveT = now;
      // ~130ms tail so the damping glide still counts as "moving".
      const cameraMoving = now - lastMoveT < 130;

      const tiles = s.tiles;
      if (tiles) {
        tiles.setCamera(camera);
        tiles.update();

        const isSplat = format === "splats";
        const group = isSplat ? splatContainer : pointContainer;
        const budget = isSplat ? SPLAT_MOTION_BUDGET : POINT_MOTION_BUDGET;
        const motionET = isSplat ? SPLAT_MOTION_ET : POINT_MOTION_ET;
        const refineFloor = isSplat ? SPLAT_REFINE_FLOOR : POINT_REFINE_FLOOR;
        const refineStep = isSplat ? SPLAT_REFINE_STEP : POINT_REFINE_STEP;

        // --- count-budget governor (every ~6 frames) -----------------------
        if (frameNo % 6 === 0) {
          const vis = isSplat ? countSplats(group) : countPoints(group);
          const scaleET = (f: number) => {
            tiles.errorTarget = THREE.MathUtils.clamp(tiles.errorTarget * f, ET_MIN, ET_MAX);
          };
          if (cameraMoving) {
            // MOVING: hard-cap the primitive COUNT to the motion budget by
            // raising errorTarget proportionally; ease back down if well under.
            const ratio = vis / budget;
            if (ratio > 1.1) scaleET(Math.min(2.5, ratio));
            else if (ratio < 0.6) scaleET(0.9);
          } else if (!snapshotDone) {
            // PARKED + not yet snapshotted: refine coarse -> fine toward the floor,
            // bounded by the idle budget so a wide view doesn't request the world.
            const underIdleCap = isSplat || vis < IDLE_POINT_BUDGET;
            if (underIdleCap && tiles.errorTarget > refineFloor) {
              tiles.errorTarget = Math.max(tiles.errorTarget * refineStep, refineFloor);
            }
          }
        }

        // --- idle-snapshot state machine -----------------------------------
        if (cameraMoving) {
          showFrozen = false;
          snapshotDone = false;
        } else if (!snapshotDone) {
          // parked: capture once refined (near the floor) AND queues drained,
          // OR after a 2.5s safety dwell if streaming never fully settles.
          const refined = tiles.errorTarget <= refineFloor * 2.5 && queuesEmpty(tiles);
          const stable = refined || now - lastMoveT > 2500;
          if (stable) {
            const db = new THREE.Vector2();
            renderer.getDrawingBufferSize(db);
            ensureSnapRT(Math.max(1, Math.floor(db.x)), Math.max(1, Math.floor(db.y)));
            renderer.setRenderTarget(s.snapRT);
            renderer.clear(true, true, true);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null);
            showFrozen = true;
            snapshotDone = true;
            // cap the live set back to "light" so the next motion is instant.
            tiles.errorTarget = motionET;
          }
        }

        if (showFrozen && s.snapRT) {
          // BLIT the frozen full-detail texture (cheap; no re-sort).
          renderer.setRenderTarget(null);
          renderer.render(blitScene, blitCam);
        } else {
          renderer.render(scene, camera);
        }
      } else {
        renderer.render(scene, camera);
      }
      frameNo++;
    }

    resize();
    animate();

    // --- load -------------------------------------------------------------
    try {
      if (status) status.textContent = "Downloading…";
      // The main visible file is a standard tileset.json. Download its bytes,
      // parse the JSON for the content URIs (format detection) + the hiddenFiles
      // map (content.uri -> hidden file id) used to stream tiles per-file.
      const res = await activeClient.downloadFile(fileId);
      const tilesetBytes = new Uint8Array(await res.arrayBuffer());
      if (s.disposed) return;

      if (status) status.textContent = "Inspecting…";
      const ts = JSON.parse(new TextDecoder().decode(tilesetBytes));
      const hiddenFiles: Record<string, string> = ts.hiddenFiles || {};
      const uris: string[] = [];
      collectContentURIs(ts.root, uris);
      format = detectFormat(uris);
      if (s.disposed) return;

      if (status) status.textContent = `Streaming (${format})…`;

      // HiddenTilesPlugin serves the root tileset from the bytes we already have,
      // and each tile content fetch by downloading the matching platform HIDDEN
      // file (one downloadHiddenFile per visible tile). The synthetic "mem://t"
      // base lets relative content URIs resolve to dataset-relative paths the
      // plugin strips back to look up in the hiddenFiles map.
      const tiles = new TilesRenderer("mem://t/tileset.json");
      s.tiles = tiles;
      tiles.registerPlugin(
        new HiddenTilesPlugin({
          baseUrl: "mem://t",
          tilesetBytes,
          hiddenFiles,
          client: activeClient,
        }),
      );

      if (format === "splats") {
        // clipXY 1.0 frustum-culls splat centers (default 1.4 keeps a 40%
        // off-screen overdraw margin we don't need here).
        s.sparkRenderer = new SparkRenderer({ renderer, clipXY: 1.0 } as any);
        scene.add(s.sparkRenderer);
        tiles.registerPlugin(new SplatTilePlugin());
        tiles.errorTarget = SPLAT_MOTION_ET;
        // LRU sized to hold a full small dataset once (no reload churn); the
        // count-budget governor still bounds what's actually DRAWN each frame.
        // This is THE big win — Spark only re-sorts the visible cut.
        configureCache(tiles, 280, 420);
        // Spark rebuilds a merged buffer per tile: cap concurrent parses to
        // avoid bunching spikes (raised to 16 on interaction-end to burst-refine).
        setSplatJobs(tiles, 1);
        splatContainer.add(tiles.group);
      } else {
        tiles.registerPlugin(new PointTilePlugin());
        tiles.errorTarget = POINT_MOTION_ET;
        // Bigger cache for dense point clouds so revisits don't reload.
        configureCache(tiles, 1500, 768);
        // Points load fast (no Spark rebuild to spread); match the decode pool.
        try {
          (tiles as any).parseQueue.maxJobs = 16;
        } catch {
          /* queue not present */
        }
        pointContainer.add(tiles.group);
      }

      tiles.setCamera(camera);
      tiles.setResolutionFromRenderer(camera, renderer);

      tiles.addEventListener("load-tileset", () => {
        if (originSet || s.disposed) return;
        originSet = true;
        const sphere = new THREE.Sphere();
        tiles.getBoundingSphere(sphere);

        if (format === "points") {
          // RTC: recenter the float64 origin on the tileset centre so the point
          // nodes (placed at float64 world anchors) render jitter-free. The
          // pointContainer shifts by -origin; framing is around the origin.
          const c = sphere.center;
          frame.origin = [c.x, c.y, c.z];
          pointContainer.position.set(-c.x, -c.y, -c.z);
          pointContainer.updateMatrix();
          frameCamera(new THREE.Vector3(0, 0, 0), sphere.radius);
        } else {
          // Splats: the container applies the Y-up flip (rotation.x = PI). Frame
          // on the flipped centre so the camera looks at the visible geometry.
          const c = sphere.center;
          const flipped = new THREE.Vector3(c.x, -c.y, -c.z);
          frameCamera(flipped, sphere.radius);
        }
        if (status) status.textContent = "";
      });
    } catch (e: any) {
      if (!s.disposed && status) status.textContent = `Error: ${e?.message ?? e}`;
      console.error("[reality-capture-viewer]", e);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // PHASE 0 — CO-LOCATED MODE: splats/points in the BIM world scene.
  //
  // Borrows the OBC world's renderer + scene + camera instead of owning them, so
  // the dataset sits in the same 3D space as the .frag model under one camera.
  // Occlusion: with postproduction OFF (default), three renders opaque BIM first
  // (writes depth) then Spark's transparent splats (depthTest:true) — splats
  // behind walls are clipped FOR FREE, no custom depth pass. The governor (LRU +
  // count budget + park-refine) is re-driven off the OBC camera-controls events;
  // the overlay's idle-snapshot is dropped (it would freeze the whole BIM scene).
  // ───────────────────────────────────────────────────────────────────────
  // Self-contained in-viewport control strip for the co-located experience.
  // Plain DOM themed with the --bim-ui_* vars (matches BUI) — deliberately does
  // NOT touch files-panel or the app panel system (avoids collision; W2 owns
  // panels). Drives the public controller API (rcApi) and always reflects the
  // ACTIVE dataset. Owned by the WorldCtx: appears on first load, torn down with
  // the ctx. Bottom-centre of the viewport.
  function buildControlOverlay(ctx: WorldCtx): {
    el: HTMLElement;
    refresh: () => void;
    dispose: () => void;
  } {
    const mount = ctx.renderer3.domElement.parentElement ?? document.body;
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "absolute", bottom: "12px", left: "50%", transform: "translateX(-50%)",
      zIndex: "20", display: "flex", alignItems: "center", gap: "0.5rem",
      padding: "0.4rem 0.6rem", borderRadius: "0.5rem",
      background: "var(--bim-ui_bg-base, #1a1f26)",
      border: "1px solid var(--bim-ui_bg-contrast-20, #333)",
      color: "var(--bim-ui_main-base, #e6e6e6)",
      font: "12px/1.2 system-ui, sans-serif",
      boxShadow: "0 2px 12px rgba(0,0,0,0.4)", userSelect: "none",
    });
    const mkBtn = (text: string, title: string) => {
      const b = document.createElement("button");
      b.textContent = text; b.title = title;
      Object.assign(b.style, {
        cursor: "pointer", padding: "0.3rem 0.55rem", borderRadius: "0.35rem",
        border: "1px solid var(--bim-ui_bg-contrast-40, #555)",
        background: "var(--bim-ui_bg-contrast-20, #2a2f37)", color: "inherit", font: "inherit",
      });
      return b;
    };
    const hl = (b: HTMLButtonElement, on: boolean) => {
      b.style.background = on ? "var(--bim-ui_accent-base, #4b7bec)" : "var(--bim-ui_bg-contrast-20, #2a2f37)";
      b.style.borderColor = on ? "var(--bim-ui_accent-base, #4b7bec)" : "var(--bim-ui_bg-contrast-40, #555)";
    };
    const sep = () => { const s = document.createElement("span"); s.textContent = "|"; s.style.opacity = "0.3"; return s; };

    const label = document.createElement("span");
    Object.assign(label.style, { opacity: "0.85", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
    const prev = mkBtn("‹", "Previous dataset");
    const next = mkBtn("›", "Next dataset");
    const cycle = (dir: number) => {
      const ids = rcApi?.listDatasets() ?? [];
      if (ids.length < 2) return;
      const i = Math.max(0, ids.indexOf(activeDatasetId ?? ""));
      rcApi?.setActiveDataset(ids[(i + dir + ids.length) % ids.length]);
    };
    prev.onclick = () => cycle(-1);
    next.onclick = () => cycle(1);

    const eye = mkBtn("Hide", "Show/hide this dataset");
    eye.onclick = () => { rcApi?.setDatasetVisible(!(rcApi?.isDatasetVisible() ?? true)); refresh(); };

    const align = mkBtn("Align", "Toggle the align gizmo (W/E/R = move/rotate/scale)");
    align.onclick = () => { ctx.gizmoEnabled = !ctx.gizmoEnabled; rcApi?.showGizmo(ctx.gizmoEnabled); refresh(); };
    const mMove = mkBtn("Move", "Translate (W)");
    const mRot = mkBtn("Rotate", "Rotate (E)");
    const mScale = mkBtn("Scale", "Scale (R)");
    mMove.onclick = () => { rcApi?.setGizmoMode("translate"); refresh(); };
    mRot.onclick = () => { rcApi?.setGizmoMode("rotate"); refresh(); };
    mScale.onclick = () => { rcApi?.setGizmoMode("scale"); refresh(); };

    const opWrap = document.createElement("label");
    Object.assign(opWrap.style, { display: "flex", alignItems: "center", gap: "0.3rem" });
    opWrap.title = "Splat opacity";
    const opTxt = document.createElement("span"); opTxt.textContent = "Opacity";
    const op = document.createElement("input");
    op.type = "range"; op.min = "0"; op.max = "1"; op.step = "0.05"; op.value = "1"; op.style.width = "80px";
    op.oninput = () => rcApi?.setSplatOpacity(parseFloat(op.value));
    opWrap.append(opTxt, op);

    const unload = mkBtn("Unload", "Remove this dataset from the model");
    unload.style.borderColor = "var(--bim-ui_color-error, #c0392b)";
    unload.onclick = () => { if (activeDatasetId) rcApi?.removeDataset(activeDatasetId); };

    bar.append(prev, label, next, sep(), eye, sep(), align, mMove, mRot, mScale, sep(), opWrap, sep(), unload);
    mount.appendChild(bar);

    function refresh() {
      const ids = rcApi?.listDatasets() ?? [];
      const multi = ids.length > 1;
      prev.style.display = next.style.display = label.style.display = multi ? "" : "none";
      if (multi && activeDatasetId) label.textContent = `${ids.indexOf(activeDatasetId) + 1}/${ids.length} · …${activeDatasetId.slice(-6)}`;
      eye.textContent = (rcApi?.isDatasetVisible() ?? true) ? "Hide" : "Show";
      hl(align, ctx.gizmoEnabled);
      const mode = (ctx.gizmo as any).mode ?? "translate";
      for (const [b, m] of [[mMove, "translate"], [mRot, "rotate"], [mScale, "scale"]] as [HTMLButtonElement, string][]) {
        b.disabled = !ctx.gizmoEnabled;
        b.style.opacity = ctx.gizmoEnabled ? "1" : "0.4";
        hl(b, ctx.gizmoEnabled && mode === m);
      }
      const ds = activeDataset();
      const isSplat = ds?.format === "splats";
      opWrap.style.display = isSplat ? "flex" : "none";
      if (isSplat && ds) op.value = String(ds.splatOpacity);
    }
    refresh();

    return { el: bar, refresh, dispose() { try { bar.remove(); } catch { /* noop */ } } };
  }

  // Lazily create the shared world context: OBC-world handles + the single align
  // gizmo (re-attached to the active dataset) + camera-controls listeners + the
  // rAF tick that updates EVERY loaded dataset. Created on first load; torn down
  // (restoring postproduction) when the last dataset is removed.
  function ensureWorldCtx(keepPostproduction: boolean): WorldCtx {
    if (worldCtx) return worldCtx;
    const world = [...(_components.get(OBC.Worlds).list.values() as any)][0] as any;
    if (!world?.scene?.three || !world?.renderer?.three || !world?.camera) {
      throw new Error("loadIntoWorld: no OBC world available");
    }
    const scene3: THREE.Scene = world.scene.three;
    const renderer3: THREE.WebGLRenderer = world.renderer.three;
    const getCam = (): THREE.Camera => world.camera.three ?? world.camera.threePersp;
    const controls: any = world.camera.controls;

    // Mode: PHASE-1 deferred-occlusion ("both") requires keepPostproduction AND
    // the deferred pipeline's splatOcclusionPass hook (W3). Otherwise → forward
    // path (disable postproduction; splats in world.scene; free occlusion).
    const postpro = world.renderer.postproduction;
    const prevPostpro = !!postpro?.enabled;
    const deferredOcclusion =
      keepPostproduction && !!postpro && "splatOcclusionPass" in postpro;
    // Disable postproduction for the forward path (free occlusion). Also covers
    // the fallback where "both" was requested but the deferred hook is missing
    // (older dist) — better splats-with-free-occlusion than splats hidden by the
    // capture pass. Only deferred-occlusion mode keeps postproduction on.
    const disabledPostpro = !!postpro && !deferredOcclusion;
    if (disabledPostpro) postpro.enabled = false;

    // In deferred-occlusion mode the splats live in a PRIVATE scene drawn by the
    // splatOcclusionPass (after the PEN composite, BIM depth borrowed); the
    // deferred capture would otherwise hide them. In forward mode they live in
    // world.scene and render with the BIM in one pass.
    const splatScene: THREE.Scene | null = deferredOcclusion ? new THREE.Scene() : null;
    const contentScene = splatScene ?? scene3;

    // ONE align gizmo, re-attached to the active dataset's root on selection.
    // Put its helper in the same scene as the dataset content so it stays visible
    // (in deferred mode the PEN capture would hide a helper added to world.scene).
    const gizmo = new TransformControls(getCam(), renderer3.domElement);
    const gizmoHelper = gizmo.getHelper();
    contentScene.add(gizmoHelper);
    gizmo.addEventListener("dragging-changed", (e: any) => {
      if (controls) controls.enabled = !e.value;
    });
    gizmo.addEventListener("mouseUp", () => activeDataset()?.emitTransform());

    const onCtrl = () => {
      if (worldCtx) worldCtx.lastMoveT = performance.now();
      for (const ds of worldDatasets.values()) {
        if (!ds.tiles) continue;
        const floorET = ds.format === "splats" ? SPLAT_MOTION_ET : POINT_MOTION_ET;
        ds.tiles.errorTarget = Math.max(ds.tiles.errorTarget, floorET);
        setSplatJobs(ds.tiles, 1); // spread spikes while moving
      }
    };
    const onRest = () => {
      for (const ds of worldDatasets.values()) if (ds.tiles) setSplatJobs(ds.tiles, 16);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!gizmoHelper.visible) return;
      if (e.key === "w" || e.key === "W") gizmo.setMode("translate");
      else if (e.key === "e" || e.key === "E") gizmo.setMode("rotate");
      else if (e.key === "r" || e.key === "R") gizmo.setMode("scale");
    };
    controls?.addEventListener?.("control", onCtrl);
    controls?.addEventListener?.("controlstart", onCtrl);
    controls?.addEventListener?.("rest", onRest);
    controls?.addEventListener?.("sleep", onRest);
    window.addEventListener("keydown", onKey);

    const ctx: WorldCtx = {
      world, scene3, renderer3, getCam, controls,
      gizmo, gizmoHelper, gizmoEnabled: true,
      postpro, prevPostpro, disabledPostpro, keepPostproduction,
      deferredOcclusion, splatScene,
      lastMoveT: performance.now(), frameNo: 0, raf: 0, disposed: false,
      overlay: null,
      onCtrl, onRest, onKey,
    };
    worldCtx = ctx;
    ctx.overlay = buildControlOverlay(ctx); // self-contained in-viewport controls

    // PHASE 1 — register the deferred occlusion draw (W3 converged hook d2528f06).
    // Fires AFTER composite/FXAA/overlays (PEN frame done), into `ctx.target` — a
    // SEPARATE borrowed-depth colour LAYER the pipeline has already bound + cleared
    // transparent with the BIM DepthTexture attached; the pipeline then composites
    // that layer premultiplied OVER the PEN frame. We just draw the private
    // splatScene into the (already-bound) target: Spark's premultiplied,
    // depth-tested splats are occluded by the real BIM depth. We NEVER clear the
    // depth and DON'T cache the layer FBO across frames (depth detached per-frame).
    if (deferredOcclusion) {
      postpro.splatOcclusionPass = (c: {
        renderer: THREE.WebGLRenderer;
        camera: THREE.Camera;
        target: THREE.WebGLRenderTarget;
        depth: THREE.DepthTexture;
        width: number;
        height: number;
      }) => {
        if (ctx.disposed || !splatScene || !c?.depth || !c?.target) return; // guard until pipeline up
        // Reversed-Z: Spark's draw manages its own GL depth state (doesn't ride
        // three's auto depthFunc inversion), so set GreaterEqualDepth ourselves.
        applySplatDepthState(splatScene);
        // The pipeline has already bound c.target (borrowed BIM depth, cleared
        // transparent, autoClear off); just draw — renderer.render keeps the
        // current target. The pipeline composites it premultiplied over PEN.
        c.renderer.render(splatScene, c.camera);
      };
    }

    // Motion detection for the idle gate: diff the camera transform frame-to-
    // frame (covers user orbit AND programmatic moves, not just controls events).
    const _prevPos = new THREE.Vector3(Infinity, Infinity, Infinity);
    const _prevQuat = new THREE.Quaternion(2, 2, 2, 2);
    // Frames still rendered after activity stops, so the settled/refined frame is
    // actually presented before we go idle.
    let trailing = 0;

    // Shared tick: govern EVERY loaded dataset, then re-composite ONLY while the
    // camera is moving or tiles are streaming (+ a short trailing tail). When idle
    // and drained we stop forcing renderer.update() — the deferred PEN pipeline +
    // splat sort no longer run every frame, restoring idle fps. A camera move (or
    // a streaming tile) flips us back on within a frame, so the next move always
    // re-sorts; the on-demand render path keeps the canvas correct meanwhile.
    function tick() {
      if (ctx.disposed) return;
      ctx.raf = requestAnimationFrame(tick);
      const cam = ctx.getCam();
      if (ctx.gizmo.camera !== cam) ctx.gizmo.camera = cam; // follow persp/ortho
      const now = performance.now();
      // Camera moved since last frame? (transform diff + the controls events that
      // also set lastMoveT). Damping glide keeps changing the transform → caught.
      const moved =
        _prevPos.distanceToSquared(cam.position) > 1e-12 ||
        Math.abs(_prevQuat.dot(cam.quaternion)) < 0.9999999;
      _prevPos.copy(cam.position);
      _prevQuat.copy(cam.quaternion);
      if (moved) ctx.lastMoveT = now;
      const cameraMoving = now - ctx.lastMoveT < 180;
      const runGovernor = ctx.frameNo % 6 === 0;
      let anyStreaming = false;
      for (const ds of worldDatasets.values()) {
        const tiles = ds.tiles;
        if (!tiles || !ds.visible) continue; // hidden datasets pause streaming
        tiles.setCamera(cam);
        tiles.setResolutionFromRenderer(cam, ctx.renderer3);
        tiles.update();
        if (!queuesEmpty(tiles)) anyStreaming = true; // a tile in flight → keep rendering
        if (!runGovernor) continue;
        const isSplat = ds.format === "splats";
        const group = isSplat ? ds.splatContainer : ds.pointContainer;
        const budget = isSplat ? ds.splatBudget : ds.pointBudget;
        const refineFloor = isSplat ? SPLAT_REFINE_FLOOR : POINT_REFINE_FLOOR;
        const refineStep = isSplat ? SPLAT_REFINE_STEP : POINT_REFINE_STEP;
        const vis = isSplat ? countSplats(group) : countPoints(group);
        const scaleET = (f: number) => {
          tiles.errorTarget = THREE.MathUtils.clamp(tiles.errorTarget * f, ET_MIN, ET_MAX);
        };
        if (cameraMoving) {
          const ratio = vis / budget;
          if (ratio > 1.1) scaleET(Math.min(2.5, ratio));
          else if (ratio < 0.6) scaleET(0.9);
        } else if (tiles.errorTarget > refineFloor) {
          tiles.errorTarget = Math.max(tiles.errorTarget * refineStep, refineFloor);
        }
        if (isSplat && ds.splatOpacity !== 1) {
          group.traverse((o: any) => {
            if (o.userData?.splatCount && typeof o.opacity === "number") o.opacity = ds.splatOpacity;
          });
        }
      }
      ctx.frameNo++;

      // IDLE GATE: re-composite only when something changed. Refinement counts as
      // streaming (park-refine lowers errorTarget → loads finer tiles → keeps
      // rendering until refined + drained, then we idle). `trailing` presents the
      // final settled frame before stopping.
      const needsRender = cameraMoving || anyStreaming;
      if (needsRender) trailing = 3;
      else if (trailing > 0) trailing--;
      if (!needsRender && trailing <= 0) return; // idle → let the world render on-demand

      // Drive the OBC render so new tiles appear + Spark re-sorts for this camera.
      ctx.world.renderer.update();

      // POSTPRO-OFF FALLBACK: in deferred-occlusion mode the splats live in the
      // private splatScene and only draw via the splatOcclusionPass — which the
      // pipeline fires only while postproduction is ON. If the user turns
      // postproduction OFF at runtime (graphics panel), draw splatScene ourselves
      // in a forward pass over the canvas (autoClear off so we keep the BIM the
      // world just rendered; depth-tested against the BIM depth it wrote).
      if (
        ctx.deferredOcclusion &&
        ctx.splatScene &&
        ctx.postpro &&
        ctx.postpro.enabled === false
      ) {
        applySplatDepthState(ctx.splatScene);
        const r = ctx.renderer3;
        const prevAutoClear = r.autoClear;
        r.autoClear = false;
        r.setRenderTarget(null);
        r.render(ctx.splatScene, cam);
        r.autoClear = prevAutoClear;
      }
    }
    tick();
    return ctx;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PHASE 0 — CO-LOCATED MODE: splats/points in the BIM world scene.
  //
  // Borrows the OBC world's renderer + scene + camera instead of owning them, so
  // the dataset sits in the same 3D space as the .frag model under one camera.
  // MULTIPLE datasets can be loaded at once (each a WorldDataset under the shared
  // WorldCtx). Occlusion: with postproduction OFF (default), three renders opaque
  // BIM first (writes depth) then Spark's transparent splats (depthTest:true) —
  // splats behind walls are clipped FOR FREE. Governor re-driven off the OBC
  // camera-controls events; the overlay's idle-snapshot is dropped.
  // ───────────────────────────────────────────────────────────────────────
  async function loadIntoWorld(fileId: string, opts: LoadIntoWorldOpts = {}) {
    if (!activeClient) {
      throw new Error(
        "realityCaptureViewer: no platform client — pass it to the factory or call setClient() first",
      );
    }
    clearOverlay(); // overlay and co-located are alternative screens
    if (worldDatasets.has(fileId)) removeDataset(fileId); // reload replaces in place

    const ctx = ensureWorldCtx(opts.keepPostproduction === true);

    // Root group carries the user alignment transform (dataset-local → world).
    // matrixAutoUpdate stays ON so TransformControls can drive it via TRS; we set
    // the transform by DECOMPOSING a matrix. Splats are Y-up → flip the inner
    // container so the alignment transform on `root` stays in BIM world space.
    // In deferred-occlusion mode the dataset lives in the private splatScene
    // (drawn by the occlusion pass); otherwise in world.scene (forward path).
    const contentScene = ctx.splatScene ?? ctx.scene3;
    const root = new THREE.Group();
    if (opts.transform) opts.transform.decompose(root.position, root.quaternion, root.scale);
    contentScene.add(root);
    const splatContainer = new THREE.Group();
    splatContainer.rotation.x = Math.PI;
    const pointContainer = new THREE.Group();
    root.add(splatContainer, pointContainer);

    const ds: WorldDataset = {
      id: fileId, root, splatContainer, pointContainer,
      tiles: null, spark: null, format: "points",
      splatBudget: SPLAT_MOTION_BUDGET, pointBudget: POINT_MOTION_BUDGET, splatOpacity: 1,
      visible: true, originFitted: false, hasExplicitTransform: !!opts.transform,
      parentScene: contentScene,
      onTransformChange: opts.onTransformChange,
      emitTransform() {
        root.updateMatrix();
        this.onTransformChange?.(root.matrix.clone());
      },
      dispose() {
        try { this.tiles?.dispose(); } catch { /* noop */ }
        try { this.spark?.dispose?.(); } catch { /* noop */ }
        try {
          if (this.spark) this.parentScene.remove(this.spark);
          this.parentScene.remove(root);
        } catch { /* noop */ }
      },
    };
    worldDatasets.set(fileId, ds);
    setActiveDataset(fileId); // attach the gizmo to the newest dataset
    if (opts.gizmo === false) {
      ctx.gizmoEnabled = false;
      ctx.gizmoHelper.visible = false;
    } else {
      ctx.gizmoHelper.visible = ctx.gizmoEnabled;
    }

    // --- download + parse the tileset ------------------------------------
    // Guarded: a missing/forbidden fileId, a network failure, or a malformed
    // tileset.json must not throw unhandled or leave a half-set-up dataset
    // (ctx/gizmo/occlusion-pass registered but no tiles). On any failure we tear
    // the partial dataset down (removeDataset → also drops the ctx if it was the
    // only one) and rethrow so the caller (files-panel) surfaces it.
    let tilesetBytes: Uint8Array;
    let tsj: any;
    try {
      const res = await activeClient.downloadFile(fileId);
      tilesetBytes = new Uint8Array(await res.arrayBuffer());
      if (!worldDatasets.has(fileId)) return; // removed while downloading
      tsj = JSON.parse(new TextDecoder().decode(tilesetBytes));
      if (!tsj?.root) throw new Error("tileset.json has no root");
    } catch (e) {
      removeDataset(fileId);
      throw new Error(
        `reality-capture: failed to load tileset ${fileId} into the world: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    const hiddenFiles: Record<string, string> = tsj.hiddenFiles || {};
    const uris: string[] = [];
    collectContentURIs(tsj.root, uris);
    ds.format = detectFormat(uris);

    const tiles = new TilesRenderer("mem://t/tileset.json");
    ds.tiles = tiles;
    tiles.registerPlugin(
      new HiddenTilesPlugin({ baseUrl: "mem://t", tilesetBytes, hiddenFiles, client: activeClient }),
    );
    // A tile that fails to download/parse mid-stream should degrade (that tile is
    // skipped) rather than spam — log once per tile via the renderer's own error.
    tiles.addEventListener("load-error", (e: any) => {
      console.warn("[reality-capture] tile load error:", e?.url ?? e?.error ?? e);
    });

    if (ds.format === "splats") {
      ds.spark = new SparkRenderer({ renderer: ctx.renderer3, clipXY: 1.0 } as any);
      ds.parentScene.add(ds.spark); // world.scene (forward) or splatScene (deferred)
      tiles.registerPlugin(new SplatTilePlugin());
      tiles.errorTarget = SPLAT_MOTION_ET;
      configureCache(tiles, 280, 420);
      setSplatJobs(tiles, 1);
      splatContainer.add(tiles.group);
    } else {
      tiles.registerPlugin(new PointTilePlugin());
      tiles.errorTarget = POINT_MOTION_ET;
      configureCache(tiles, 1500, 768);
      try { (tiles as any).parseQueue.maxJobs = 16; } catch { /* noop */ }
      pointContainer.add(tiles.group);
    }
    ctx.overlay?.refresh(); // format now known → show splat-only controls (opacity)

    // AUTO-FIT (only when no explicit transform): centre the dataset at the BIM
    // world origin so it lands near the model, ready to be nudged.
    tiles.addEventListener("load-tileset", () => {
      if (ds.originFitted || !worldDatasets.has(fileId)) return;
      ds.originFitted = true;
      if (!ds.hasExplicitTransform) {
        const sphere = new THREE.Sphere();
        tiles.getBoundingSphere(sphere);
        const c = sphere.center; // splat container flips Y/Z; account for it
        const worldCenter =
          ds.format === "splats" ? new THREE.Vector3(c.x, -c.y, -c.z) : c.clone();
        root.position.set(-worldCenter.x, -worldCenter.y, -worldCenter.z);
        ds.emitTransform(); // persist the auto-fit as the initial alignment
      }
    });
  }

  rcApi = {
    loadThreeTZ,
    loadIntoWorld,
    // All co-located controls target a specific dataset by fileId, or the ACTIVE
    // one (the most recently loaded / last selected) when fileId is omitted.
    setTransform(matrix: THREE.Matrix4, fileId?: string) {
      const ds = targetDataset(fileId);
      if (ds) {
        // root.matrixAutoUpdate is on (for the gizmo) → drive TRS, not .matrix.
        matrix.decompose(ds.root.position, ds.root.quaternion, ds.root.scale);
        ds.hasExplicitTransform = true;
      }
    },
    getTransform(fileId?: string) {
      const ds = targetDataset(fileId);
      if (!ds) return null;
      ds.root.updateMatrix();
      return ds.root.matrix.clone();
    },
    showGizmo(on: boolean) {
      if (!worldCtx) return;
      worldCtx.gizmoEnabled = on;
      worldCtx.gizmoHelper.visible = on && (activeDataset()?.visible ?? false);
    },
    setGizmoMode(mode: "translate" | "rotate" | "scale") {
      worldCtx?.gizmo.setMode(mode);
    },
    setActiveDataset(fileId: string) {
      setActiveDataset(fileId);
    },
    removeDataset(fileId: string) {
      removeDataset(fileId);
    },
    listDatasets() {
      return [...worldDatasets.keys()];
    },
    setDatasetVisible(on: boolean, fileId?: string) {
      const ds = targetDataset(fileId);
      if (!ds || !worldCtx) return;
      ds.visible = on;
      ds.root.visible = on;
      if (ds.spark) ds.spark.visible = on;
      if (ds === activeDataset()) {
        worldCtx.gizmoHelper.visible = on && worldCtx.gizmoEnabled;
      }
      try { worldCtx.world.renderer.update(); } catch { /* noop */ }
    },
    isDatasetVisible(fileId?: string) {
      return targetDataset(fileId)?.visible ?? false;
    },
    setPointSize(px: number) {
      setPointSizePx(px);
    },
    setSplatOpacity(opacity: number, fileId?: string) {
      const ds = targetDataset(fileId);
      if (!ds) return;
      ds.splatOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
      ds.splatContainer.traverse((o: any) => {
        if (o.userData?.splatCount && typeof o.opacity === "number") o.opacity = ds.splatOpacity;
      });
    },
    setMotionBudget(count: number, fileId?: string) {
      const ds = targetDataset(fileId);
      if (!ds) return;
      const v = Math.max(1000, Math.floor(count));
      if (ds.format === "splats") ds.splatBudget = v;
      else ds.pointBudget = v;
    },
    setClient(c: ThreeTZClient) {
      activeClient = c;
    },
    clear,
  };
  return rcApi;
}
