import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

/**
 * STYLES tool — a typed, generic descriptor over the viewer's visual settings so
 * a UI (the bottom-left helper panel) can render controls without poking the
 * postproduction renderer internals.
 *
 * Every entry reads/writes LIVE: the deferred composite re-reads its `settings`
 * each frame, the AO/FXAA flags are read per-frame, and `renderScale` /
 * `adaptiveResolution` apply on assignment — so no rebuild or lib change is
 * needed. Mutating a setting takes effect on the next rendered frame.
 *
 * NOTE on presets: setting `Style preset` runs the engine's
 * `_applyDeferredStyle`, which overwrites `Surface color`, `Edges` and
 * `Ambient occlusion` to the preset's combination. After changing the preset,
 * re-read all settings to refresh the panel.
 */
export type StyleSetting =
  | {
      key: string;
      label: string;
      group: string;
      type: "bool";
      default: boolean;
      get(): boolean;
      set(v: boolean): void;
    }
  | {
      key: string;
      label: string;
      group: string;
      type: "number";
      default: number;
      min: number;
      max: number;
      step: number;
      get(): number;
      set(v: number): void;
    }
  | {
      key: string;
      label: string;
      group: string;
      type: "color"; // value is a "#rrggbb" hex string
      default: string;
      get(): string;
      set(v: string): void;
    }
  | {
      key: string;
      label: string;
      group: string;
      type: "enum";
      default: string | number;
      options: { label: string; value: string | number }[];
      get(): string | number;
      set(v: string | number): void;
    };

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

// Background state is MODULE-scoped so it survives styles() re-creation (the
// graphics panel rebuilds the descriptor on every refresh — a per-instance
// `lastBg` re-clobbered a user-picked background to 0x202020 one frame after the
// pick, #30). `stylesLastBg` is the remembered OPAQUE colour: it persists even
// while transparent mode zeroes the renderer's clear colour, so toggling back to
// opaque restores the picked hue. The 0x202020 default is applied to the
// renderer exactly once.
let stylesBgInitialized = false;
const stylesLastBg = new THREE.Color(0x202020);

