import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";
import { toolPlaceholderUri } from "../assets/tool-placeholder";

// ── Category icons / labels (copied from model-tree.ts so the two stay in
// sync without a cross-import; same iconify/mdi names bim-icon takes). ──
const prettyCategory = (category: string) => {
  const base = category.replace(/^IFC/i, "");
  if (!base) return category || "";
  return base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
};
const CATEGORY_ICONS: Record<string, string> = {
  IFCPROJECT: "mdi:sitemap",
  IFCSITE: "mdi:terrain",
  IFCBUILDING: "mdi:office-building",
  IFCBUILDINGSTOREY: "mdi:layers",
  IFCSPACE: "mdi:floor-plan",
  IFCZONE: "mdi:select-group",
  IFCWALL: "mdi:wall",
  IFCWALLSTANDARDCASE: "mdi:wall",
  IFCCURTAINWALL: "mdi:wall",
  IFCSLAB: "mdi:floor-plan",
  IFCROOF: "mdi:home-roof",
  IFCCOLUMN: "mdi:view-column",
  IFCBEAM: "mdi:minus",
  IFCMEMBER: "mdi:minus",
  IFCPLATE: "mdi:rectangle-outline",
  IFCFOOTING: "mdi:foundation",
  IFCPILE: "mdi:format-vertical-align-bottom",
  IFCSTAIR: "mdi:stairs",
  IFCSTAIRFLIGHT: "mdi:stairs",
  IFCRAMP: "mdi:slope-uphill",
  IFCRAMPFLIGHT: "mdi:slope-uphill",
  IFCRAILING: "mdi:fence",
  IFCCOVERING: "mdi:texture-box",
  IFCDOOR: "mdi:door",
  IFCWINDOW: "mdi:window-closed-variant",
  IFCOPENINGELEMENT: "mdi:vector-rectangle",
  IFCFURNISHINGELEMENT: "mdi:sofa",
  IFCFURNITURE: "mdi:sofa",
  IFCSANITARYTERMINAL: "mdi:toilet",
  IFCPIPESEGMENT: "mdi:pipe",
  IFCFLOWSEGMENT: "mdi:pipe",
  IFCDUCTSEGMENT: "mdi:pipe",
  IFCPIPEFITTING: "mdi:pipe-disconnected",
  IFCDUCTFITTING: "mdi:pipe-disconnected",
  IFCCABLECARRIERSEGMENT: "mdi:pipe",
  IFCFLOWTERMINAL: "mdi:water-pump",
  IFCLIGHTFIXTURE: "mdi:lightbulb",
  IFCOUTLET: "mdi:power-socket",
  IFCFLOWCONTROLLER: "mdi:valve",
  IFCBUILDINGELEMENTPROXY: "mdi:cube-outline",
  IFCANNOTATION: "mdi:tag-outline",
};
const iconFor = (category: string) =>
  CATEGORY_ICONS[(category || "").toUpperCase()] ?? "mdi:cube-outline";

/**
 * Properties panel — VIRTUALIZED (windowed) like the model tree. Multi-selecting
 * many elements stacks hundreds of attribute/pset rows; rendering them all as
 * DOM over the WebGL canvas costs per-frame compositing. So we flatten the
 * selected elements into a single uniform-height row list (element header,
 * attribute rows, pset header, pset rows) and render only the rows in the scroll
 * window, recycled on scroll.
 *
 * Trade-off for fixed-height windowing: values render on one line with ellipsis
 * (full text on hover via `title`), rather than wrapping.
 *
 * Listens to the Highlighter "select" set (tree/viewport drive it), reads
 * attributes + IFC psets via `getItemsData` (IsDefinedBy relation). Returns the
 * panel element; the caller mounts it.
 */
interface PropertyRow {
  name: string;
  value: string;
}
interface PropertySet {
  name: string;
  props: PropertyRow[];
}
interface ElementProps {
  title: string; // Name, else Category, else #localId
  attributes: PropertyRow[];
  psets: PropertySet[];
}

interface PanelState {
  empty: boolean;
  loading: boolean;
  message: string;
  note: string; // e.g. "Showing 40 of 120 selected"
}

const EMPTY_MESSAGE = "Select an element to see its properties.";
const MAX_ELEMENTS = 40; // cap fetch+parse (a storey select can be hundreds)
const BUFFER = 6;
// Rows wrap (no ellipsis), so heights vary. The virtualizer starts from these
// per-type estimates and corrects each row to its real height after it renders.
const EST: Record<FlatRow["t"], number> = {
  elh: 30,
  psh: 28,
  kv: 26,
  kvvar: 26, // aggregated "Varies" property row (muted)
  msg: 26,
  sp: 10,
  cat: 30, // category breakdown row (click-to-sub-select)
  crumb: 28, // breadcrumb / back chip
};

// Multi-select aggregation: we fetch the `_category` attribute for the selected
// ids in the fragments WORKER (off the main thread) and tally them in a single
// bounded main-thread pass. Very large selections are SAMPLED — we fetch+tally
// at most AGG_CAP ids (with a "showing N of M" note) so the main-thread tally
// is always bounded and never blocks on a million-item synchronous loop.
const AGG_CAP = 30000; // max ids fetched + tallied for the category breakdown
const AGG_BATCH = 5000; // ids per worker getItemsData call (per model, batched)
// Property aggregation (shared-vs-varying) fetches FULL item data — attributes +
// IsDefinedBy psets, the same expensive shape single-select uses — so its sample
// cap is far smaller than the cheap _category-only breakdown. We fetch+parse at
// most PROP_AGG_CAP items (per-model batched) and tally them in one bounded pass.
const PROP_AGG_CAP = 300; // max items fetched + tallied for property aggregation
const PROP_AGG_BATCH = 100; // ids per worker getItemsData call (full-data path)
const PROP_VARIES_SHOW = 4; // ≤ this many distinct values → list them, else "N values"

