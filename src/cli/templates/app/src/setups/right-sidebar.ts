import * as BUI from "@thatopen/ui";

/**
 * Mounts several panels as SEPARATE cards stacked vertically on the RIGHT,
 * together spanning the full viewport height. One right-docked `bim-grid
 * floating` holds one row per region (heights split by `grow`); the floating
 * grid's built-in 1rem gap shows between the cards, and its empty "rest" column
 * clicks through to the model. Each region is its own `bim-panel` (own
 * header/border), so they read as distinct cards — not one card with a divider.
 *
 * Each panel element should be `height: 100%` so it fills its row and scrolls
 * internally when its content is tall.
 *
 * @param container the viewport element to overlay
 * @param regions the panels to stack, top to bottom
 * @returns the floating grid element (already appended to the container)
 */
export interface StackRegion {
  /** The panel element for this region. */
  element: HTMLElement;
  /** Relative height share (CSS grid `fr`). Defaults to 1 (equal split). */
  grow?: number;
}

export const rightStack = (container: HTMLElement, regions: StackRegion[]) => {
  // ── Collapse toggle (mirror of the left files panel's) ─────────
  // A bare chevron in its own thin grid column in the gutter, just OUTSIDE the
  // cards (to their left). Collapsing swaps the grid layout to drop the card
  // columns entirely; the chevron column stays. When collapsed the chevron sits
  // inset from the right edge (the grid's 1rem padding), so it stays in view.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gridEl: any = null;
  let collapsed = false;

  const [toggle, toggleUpdate] = BUI.Component.create<
    HTMLElement,
    { collapsed: boolean }
  >(
    (s) => BUI.html`
      <div
        style="
          height: 100%; display: flex; align-items: flex-start;
          pointer-events: none; padding-top: 0.5rem; padding-right: 0.1rem;
        "
      >
        <span
          role="button"
          title=${s.collapsed ? "Show panel" : "Hide panel"}
          @click=${() => setCollapsed(!s.collapsed)}
          style="
            pointer-events: auto; cursor: pointer; display: inline-flex;
            color: var(--bim-ui_bg-contrast-80, #c9c9c9);
          "
        ><bim-icon
          icon=${s.collapsed ? "mdi:chevron-left" : "mdi:chevron-right"}
          style="font-size: 1.2rem;"
        ></bim-icon></span>
      </div>
    `,
    { collapsed: false },
  );

  const setCollapsed = (v: boolean) => {
    collapsed = v;
    if (gridEl) gridEl.layout = v ? "collapsed" : "main";
    toggleUpdate({ collapsed: v });
  };

  // ── Floating grid: cards docked full-height right, chevron in the gutter ──
  const grid = BUI.Component.create(() => {
    const onCreated = (element?: Element) => {
      if (!element) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = element as any;
      gridEl = g;
      const names = regions.map((_, i) => `r${i}`);
      g.elements = {
        toggle,
        ...Object.fromEntries(regions.map((r, i) => [names[i], r.element])),
      };
      // One row per region; columns: rest (1fr, click-through) | toggle | cards.
      // The "toggle" area repeats across rows → one full-height gutter column.
      const rows = regions
        .map((r, i) => `"rest toggle ${names[i]}" ${r.grow ?? 1}fr`)
        .join("\n");
      g.layouts = {
        main: { template: `${rows}\n/ 1fr auto auto` },
        // Collapsed: drop the card columns; keep rest + toggle (toggle ends up
        // near the right edge, inset by the grid's 1rem padding).
        collapsed: { template: `"rest toggle" 1fr\n/ 1fr auto` },
      };
      g.layout = collapsed ? "collapsed" : "main";
    };
    return BUI.html`
      <bim-grid style="padding: 1rem;" ${BUI.ref(onCreated)} floating></bim-grid>
    `;
  });
  container.append(grid);

  return { grid };
};

/**
 * Mirror of {@link rightStack} for the LEFT side: cards stacked vertically on
 * the left (full height), same 1rem gap + outer margins, with a collapse chevron
 * in the gutter to the RIGHT of the cards (facing the viewport). Used for the
 * Files (top) + helper (bottom) stack.
 */
export const leftStack = (container: HTMLElement, regions: StackRegion[]) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let gridEl: any = null;
  let collapsed = false;

  const [toggle, toggleUpdate] = BUI.Component.create<
    HTMLElement,
    { collapsed: boolean }
  >(
    (s) => BUI.html`
      <div
        style="
          height: 100%; display: flex; align-items: flex-start;
          pointer-events: none; padding-top: 0.5rem; padding-left: 0.1rem;
        "
      >
        <span
          role="button"
          title=${s.collapsed ? "Show panel" : "Hide panel"}
          @click=${() => setCollapsed(!s.collapsed)}
          style="
            pointer-events: auto; cursor: pointer; display: inline-flex;
            color: var(--bim-ui_bg-contrast-80, #c9c9c9);
          "
        ><bim-icon
          icon=${s.collapsed ? "mdi:chevron-right" : "mdi:chevron-left"}
          style="font-size: 1.2rem;"
        ></bim-icon></span>
      </div>
    `,
    { collapsed: false },
  );

  const setCollapsed = (v: boolean) => {
    collapsed = v;
    if (gridEl) gridEl.layout = v ? "collapsed" : "main";
    toggleUpdate({ collapsed: v });
  };

  const grid = BUI.Component.create(() => {
    const onCreated = (element?: Element) => {
      if (!element) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = element as any;
      gridEl = g;
      const names = regions.map((_, i) => `r${i}`);
      g.elements = {
        toggle,
        ...Object.fromEntries(regions.map((r, i) => [names[i], r.element])),
      };
      // Columns: cards | toggle (gutter, facing viewport) | rest (click-through).
      const rows = regions
        .map((r, i) => `"${names[i]} toggle rest" ${r.grow ?? 1}fr`)
        .join("\n");
      g.layouts = {
        main: { template: `${rows}\n/ auto auto 1fr` },
        // Collapsed: drop the card columns; toggle stays at the left edge (inset
        // by the grid's 1rem padding).
        collapsed: { template: `"toggle rest" 1fr\n/ auto 1fr` },
      };
      g.layout = collapsed ? "collapsed" : "main";
    };
    return BUI.html`
      <bim-grid style="padding: 1rem;" ${BUI.ref(onCreated)} floating></bim-grid>
    `;
  });
  container.append(grid);

  return { grid };
};