export const styles = (
  components: OBC.Components,
  world: OBC.World,
): { settings: StyleSetting[] } => {
  const renderer = world.renderer as OBF.PostproductionRenderer;

  // Lazy accessors — resolved at call time so they always hit the live objects
  // (the deferred pipeline is allocated once postproduction is up).
  const pp = () => renderer.postproduction;
  const deferred = () => renderer.postproduction.deferred;
  const composite = () => renderer.postproduction.deferred.composite.settings;
  const grid = () => components.get(OBC.Grids).list.get(world.uuid);
  const scene = world.scene.three as THREE.Scene;
  const three = () => renderer.three as THREE.WebGLRenderer;

  // Background is driven through the RENDERER CLEAR colour/alpha, not
  // scene.background. Under the deferred pen pipeline the composite passes the
  // captured clear straight through for background pixels, so the clear colour IS
  // the viewport background; setting scene.background to a THREE.Color instead
  // makes three force-clear the capture G-buffer mid-pass and the whole model
  // vanishes (#30). Keep scene.background null and own the clear here.
  scene.background = null;
  // Apply the default opaque dark background ONCE (never on a rebuild — that was
  // the #30 reset). The remembered colour itself is the module-scoped
  // `stylesLastBg`, so a rebuild never clobbers a user pick.
  if (!stylesBgInitialized) {
    stylesBgInitialized = true;
    three().setClearColor(stylesLastBg, 1);
  }

  const A = OBF.PostproductionAspect;

  const settings: StyleSetting[] = [
    // ── Preset ──────────────────────────────────────────────────────
    {
      key: "preset",
      label: "Style preset",
      group: "Preset",
      type: "enum",
      default: A.COLOR_PEN_SHADOWS,
      options: [
        { label: "Color + edges + shadows", value: A.COLOR_PEN_SHADOWS },
        { label: "Color", value: A.COLOR },
        { label: "Color + edges", value: A.COLOR_PEN },
        { label: "Color + shadows", value: A.COLOR_SHADOWS },
        { label: "Pen (edges only)", value: A.PEN },
        { label: "Pen + shadows", value: A.PEN_SHADOWS },
      ],
      get: () => pp().style,
      set: (v) => {
        pp().style = v as OBF.PostproductionAspect;
      },
    },
    {
      key: "postproductionEnabled",
      label: "Postproduction",
      group: "Preset",
      type: "bool",
      default: true,
      get: () => pp().enabled,
      set: (v) => {
        pp().enabled = v;
      },
    },

    // ── Edges (contour) ─────────────────────────────────────────────
    {
      key: "edges",
      label: "Edges",
      group: "Edges",
      type: "bool",
      default: true,
      get: () => composite().contourEnabled,
      set: (v) => {
        composite().contourEnabled = v;
      },
    },
    {
      key: "edgeColor",
      label: "Edge color",
      group: "Edges",
      type: "color",
      default: "#000000",
      get: () => hex(composite().edgeColor),
      set: (v) => composite().edgeColor.set(v),
    },
    {
      key: "edgeStrength",
      label: "Edge strength",
      group: "Edges",
      type: "number",
      default: 0.8,
      min: 0,
      max: 1,
      step: 0.05,
      get: () => composite().edgeStrength,
      set: (v) => {
        composite().edgeStrength = v;
      },
    },

    // ── Shading ─────────────────────────────────────────────────────
    {
      key: "surfaceColor",
      label: "Surface color (off = paper)",
      group: "Shading",
      type: "bool",
      default: true,
      get: () => composite().colorEnabled,
      set: (v) => {
        composite().colorEnabled = v;
      },
    },
    {
      key: "ao",
      label: "Ambient occlusion",
      group: "Shading",
      type: "bool",
      default: true,
      get: () => deferred().settings.aoEnabled,
      set: (v) => {
        deferred().settings.aoEnabled = v;
      },
    },
    {
      key: "aoStrength",
      label: "AO strength",
      group: "Shading",
      type: "number",
      default: 1.0,
      min: 0,
      max: 2,
      step: 0.05,
      get: () => composite().aoStrength,
      set: (v) => {
        composite().aoStrength = v;
      },
    },
    {
      key: "tonalShading",
      label: "Tonal shading",
      group: "Shading",
      type: "bool",
      default: true,
      get: () => composite().tonalShadingEnabled,
      set: (v) => {
        composite().tonalShadingEnabled = v;
      },
    },
    {
      key: "tonalFloor",
      label: "Tonal floor",
      group: "Shading",
      type: "number",
      default: 0.7,
      min: 0,
      max: 1,
      step: 0.05,
      get: () => composite().tonalFloor,
      set: (v) => {
        composite().tonalFloor = v;
      },
    },

    // ── Scene ───────────────────────────────────────────────────────
    {
      key: "transparentBackground",
      label: "Transparent background",
      group: "Scene",
      type: "bool",
      default: true,
      // Transparent === clear alpha 0 (page/scene behind shows through).
      get: () => three().getClearAlpha() === 0,
      set: (v) => {
        scene.background = null;
        if (v) {
          // TRUE transparency: zero the RGB too, not just alpha. The composite
          // passes the clear straight through and the canvas composites
          // premultiplied, so a non-zero rgb at alpha 0 ADDS that colour over the
          // page (the picked colour bled through as a tint). (0,0,0,0) = clean
          // page-through with no tint. The hue is remembered in stylesLastBg.
          three().setClearColor(0x000000, 0);
        } else {
          three().setClearColor(stylesLastBg, 1);
        }
      },
    },
    {
      key: "backgroundColor",
      label: "Background color",
      group: "Scene",
      type: "color",
      // Reflect the remembered hue even while transparent (clear rgb is zeroed).
      default: `#${stylesLastBg.getHexString()}`,
      get: () => hex(stylesLastBg),
      set: (v) => {
        stylesLastBg.set(v);
        scene.background = null;
        // Choosing a colour means you want to SEE it → make the background
        // opaque (alpha 1). The Transparent toggle re-reads alpha on refresh and
        // flips off to match.
        three().setClearColor(stylesLastBg, 1);
      },
    },
    {
      key: "grid",
      label: "Grid",
      group: "Scene",
      type: "bool",
      default: true,
      get: () => grid()?.config.visible ?? false,
      set: (v) => {
        const g = grid();
        if (g) g.config.visible = v;
      },
    },
    {
      key: "gridColor",
      label: "Grid color",
      group: "Scene",
      type: "color",
      default: "#d3d3d3",
      get: () => {
        const g = grid();
        return g ? hex(g.config.color) : "#d3d3d3";
      },
      set: (v) => {
        const g = grid();
        if (g) g.config.color = new THREE.Color(v);
      },
    },

    // ── Quality / performance ───────────────────────────────────────
    {
      key: "fxaa",
      label: "Anti-aliasing (FXAA)",
      group: "Quality",
      type: "bool",
      default: true,
      get: () => deferred().settings.fxaaEnabled,
      set: (v) => {
        deferred().settings.fxaaEnabled = v;
      },
    },
    {
      key: "renderScale",
      label: "Render scale",
      group: "Quality",
      type: "number",
      default: 1.0,
      min: 0.25,
      max: 1,
      step: 0.05,
      get: () => deferred().renderScale,
      set: (v) => {
        deferred().renderScale = v;
      },
    },
    {
      key: "adaptiveResolution",
      label: "Adaptive resolution",
      group: "Quality",
      type: "bool",
      default: true,
      get: () => renderer.adaptiveResolution,
      set: (v) => {
        renderer.adaptiveResolution = v;
      },
    },
    {
      key: "targetFps",
      label: "Target FPS",
      group: "Quality",
      type: "number",
      default: 60,
      min: 24,
      max: 120,
      step: 5,
      get: () => renderer.adaptiveTargetFps,
      set: (v) => {
        renderer.adaptiveTargetFps = v;
      },
    },
    {
      key: "highResOutline",
      label: "High-res selection outline",
      group: "Quality",
      type: "bool",
      default: true,
      // false → render the selection outline at half resolution (cheaper when a
      // selection covers much of the screen, slightly softer); true → full res.
      get: () => components.get(OBF.Outliner).resolutionScale >= 1,
      set: (v) => {
        components.get(OBF.Outliner).resolutionScale = v ? 1 : 0.5;
      },
    },
  ];

  return { settings };
};