const ATTR_LABELS: Record<string, string> = {
  _category: "Category",
  _localId: "LocalId",
  _guid: "Guid",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Parse one element's getItemsData result into attributes + psets.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseElement = (data: any, localId: number): ElementProps => {
  const attributes: PropertyRow[] = [];
  let name = "";
  let category = "";
  for (const [key, attr] of Object.entries(data ?? {})) {
    if (Array.isArray(attr)) continue;
    if (attr && typeof attr === "object" && "value" in attr) {
      const value = (attr as { value: unknown }).value;
      if (value === null || value === undefined || value === "") continue;
      attributes.push({ name: ATTR_LABELS[key] ?? key, value: String(value) });
      if (key === "Name") name = String(value);
      if (key === "_category") category = String(value);
    }
  }
  const psets: PropertySet[] = [];
  const rawPsets = data?.IsDefinedBy;
  if (Array.isArray(rawPsets)) {
    for (const pset of rawPsets) {
      const psetName = pset?.Name;
      const hasProperties = pset?.HasProperties;
      if (!(psetName && "value" in psetName && Array.isArray(hasProperties))) continue;
      const props: PropertyRow[] = [];
      for (const prop of hasProperties) {
        const pName = prop?.Name;
        const nominal = prop?.NominalValue;
        if (!(pName && "value" in pName && nominal && "value" in nominal)) continue;
        if (pName.value == null || nominal.value == null) continue;
        props.push({ name: String(pName.value), value: String(nominal.value) });
      }
      psets.push({ name: String(psetName.value), props });
    }
  }
  const title = name || category || `#${localId}`;
  return { title, attributes, psets };
};

// One flat row of the windowed list.
type FlatRow =
  | { t: "elh"; title: string }
  | { t: "psh"; name: string }
  | { t: "kv"; name: string; value: string }
  | { t: "kvvar"; name: string; value: string } // muted "Varies" agg-property row
  | { t: "msg"; text: string }
  | { t: "sp" }
  | { t: "crumb"; depth: number } // breadcrumb / back chip (multi-select)
  | { t: "cat"; category: string; count: number }; // clickable category breakdown row

// ── Multi-select aggregation model ─────────────────────────────────
// A per-model selection: modelId → Set<localId>. We aggregate by asking the
// fragments WORKER for each item's `_category` (minimal attribute fetch, off
// the main thread) and tallying the returned categories in one bounded pass.
// This is the foundation for property aggregation generally: swap/extend the
// fetched attribute(s) and the per-item tally to break down by any property.
type Aggregation = {
  total: number; // total ids in the live selection
  sampled: number; // ids actually fetched + tallied (≤ total, capped at AGG_CAP)
  models: number; // distinct models in the set
  cats: { category: string; count: number }[]; // sorted desc by count
  // Property aggregation (shared-vs-varying), computed lazily on a SECOND, much
  // smaller sample (PROP_AGG_CAP) via the expensive full-data fetch. Cached on
  // the same fingerprint entry as the breakdown above. `undefined` = not yet
  // requested/in flight; once set it stays on the cached Aggregation.
  props?: PropAggregation;
};

// One aggregated property: shared across the whole sample (a single `value`) or
// VARYING (`varies` true, `distinct` distinct-value count, optional small sample
// of the values for a compact preview).
type AggProp = {
  name: string;
  varies: boolean;
  value: string; // the shared value (when !varies)
  distinct: number; // number of distinct non-empty values seen (when varies)
  values?: string[]; // up to PROP_VARIES_SHOW distinct values, for a compact hint
  present: number; // how many sampled items had this property at all
};

// Shared-vs-varying aggregation grouped like the single-select view: an
// attributes band, then one band per property-set name.
type PropAggregation = {
  sampled: number; // items fetched + parsed for the property tally (≤ PROP_AGG_CAP)
  total: number; // total ids in the live selection (for the "N of M" note)
  attributes: AggProp[];
  psets: { name: string; props: AggProp[] }[];
};

