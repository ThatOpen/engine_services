/**
 * Small FPS counter, mounted INSIDE the viewer (top-center overlay). Measures
 * the browser animation-frame rate (a good proxy for overall responsiveness).
 *
 * It is styled like the rest of the app (panel surface + 1px contrast-20 border
 * + theme text), not a raw green-on-black badge, and is TOGGLEABLE — the
 * returned controller's `setVisible` is wired to a "Show FPS" switch in the
 * Graphics panel. The rAF loop keeps running while hidden (cost is negligible);
 * only the element's visibility changes.
 */
export interface FpsIndicator {
  /** The overlay element (already mounted inside the viewer). */
  element: HTMLElement;
  /** Whether the counter is currently shown. */
  readonly visible: boolean;
  /** Show / hide the counter. */
  setVisible: (v: boolean) => void;
}

export const fpsIndicator = (parent: HTMLElement): FpsIndicator => {
  const el = document.createElement("div");
  el.style.cssText = `
    position: absolute; top: 0.6rem; left: 50%; transform: translateX(-50%); z-index: 10;
    padding: 0.2rem 0.55rem; border-radius: 0.5rem;
    background: var(--bim-ui_bg-contrast-10, #262629);
    border: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
    color: var(--bim-ui_bg-contrast-100, #e3e3e3);
    font: 600 0.72rem/1.2 ui-monospace, monospace;
    pointer-events: none; user-select: none;
  `;
  el.textContent = "-- FPS";
  // The viewer is position:relative (set in viewports-manager for the anchor
  // dot), so an absolutely-positioned child overlays the canvas correctly.
  if (!parent.style.position) parent.style.position = "relative";
  parent.append(el);

  let visible = true;
  let frames = 0;
  let last = performance.now();
  const tick = (now: number) => {
    frames += 1;
    const dt = now - last;
    if (dt >= 500) {
      el.textContent = `${Math.round((frames * 1000) / dt)} FPS`;
      frames = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return {
    element: el,
    get visible() {
      return visible;
    },
    setVisible: (v: boolean) => {
      visible = v;
      el.style.display = v ? "block" : "none";
    },
  };
};