export const propertiesPanel = (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(OBF.Highlighter);
  const selectName = highlighter.config.selectName;

  let elements: ElementProps[] = [];
  let query = "";
  let flat: FlatRow[] = [];

  // ── Multi-select aggregation state ─────────────────────────────────
  // `mode` switches the windowed list between the single-element property
  // view ("props") and the aggregation/insights view ("agg").
  let mode: "props" | "agg" = "props";
  let agg: Aggregation | null = null;
  // Non-null while the property aggregation is unavailable for a reason other
  // than "still loading" (e.g. the full-data fetch failed) — shown in place of
  // the "Aggregating properties…" placeholder. Cleared on each new selection.
  let propAggError: string | null = null;
  // Selection stack: each entry is the OBC.ModelIdMap that produced the view
  // BELOW the current one, so "Back" restores the previous (wider) selection.
  // Index-clicking a category pushes the current map and re-selects the subset.
  // BOUNDED to SELSTACK_MAX so a runaway loop can never grow it without limit.
  const SELSTACK_MAX = 32;
  const selStack: OBC.ModelIdMap[] = [];

  // Aggregation result cache, keyed on a cheap fingerprint of the selection
  // (per-model size + a sampled-id hash) → re-selecting the same set is instant.
  // BOUNDED tiny LRU: only the current + a few recent results are retained so
  // the cache can never grow without bound (a crash cause we are fixing).
  const AGG_CACHE_MAX = 8;
  const aggCache = new Map<string, Aggregation>();
  const cacheGet = (key: string): Aggregation | undefined => {
    const hit = aggCache.get(key);
    if (hit) {
      // Refresh LRU recency: re-insert so it becomes most-recently-used.
      aggCache.delete(key);
      aggCache.set(key, hit);
    }
    return hit;
  };
  const cachePut = (key: string, value: Aggregation) => {
    aggCache.delete(key);
    aggCache.set(key, value);
    while (aggCache.size > AGG_CACHE_MAX) {
      const oldest = aggCache.keys().next().value;
      if (oldest === undefined) break;
      aggCache.delete(oldest);
    }
  };
  // Variable-height windowing: per-row measured heights + their prefix-sum
  // offsets (offsets[i] = top of row i; offsets[flat.length] = total height).
  let heights: number[] = [];
  let offsets: number[] = [0];

  // Virtualization DOM (created once).
  const viewport = document.createElement("div");
  viewport.className = "prop-vp";
  const sizer = document.createElement("div");
  sizer.style.position = "relative";
  sizer.style.width = "100%";
  const content = document.createElement("div");
  content.style.position = "absolute";
  content.style.top = "0";
  content.style.left = "0";
  content.style.right = "0";
  sizer.appendChild(content);
  viewport.appendChild(sizer);

  // ── Flatten the aggregation → uniform rows (category breakdown +
  //    shared-vs-varying property aggregation). READ-ONLY: no row here drives
  //    selection (cat rows render but, see content click handler, are inert). ──
  const buildAggFlat = () => {
    const out: FlatRow[] = [];
    const a = agg;
    if (!a) {
      flat = out;
      return;
    }
    const q = query.trim().toLowerCase();
    out.push({ t: "psh", name: "Category breakdown" });
    if (a.cats.length === 0) {
      out.push({ t: "msg", text: "No categories found in selection." });
    }
    // Search filters the category list (cheap; list is small).
    for (const c of a.cats) {
      if (q && !prettyCategory(c.category).toLowerCase().includes(q) && !c.category.toLowerCase().includes(q)) {
        continue;
      }
      out.push({ t: "cat", category: c.category, count: c.count });
    }
    flat = out;
  };

  // ── Flatten selected elements → uniform rows (with the search filter) ──
  const buildFlat = () => {
    if (mode === "agg") {
      buildAggFlat();
      return;
    }
    const q = query.trim().toLowerCase();
    const match = (r: PropertyRow) =>
      !q || r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q);
    const out: FlatRow[] = [];
    let first = true;
    for (const el of elements) {
      const attrs = q ? el.attributes.filter(match) : el.attributes;
      const psets = q
        ? el.psets.map((p) => ({ ...p, props: p.props.filter(match) })).filter((p) => p.props.length)
        : el.psets;
      if (q && attrs.length === 0 && psets.length === 0) continue;
      if (!first) out.push({ t: "sp" });
      first = false;
      out.push({ t: "elh", title: el.title });
      if (attrs.length === 0 && !q) out.push({ t: "msg", text: "No attributes." });
      for (const a of attrs) out.push({ t: "kv", name: a.name, value: a.value });
      for (const p of psets) {
        out.push({ t: "sp" }); // gap above each pset header → groups its rows
        out.push({ t: "psh", name: p.name });
        for (const pr of p.props) out.push({ t: "kv", name: pr.name, value: pr.value });
      }
    }
    if (elements.length > 0 && out.length === 0) {
      out.push({ t: "msg", text: "No matching properties." });
    }
    flat = out;
  };

  // ── Render the window ──────────────────────────────────────────
  const rowHtml = (r: FlatRow) => {
    switch (r.t) {
      case "elh":
        return `<div class="p-row p-elh"><bim-icon class="p-ico" icon="mdi:cube-outline"></bim-icon><span class="p-htxt">${esc(r.title)}</span></div>`;
      case "psh":
        return `<div class="p-row p-psh"><bim-icon class="p-ico" icon="mdi:format-list-bulleted-square"></bim-icon><span class="p-htxt">${esc(r.name)}</span></div>`;
      case "kv":
        return `<div class="p-row p-kv"><span class="p-k">${esc(r.name)}</span><span class="p-v">${esc(r.value)}</span></div>`;
      case "kvvar":
        return `<div class="p-row p-kv p-kvvar"><span class="p-k">${esc(r.name)}</span><span class="p-v p-vvar">${esc(r.value)}</span></div>`;
      case "msg":
        return `<div class="p-row p-msg">${esc(r.text)}</div>`;
      case "sp":
        return `<div class="p-row p-sp"></div>`;
      case "crumb":
        return `<div class="p-row p-crumb" data-act="back"><bim-icon class="p-ico" icon="mdi:arrow-left"></bim-icon><span class="p-htxt">Back to previous selection${r.depth > 1 ? ` (${r.depth} levels)` : ""}</span></div>`;
      case "cat":
        return (
          `<div class="p-row p-cat" title="${esc(prettyCategory(r.category) || r.category)}">` +
          `<bim-icon class="p-ico" icon="${iconFor(r.category)}"></bim-icon>` +
          `<span class="p-htxt p-cat-name">${esc(prettyCategory(r.category) || r.category)}</span>` +
          `<span class="p-cat-count">${r.count.toLocaleString()}</span>` +
          `</div>`
        );
    }
  };

  // Rebuild the prefix-sum offsets from row `from` onward.
  const recomputeOffsets = (from = 0) => {
    if (from <= 0) {
      offsets[0] = 0;
      from = 0;
    }
    for (let i = from; i < flat.length; i++) offsets[i + 1] = offsets[i] + heights[i];
    offsets.length = flat.length + 1;
  };

  // Largest row index whose top offset is ≤ y (binary search).
  const rowAt = (y: number) => {
    let lo = 0;
    let hi = flat.length - 1;
    let res = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] <= y) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res;
  };

  // After a window renders, correct the real (post-wrap) height of rows that were
  // just CREATED this pass (reused rows keep their already-measured height, so we
  // never re-measure them). If any height changed, refresh offsets + total so
  // scrolling and the scrollbar stay accurate. Only rows ≥ start change here, so
  // the current window's top offset never moves (no scroll jump).
  const measureNew = (newIdx: number[]) => {
    let changedFrom = -1;
    for (const i of newIdx) {
      const el = mounted.get(i);
      if (!el) continue;
      const h = el.offsetHeight;
      if (h && h !== heights[i]) {
        heights[i] = h;
        if (changedFrom < 0 || i < changedFrom) changedFrom = i;
      }
    }
    if (changedFrom >= 0) {
      recomputeOffsets(changedFrom);
      sizer.style.height = `${offsets[flat.length]}px`;
    }
  };

  // Build one row element from its HTML (entering rows get the exact same markup
  // the old innerHTML path produced — including each row's <bim-icon>).
  const buildRow = (i: number): HTMLElement => {
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(flat[i]);
    return tmp.firstElementChild as HTMLElement;
  };

  // Index→element recycler (variable height). A row that stays within the window
  // keeps its exact DOM element (and its already-rendered icon + measured height)
  // across scroll, so icons are never recreated → no blink. Only rows ENTERING
  // the window are built (and measured); rows LEAVING are removed. A forced
  // rebuild (new selection / search / data change) clears this map.
  const mounted = new Map<number, HTMLElement>();

  let lastStart = -1;
  let lastEnd = -1;
  const render = (force = false) => {
    const total = flat.length;
    sizer.style.height = `${offsets[total]}px`;
    const top = viewport.scrollTop;
    const vh = viewport.clientHeight || 300;
    const start = Math.max(0, rowAt(top) - BUFFER);
    const end = Math.min(total, rowAt(top + vh) + BUFFER + 1);
    if (!force && start === lastStart && end === lastEnd) return;
    // A forced rebuild means flat[]/heights[] were just rebuilt, so any mounted
    // element is stale — drop them all and rebuild the window once. This only
    // happens off the scroll path, so the one-time rebuild is unnoticeable;
    // plain scrolling never forces and so always reuses existing rows.
    if (force) {
      mounted.clear();
      content.textContent = "";
    }
    lastStart = start;
    lastEnd = end;
    content.style.transform = `translateY(${offsets[start]}px)`;
    // Remove rows that scrolled out of [start, end).
    for (const [i, el] of mounted) {
      if (i < start || i >= end) {
        el.remove();
        mounted.delete(i);
      }
    }
    // Insert entering rows in ascending DOM order, splicing each before the next
    // already-mounted element. Track which indices are new so only those get
    // measured (reused rows keep their measured height).
    const newIdx: number[] = [];
    let cursor = content.firstElementChild as HTMLElement | null;
    for (let i = start; i < end; i++) {
      const existing = mounted.get(i);
      if (existing) {
        cursor = existing.nextElementSibling as HTMLElement | null;
        continue;
      }
      const el = buildRow(i);
      content.insertBefore(el, cursor);
      mounted.set(i, el);
      newIdx.push(i);
    }
    if (newIdx.length) measureNew(newIdx);
  };

  const refreshList = () => {
    buildFlat();
    heights = flat.map((r) => EST[r.t]);
    offsets = new Array(flat.length + 1);
    recomputeOffsets(0);
    lastStart = lastEnd = -1;
    render(true);
  };

  let scrollRaf = 0;
  viewport.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      render();
    });
  });
  new ResizeObserver(() => render()).observe(viewport);

  // ── Panel chrome (BUI) — windowed viewport mounted into the host ──
  let searchTimer: number | undefined;
  const [panel, update] = BUI.Component.create<BUI.Panel, PanelState>(
    (state) => {
      const onHostCreated = (el?: Element) => {
        if (!el || el.contains(viewport)) return;
        el.appendChild(viewport);
        render(true);
      };
      return BUI.html`
        <bim-panel
          label="Properties"
          icon="mdi:information-outline"
          header-hidden
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .prop-vp { height: 100%; overflow-y: auto; }
            .prop-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .prop-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .prop-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }
            /* Rows are full-bleed (the host breaks out of the panel's horizontal
               padding) so every divider/band reaches both panel edges; text is
               re-inset via this padding. Heights are variable: every name/value
               wraps fully (no ellipsis), and the virtualizer measures each row. */
            .p-row { box-sizing: border-box; min-height: 24px; display: flex; align-items: flex-start; padding: 0.28rem 1.1rem; font-size: 0.78rem; line-height: 1.3; color: var(--bim-ui_bg-contrast-100, #e3e3e3); }
            .p-kv { justify-content: space-between; gap: 0.75rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            /* Key takes its natural width (never crushed below its text), but is
               capped so an overly long key wraps instead of starving the value;
               the value gets the remaining width and wraps there. */
            .p-k { opacity: 0.6; flex: 0 0 auto; max-width: 45%; overflow-wrap: anywhere; word-break: break-word; }
            .p-v { text-align: right; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
            /* Aggregated "Varies" value: muted + italic so a non-shared property
               reads as informational, distinct from a concrete shared value. */
            .p-vvar { opacity: 0.5; font-style: italic; }
            /* Section headers read as distinct bands via a subtle BACKGROUND
               (one step up from the panel surface), NOT a heavier rule — their
               top/bottom hairlines match the same 1px contrast-20 used between
               rows everywhere else, so nothing looks oddly thick. */
            /* Same treatment as the graphics-menu bands: muted (secondary)
               colour, lighter weight, compact — subordinate to the card title. */
            .p-elh, .p-psh { gap: 0.4rem; font-weight: 500; font-size: 0.76rem;
              color: var(--bim-ui_bg-contrast-70, #a7a7ab);
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-top: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .p-htxt { overflow-wrap: anywhere; word-break: break-word; }
            .p-ico { flex: 0 0 auto; margin-top: 0.05rem; color: var(--bim-ui_bg-contrast-70, #a7a7ab); font-size: 0.9rem; }
            .p-msg { opacity: 0.6; }
            .p-sp { border: none; }
            /* Category breakdown rows: clickable (sub-select), full-bleed, with a
               right-aligned count badge. */
            .p-cat { gap: 0.4rem; align-items: center;
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .p-cat-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .p-cat-count { flex: 0 0 auto; opacity: 0.75; font-variant-numeric: tabular-nums;
              padding: 0.05rem 0.4rem; border-radius: 0.6rem; font-size: 0.7rem;
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            /* Breadcrumb / back chip. */
            .p-crumb { gap: 0.4rem; cursor: pointer; align-items: center; font-weight: 600;
              color: var(--bim-ui_accent-base, var(--bim-ui_accent-base));
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .p-crumb:hover { background: var(--bim-ui_bg-contrast-20); }
            .p-crumb .p-ico { color: var(--bim-ui_accent-base, var(--bim-ui_accent-base)); }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            ${cardHeader("mdi:information-outline", "Properties", "1.1rem")}
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0.4rem 0.4rem 0.4rem 1.1rem; gap: 0;">
              ${state.empty
                ? BUI.html`<div style="
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    gap: 0.75rem; height: 100%; min-height: 12rem; padding: 1rem; text-align: center;
                  ">
                    <img src=${toolPlaceholderUri} alt="" style="width: 7.5rem; height: auto; opacity: 0.9;" />
                    <bim-label style="opacity: 0.55; white-space: normal;">${state.message}</bim-label>
                  </div>`
                : BUI.html`
                    <bim-text-input
                      icon="mdi:magnify"
                      icon-inside
                      placeholder="Filter properties…"
                      style="flex: 0 0 auto; width: 100%; margin: 0 0 0.25rem -0.35rem;"
                      @input=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const v = String((e.target as any).value ?? "");
                        if (searchTimer !== undefined) clearTimeout(searchTimer);
                        searchTimer = window.setTimeout(() => {
                          query = v;
                          viewport.scrollTop = 0;
                          refreshList();
                        }, 200);
                      }}
                    ></bim-text-input>
                    <div style="flex: 0 0 auto; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255, 255, 255, 0.1)); margin: 0 -0.4rem 0 -1.1rem;"></div>
                    ${state.note
                      ? BUI.html`<div style="flex: 0 0 auto; font-size: 0.7rem; line-height: 1.4; color: var(--bim-ui_bg-contrast-80, #c9c9c9);">${state.note}</div>`
                      : null}
                    ${state.loading
                      ? BUI.html`<div style="padding: 0.35rem;"><bim-label style="opacity: 0.6;">Loading…</bim-label></div>`
                      : null}
                    <div
                      ${BUI.ref(onHostCreated)}
                      style=${BUI.styleMap({
                        display: state.loading ? "none" : "block",
                        flex: "1 1 auto",
                        minHeight: "0",
                        // Break out of the container's horizontal padding so the
                        // windowed rows (and their dividers/bands) are full-bleed.
                        marginLeft: "-1.1rem",
                        marginRight: "-0.4rem",
                      })}
                    ></div>`}
            </div>
          </div>
        </bim-panel>
      `;
    },
    { empty: true, loading: false, message: EMPTY_MESSAGE, note: "" },
  );

  // ── Multi-select aggregation engine ────────────────────────────
  let selToken = 0;
  // Counter of panel-initiated Highlighter drives that are still in flight.
  // It is INCREMENTED immediately before a highlightByID call and DECREMENTED
  // in a `finally`, so it can never be stranded "true" if the call early-returns
  // (highlighter disabled) or throws. The next onHighlight echo treats the
  // selection as panel-initiated iff this counter is > 0. No persistent boolean
  // flag exists that a failed call could leave permanently set.
  let pendingInternalSelects = 0;
  // Drive the Highlighter from the panel (sub-select / back) with a bulletproof
  // guard: the in-flight counter is raised around the call and always lowered,
  // even on early-return or throw. Returns whether the drive actually changed
  // the highlight (so the caller can roll back its stack push if it didn't).
  const driveHighlight = async (map: OBC.ModelIdMap): Promise<void> => {
    pendingInternalSelects++;
    try {
      await highlighter.highlightByID(selectName, map, true, false);
    } finally {
      // If highlightByID early-returned/threw without emitting an onHighlight
      // echo, the echo handler never decremented us — settle on next microtask
      // so a real synchronous echo (which decrements) wins first, then clamp.
      Promise.resolve().then(() => {
        if (pendingInternalSelects > 0) pendingInternalSelects--;
      });
    }
  };

  // Cheap fingerprint: per-model size + a sampled-id xor hash. Two different
  // selections of the same sizes hashing equal is astronomically unlikely for
  // the sampled stride; a collision only re-shows a cached (correct-shape)
  // breakdown, never corrupts the live Highlighter selection.
  const fingerprint = (map: OBC.ModelIdMap) => {
    const parts: string[] = [];
    for (const modelId of Object.keys(map).sort()) {
      const set = map[modelId];
      let h = set.size >>> 0;
      let i = 0;
      const stride = Math.max(1, Math.floor(set.size / 64)); // ≤64 samples
      for (const id of set) {
        if (i % stride === 0) h = (h * 31 + id) >>> 0;
        i++;
      }
      parts.push(`${modelId}:${set.size}:${h}`);
    }
    return parts.join("|");
  };

  // Aggregate a selection into a category breakdown by fetching each item's
  // `_category` in the fragments WORKER (model.getItemsData runs off the main
  // thread) and doing ONE bounded tally of the returned values. Very large
  // selections are SAMPLED: at most AGG_CAP ids are fetched + tallied (per-model
  // batched calls), with `sampled < total` surfaced to the UI. Bails (returns
  // null) if `token` is stale — a superseded selection never schedules more
  // work. Latency is fine; the only main-thread loop is the tally over results.
  const buildAggregation = async (
    map: OBC.ModelIdMap,
    token: number,
  ): Promise<Aggregation | null> => {
    const fp = fingerprint(map);
    const hit = cacheGet(fp);
    if (hit) return hit;
    const entries = Object.entries(map).filter(([, s]) => s.size > 0);
    const total = entries.reduce((n, [, s]) => n + s.size, 0);
    const counts = new Map<string, number>();
    let sampled = 0;
    let budget = AGG_CAP; // global cap across all models in the selection

    for (const [modelId, set] of entries) {
      if (budget <= 0) break;
      const model = fragments.list.get(modelId);
      if (!model) continue;
      // Take at most `budget` ids from this model's set (sampling cap).
      const ids: number[] = [];
      for (const id of set) {
        if (ids.length >= budget) break;
        ids.push(id);
      }
      budget -= ids.length;
      // Fetch `_category` in the worker, batched, so no single call is huge.
      for (let i = 0; i < ids.length; i += AGG_BATCH) {
        const batch = ids.slice(i, i + AGG_BATCH);
        const datas = await model.getItemsData(batch, {
          attributesDefault: false,
          attributes: ["_category"],
        });
        if (token !== selToken) return null; // superseded → bail, no more work
        // Single bounded main-thread pass over the returned results.
        for (const data of datas) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const attr = (data as any)?._category;
          const cat =
            attr && typeof attr === "object" && "value" in attr && attr.value != null
              ? String(attr.value)
              : "Unknown";
          counts.set(cat, (counts.get(cat) ?? 0) + 1);
          sampled++;
        }
      }
    }
    const cats = [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    const result: Aggregation = { total, sampled, models: entries.length, cats };
    cachePut(fp, result);
    return result;
  };

  // Build the shared-vs-varying PROPERTY aggregation for a selection. This is the
  // EXPENSIVE path: it fetches FULL item data (attributes + IsDefinedBy psets,
  // the same shape single-select uses) in the fragments WORKER, so it is capped
  // hard at PROP_AGG_CAP items (per-model batched) and tallied in ONE bounded
  // pass over the parsed sample. It mutates+caches `.props` onto the SAME
  // fingerprint entry as the category breakdown (extending that cache slot), so a
  // re-selection is instant. Bails (returns null) if `token` is stale.
  const buildPropAggregation = async (
    map: OBC.ModelIdMap,
    token: number,
  ): Promise<PropAggregation | null> => {
    const fp = fingerprint(map);
    const cached = cacheGet(fp);
    if (cached?.props) return cached.props; // already computed for this selection

    const entries = Object.entries(map).filter(([, s]) => s.size > 0);
    const total = entries.reduce((n, [, s]) => n + s.size, 0);

    // Tally accumulators. For each property key we keep the first value seen, a
    // `varies` flag, a bounded set of distinct values (capped so it can never
    // grow large), and how many sampled items had it. ONE entry per distinct
    // property name — never per item — so memory is bounded by the schema, not
    // the selection size.
    type Tally = { first: string; varies: boolean; distinct: Set<string>; present: number };
    const newTally = (): Tally => ({ first: "", varies: false, distinct: new Set(), present: 0 });
    const DISTINCT_CAP = 64; // stop growing a distinct-set past this (we only need ≤ PROP_VARIES_SHOW + a count)
    // Map insertion order gives stable first-seen ordering for free, so we read
    // names back off the Maps directly — no separate order arrays needed.
    const attrTally = new Map<string, Tally>();
    const psetTally = new Map<string, Map<string, Tally>>(); // psetName → propName → Tally

    const record = (bucket: Map<string, Tally>, name: string, value: string) => {
      let t = bucket.get(name);
      if (!t) {
        t = newTally();
        t.first = value;
        bucket.set(name, t);
      }
      t.present++;
      if (value !== t.first) t.varies = true;
      if (t.distinct.size < DISTINCT_CAP) t.distinct.add(value);
    };

    let sampled = 0;
    let budget = PROP_AGG_CAP; // global cap across all models
    for (const [modelId, set] of entries) {
      if (budget <= 0) break;
      const model = fragments.list.get(modelId);
      if (!model) continue;
      const ids: number[] = [];
      for (const id of set) {
        if (ids.length >= budget) break;
        ids.push(id);
      }
      budget -= ids.length;
      for (let i = 0; i < ids.length; i += PROP_AGG_BATCH) {
        const batch = ids.slice(i, i + PROP_AGG_BATCH);
        // SAME expensive fetch shape as single-select (see onHighlight props path).
        const datas = await model.getItemsData(batch, {
          attributesDefault: true,
          relations: {
            IsDefinedBy: {
              attributes: true,
              relations: {
                HasProperties: { attributes: true, relations: false },
              },
            },
            DefinesOccurrence: { attributes: false, relations: false },
          },
        });
        if (token !== selToken) return null; // superseded → bail, no more work
        // ONE bounded pass: parse each item (reusing parseElement) and fold its
        // attributes + pset props into the per-name tallies.
        for (let j = 0; j < datas.length; j++) {
          const el = parseElement(datas[j], batch[j]);
          for (const a of el.attributes) record(attrTally, a.name, a.value);
          for (const ps of el.psets) {
            let bucket = psetTally.get(ps.name);
            if (!bucket) {
              bucket = new Map();
              psetTally.set(ps.name, bucket);
            }
            for (const pr of ps.props) record(bucket, pr.name, pr.value);
          }
        }
        sampled += datas.length;
      }
    }

    const finalize = (t: Tally, name: string): AggProp => {
      const values = [...t.distinct];
      return {
        name,
        varies: t.varies,
        value: t.first,
        distinct: t.distinct.size,
        values: t.varies && values.length <= PROP_VARIES_SHOW ? values : undefined,
        present: t.present,
      };
    };
    const attributes = [...attrTally.entries()].map(([name, t]) => finalize(t, name));
    const psets = [...psetTally.entries()].map(([psName, bucket]) => ({
      name: psName,
      props: [...bucket.entries()].map(([n, t]) => finalize(t, n)),
    }));

    const propAgg: PropAggregation = { sampled, total, attributes, psets };
    // Extend the SAME cached Aggregation entry (bounded by the existing LRU).
    const slot = cacheGet(fp);
    if (slot) slot.props = propAgg;
    return propAgg;
  };

  // Sub-select all ids of one category WITHIN the current selection. We resolve
  // the per-category id set the same worker way: fetch `_category` for the live
  // selection (batched, capped) and keep the ids whose category matches.
  const subSelectCategory = async (category: string) => {
    const current = lastMap; // the live selection we're narrowing
    if (!current) return;
    const token = selToken; // bail if the selection changes under us
    const subset: OBC.ModelIdMap = {};
    let budget = AGG_CAP;
    for (const [modelId, set] of Object.entries(current)) {
      if (budget <= 0) break;
      const model = fragments.list.get(modelId);
      if (!model) continue;
      const all: number[] = [];
      for (const id of set) {
        if (all.length >= budget) break;
        all.push(id);
      }
      budget -= all.length;
      const ids = new Set<number>();
      for (let i = 0; i < all.length; i += AGG_BATCH) {
        const batch = all.slice(i, i + AGG_BATCH);
        const datas = await model.getItemsData(batch, {
          attributesDefault: false,
          attributes: ["_category"],
        });
        if (token !== selToken) return; // superseded → bail
        datas.forEach((data, j) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const attr = (data as any)?._category;
          const value =
            attr && typeof attr === "object" && "value" in attr ? String(attr.value) : "Unknown";
          if (value === category) ids.add(batch[j]);
        });
      }
      if (ids.size > 0) subset[modelId] = ids;
    }
    if (token !== selToken) return;
    if (Object.keys(subset).length === 0) return;
    if (selStack.length >= SELSTACK_MAX) selStack.shift(); // bound depth
    selStack.push(current); // remember the wider set for "Back"
    await driveHighlight(subset);
  };

  // Restore the previous (wider) selection from the breadcrumb stack.
  const goBack = async () => {
    const prev = selStack.pop();
    if (!prev) return;
    await driveHighlight(prev);
  };

  // Delegated click on the windowed rows (category sub-select / back chip).
  content.addEventListener("click", (e) => {
    if (mode !== "agg") return;
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-act]");
    if (!row) return;
    const act = row.dataset.act;
    if (act === "back") void goBack();
    else if (act === "cat" && row.dataset.cat) void subSelectCategory(row.dataset.cat);
  });

  // ── Selection (one or many) → flat rows ────────────────────────
  // Remembers the live selection map (for sub-select intersection).
  let lastMap: OBC.ModelIdMap | null = null;
  highlighter.events.select.onHighlight.add(async (modelIdMap: OBC.ModelIdMap) => {
    const token = ++selToken;
    const total = Object.values(modelIdMap).reduce((n, set) => n + set.size, 0);
    if (total === 0) return;
    query = "";
    lastMap = modelIdMap;
    // Multi-select → aggregation/insights view. The category breakdown is built
    // by fetching `_category` in the fragments WORKER (off the main thread) and
    // tallying the results in one bounded pass — latency is fine, the main
    // thread never blocks. A "Aggregating…" state shows while it runs.
    if (total > 1) {
      // Was this onHighlight echo produced by the panel itself (sub-select /
      // back)? Read+consume one pending internal drive. The counter is raised
      // in driveHighlight around the call and always lowered in a finally, so it
      // can never be stranded; an external selection sees it at 0.
      const wasInternal = pendingInternalSelects > 0;
      if (wasInternal) pendingInternalSelects--;
      // External selection (tree/viewport) starts a fresh breadcrumb stack;
      // our own sub-select/back keeps the stack it just edited.
      if (!wasInternal) selStack.length = 0;
      mode = "agg";
      elements = [];
      agg = null;
      propAggError = null;
      update({
        empty: false,
        loading: true,
        message: "",
        note: `${total.toLocaleString()} elements selected — aggregating…`,
      });
      try {
        const result = await buildAggregation(modelIdMap, token);
        if (token !== selToken) return;
        if (!result) return;
        agg = result;
        const modelNote = result.models > 1 ? ` across ${result.models} models` : "";
        const sampleNote =
          result.sampled < result.total
            ? ` · showing ${result.sampled.toLocaleString()} of ${result.total.toLocaleString()}`
            : "";
        update({
          empty: false,
          loading: false,
          message: "",
          note: `${result.total.toLocaleString()} elements selected${modelNote} · ${result.cats.length} categor${result.cats.length === 1 ? "y" : "ies"}${sampleNote}`,
        });
        viewport.scrollTop = 0;
        refreshList(); // shows the read-only category breakdown
      } catch (error) {
        if (token !== selToken) return;
        console.warn("[properties-panel] aggregation failed", error);
        agg = null;
        update({ empty: true, loading: false, message: "Could not aggregate selection.", note: "" });
      }
      return;
    }
    // Single-select → unchanged full property view. A category sub-select that
    // narrows down to exactly one element keeps the breadcrumb stack (so "Back"
    // still works from the property view); an external single-click resets it.
    mode = "props";
    const wasInternalSingle = pendingInternalSelects > 0;
    if (wasInternalSingle) pendingInternalSelects--;
    if (!wasInternalSingle) selStack.length = 0;
    update({ empty: false, loading: true, note: "" });
    try {
      const parsed: ElementProps[] = [];
      let budget = MAX_ELEMENTS;
      for (const [modelId, set] of Object.entries(modelIdMap)) {
        if (budget <= 0) break;
        const model = fragments.list.get(modelId);
        if (!model) continue;
        const ids = [...set].slice(0, budget);
        budget -= ids.length;
        const datas = await model.getItemsData(ids, {
          attributesDefault: true,
          relations: {
            // Expand ONLY the property set's HasProperties (what the panel
            // shows), not the pset's whole relation graph. `relations: true`
            // would also pull the pset's inverse back-reference to every item
            // that shares it (thousands of siblings for a repeated family) —
            // the dominant cost. Relies on the fragments behaviour where an
            // explicit nested relations object expands only the relations it names.
            IsDefinedBy: {
              attributes: true,
              relations: {
                HasProperties: { attributes: true, relations: false },
              },
            },
            DefinesOccurrence: { attributes: false, relations: false },
          },
        });
        datas.forEach((data, i) => parsed.push(parseElement(data, ids[i])));
      }
      if (token !== selToken) return;
      elements = parsed;
      const note =
        total > parsed.length
          ? `Showing ${parsed.length} of ${total} selected`
          : total > 1
            ? `${total} elements selected`
            : "";
      update({ empty: parsed.length === 0, loading: false, note });
      viewport.scrollTop = 0;
      refreshList();
    } catch (error) {
      if (token !== selToken) return;
      console.warn("[properties-panel] failed to read item data", error);
      elements = [];
      update({ empty: true, loading: false, message: "Could not read properties." });
    }
  });

  highlighter.events.select.onClear.add(() => {
    selToken++;
    elements = [];
    query = "";
    mode = "props";
    agg = null;
    propAggError = null;
    lastMap = null;
    selStack.length = 0;
    pendingInternalSelects = 0;
    refreshList();
    update({ empty: true, loading: false, message: EMPTY_MESSAGE, note: "" });
  });

  // A model unload/reload invalidates any cached aggregations (localIds may be
  // reassigned). Drop the cache; it rebuilds lazily on the next selection.
  fragments.list.onItemDeleted.add(() => {
    aggCache.clear();
  });

  return panel;
};
