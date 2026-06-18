import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";
import { getAppManager } from "../app";

/**
 * ELEMENT DATA TABLE (Trimble-style) — a VIRTUALIZED (windowed) tabular browser.
 *
 * Rows = elements; columns = attributes + property-set values + quantities. The
 * table is sortable (click a header), filterable (text box, all visible columns),
 * groupable (None / Category / Storey, with collapsible group bands), exports
 * CSV, and is two-way bound to the 3D selection (click a row → highlight in 3D;
 * a 3D/tree selection reflects back as selected rows). A COLUMN PICKER popover
 * lets the user choose which of the discovered (heterogeneous) attribute / pset /
 * quantity columns are shown — and assign each a roll-up function. Per-group
 * roll-up cells (sum/avg/min/max/count/distinct, or a shared-value/"varies"
 * sentinel for non-aggregated columns) and a footer grand total present the
 * aggregation (quantity-takeoff style). Filtering is a structured AND-of-ORs
 * query (typed per-column operators) plus a quick contains box.
 *
 * WHY VIRTUALIZED: bim-table renders every row as real DOM over the WebGL canvas
 * (per-frame compositing cost) — see model-tree.ts' header. This hand-rolls the
 * same windowed list: fixed-height rows, a scroll viewport + sizer, and only the
 * rows in the scroll window are in the DOM (recycled on scroll). Horizontal
 * layout is fixed-width cells; one sticky header row scrolls with the body.
 *
 * DATA LAYER (interned columnar): the worker returns a COLUMNAR + INTERNED table
 * — a shared string dictionary plus, per column, an Int32Array of dictionary
 * indices (text) and (numeric columns) a Float64Array (num). We keep a master
 * dictionary + per-column typed arrays aligned by rowIdx; a "row" is just a
 * rowIdx and a cell resolves via cellText/cellNum (no per-row objects). FIRST
 * PAINT is attributes-only — `model.getTableData({ mode: "attributes" })`, ~sub-
 * second — and pset/quantity columns are filled lazily in the BACKGROUND
 * (`model.getTablePsets`, batched per model, merged progressively) so the panel
 * is interactive immediately and pset-column ops light up as they land. Each
 * payload carries its own dictionary, remapped into the master one on merge.
 * Type-level psets are merged worker-side (includeTypePsets, instance wins). The
 * store is bounded (MAX_ROWS) so footer aggregation is a plain columnar scan.
 * Storey is enriched client-side (cheap spatial-tree walk) — the worker table has
 * no storey column.
 *
 * @param components engine components
 */

const ROW_H = 26; // px, fixed row height (data + group rows) → simple windowing
const HEAD_H = 30; // px, sticky header row height
const INDENT = 14; // px per group-nesting level (multi-level grouping indent)
const CELL_PAD = 8; // px base left padding of a cell (≈ the .dt-c 0.5rem)
const MIN_COL = 72; // px floor on rendered column width → stays readable in the narrow panel
const BUFFER = 8; // extra rows above/below the viewport
// Hard cap on TOTAL indexed elements across ALL loaded models (surfaced via the
// note). Generous because the interned columnar store is ~6-8x lighter than the
// old array-of-objects, so a single large model can't starve a second model's
// rows out of the budget (the multi-model case).
const MAX_ROWS = 100000;

// Spatial containers are not table rows (they're structure, not elements).
const CONTAINER_CATEGORIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
]);

const prettyCategory = (category: string) => {
  const base = (category || "").replace(/^IFC/i, "");
  if (!base) return category || "";
  return base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Strict numeric parse: only a bare integer/decimal counts as a number (so "C25/30"
// or "true" stay text). Returns NaN when the value is not purely numeric.
const asNumber = (v: string): number => {
  const t = v.trim();
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
};

const fmtNum = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 3 });

// ── Filter model (grimoire: filter-operator-set + query-expression-form) ──────
// Normalized-string-compare: case- AND diacritic-insensitive comparison key, so
// "Café" matches "cafe". Shared by the filter and the quick search.
const normText = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Precision-bounded-numeric-compare: round both operands before comparing so
// float error (2.4000001 vs 2.4) doesn't flip an equality / boundary test.
const roundC = (n: number) => Math.round(n * 1e6) / 1e6;

// Per-column-type operator catalogue (filter-operator-set). Presence operators
// (set/not-set/empty) are shared; the rest are type-gated. Each operator has a
// negated form where relevant, so per-operator negation covers what a NOT node
// would (serializable-normal-form: no standalone NOT combinator).
type Op =
  | "contains" | "ncontains" | "eq" | "neq" | "starts" // text
  | "eqn" | "neqn" | "lt" | "le" | "gt" | "ge" | "between" // number
  | "empty" | "set" | "unset"; // presence (any type)
const TEXT_OPS: { op: Op; label: string }[] = [
  { op: "contains", label: "contains" },
  { op: "ncontains", label: "not contains" },
  { op: "eq", label: "equals" },
  { op: "neq", label: "not equals" },
  { op: "starts", label: "starts with" },
  { op: "empty", label: "is empty" },
  { op: "set", label: "is set" },
  { op: "unset", label: "not set" },
];
const NUM_OPS: { op: Op; label: string }[] = [
  { op: "eqn", label: "=" },
  { op: "neqn", label: "≠" },
  { op: "lt", label: "<" },
  { op: "le", label: "≤" },
  { op: "gt", label: ">" },
  { op: "ge", label: "≥" },
  { op: "between", label: "between" },
  { op: "set", label: "is set" },
  { op: "unset", label: "not set" },
];
const PRESENCE_OPS = new Set<Op>(["empty", "set", "unset"]);

// One filter condition. The list compiles to AND-of-ORs: an `OR`-tagged
// condition joins the previous disjunctive group; an `AND`-tagged one starts a
// new group; the groups are conjoined (serializable-normal-form).
interface Condition {
  id: number;
  col: string;
  op: Op;
  v: string; // operand
  v2: string; // second operand (between)
  conj: "AND" | "OR";
}

// ── Aggregation model (grimoire: aggregation-presentation) ────────────────────
// per-column-function-selection: each column may carry a roll-up function. sum/
// avg/min/max apply to numeric columns; count/distinct apply to any.
type AggFn = "sum" | "avg" | "min" | "max" | "count" | "distinct";
const NUM_FNS: AggFn[] = ["sum", "avg", "min", "max", "count", "distinct"];
const ANY_FNS: AggFn[] = ["count", "distinct"];
const fnsFor = (kind: "text" | "number") => (kind === "number" ? NUM_FNS : ANY_FNS);

// (computeAgg + groupShared live inside the panel closure — they read the
// interned columnar store via the cell accessors.)

// ── Saved views (grimoire: saved-configuration) ───────────────────────────────
// The MEANINGFUL config of the table — visible columns, aggregations, the AND-of-
// ORs filter (+ quick text), multi-key sort, and group levels. Incidental state
// (scroll, hover, selection) is excluded so dirty-detection doesn't fire on noise.
interface ViewConfig {
  visibleCols: string[];
  aggs: [string, AggFn][]; // sorted by key for canonical serialization
  conditions: Omit<Condition, "id">[]; // volatile `id` dropped (canonical)
  query: string;
  sortSpec: { col: string; dir: 1 | -1 }[];
  groupCols: string[];
}
interface SavedView {
  name: string; // personal scope (no elevated-permission path needed)
  config: ViewConfig;
}

// ── Column model (INTERNED COLUMNAR) ───────────────────────────────
// Mirrors the worker's TableData column: UI metadata (key/group/label/kind/
// width) PLUS the columnar data. `text[rowIdx]` is an index into the panel's
// master `strings` dictionary (-1 = no value); `num[rowIdx]` (numeric columns
// only) is the canonical value for sort/aggregate (NaN = no value). Arrays are
// length === rowCount, aligned by rowIdx. There is NO per-row object: a "row"
// is just a rowIdx, and a cell resolves via cellText/cellNum (see below).
interface Col {
  key: string;
  group: string; // "Attributes" | "Spatial" | pset name | quantity-set name
  label: string;
  kind: "text" | "number";
  width: number; // px
  text: Int32Array; // dictionary index per row (-1 = no value)
  num: Float64Array | null; // numeric per row (NaN = no value); null for text columns
}

// Fixed attribute columns offered by default / in the picker.
const ATTR_COLUMNS: { attr: string; key: string; label: string; width: number }[] = [
  { attr: "_category", key: "attr:_category", label: "Category", width: 150 },
  { attr: "Name", key: "attr:Name", label: "Name", width: 220 },
  { attr: "_localId", key: "attr:_localId", label: "LocalId", width: 90 },
  { attr: "_guid", key: "attr:_guid", label: "GUID", width: 200 },
  { attr: "ObjectType", key: "attr:ObjectType", label: "Object Type", width: 160 },
  { attr: "PredefinedType", key: "attr:PredefinedType", label: "Predefined Type", width: 150 },
  { attr: "Tag", key: "attr:Tag", label: "Tag", width: 110 },
  { attr: "Description", key: "attr:Description", label: "Description", width: 200 },
];
const STOREY_KEY = "meta:storey";
const DEFAULT_VISIBLE = ["attr:_category", "attr:Name", STOREY_KEY];

export const dataTablePanel = (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(OBF.Highlighter);
  const selectName = highlighter.config.selectName;

  // ── Interned columnar store ────────────────────────────────────
  // The master string dictionary + per-column typed arrays, aligned by rowIdx.
  // A "row" is a rowIdx in [0, rowCount); cells resolve through cellText/cellNum.
  let strings: string[] = []; // master dictionary (text cells index into this)
  let intern = new Map<string, number>(); // string -> dictionary index (dedupe)
  let rowCount = 0;
  let rowLocalId = new Uint32Array(0); // rowIdx -> element localId
  let rowModelIdx = new Uint16Array(0); // rowIdx -> index into modelIdsOrder
  let modelIdsOrder: string[] = []; // model id per rowModelIdx slot
  const columns = new Map<string, Col>(); // discovered RAW columns (per-pset, all)
  let visibleCols: string[] = [...DEFAULT_VISIBLE]; // ordered visible column keys

  // ── Name-collapse layer (default ON) ───────────────────────────
  // The pset/quantity columns are keyed by (set, prop), so the same property
  // (e.g. "GrossArea") appears once per pset. By default the COLUMN UNIVERSE the
  // user sees (picker / filter / group / sort / agg) collapses those to ONE entry
  // per property NAME, unioning values across psets; "Show by pset" flips back to
  // the raw provenance keys. nameMembers maps a universe key -> its raw member
  // keys; collapsedMeta holds the synthetic column metadata.
  type ColMeta = { key: string; label: string; group: string; kind: "text" | "number"; width: number; conflict?: boolean };
  let collapseByName = true;
  const nameMembers = new Map<string, string[]>();
  const collapsedMeta = new Map<string, ColMeta>();
  const rebuildNameIndex = () => {
    nameMembers.clear();
    collapsedMeta.clear();
    const byName = new Map<string, Col[]>();
    for (const c of columns.values()) {
      const isProp = c.group !== "Attributes" && c.group !== "Spatial";
      if (!isProp) {
        // attr / storey columns are already unique → carry through as themselves.
        nameMembers.set(c.key, [c.key]);
        collapsedMeta.set(c.key, { key: c.key, label: c.label, group: c.group, kind: c.kind, width: c.width });
      } else {
        let arr = byName.get(c.label);
        if (!arr) {
          arr = [];
          byName.set(c.label, arr);
        }
        arr.push(c);
      }
    }
    for (const [name, cols] of byName) {
      const key = `name:${name}`;
      const allNum = cols.every((c) => c.kind === "number");
      const anyNum = cols.some((c) => c.kind === "number");
      collapsedMeta.set(key, {
        key,
        label: name,
        group: "Properties",
        kind: allNum ? "number" : "text",
        width: Math.max(...cols.map((c) => c.width)),
        conflict: anyNum && !allNum, // mixed type across psets → flagged, not coerced
      });
      nameMembers.set(key, cols.map((c) => c.key));
    }
  };
  // Active-universe column metadata for a key (collapsed or raw, per mode).
  const colMeta = (key: string): ColMeta | Col | undefined =>
    collapseByName ? collapsedMeta.get(key) : columns.get(key);
  // The active column universe (what the picker / filter / group dropdowns list).
  const universe = (): ColMeta[] | Col[] =>
    collapseByName ? [...collapsedMeta.values()] : [...columns.values()];
  // Whether a key exists in the ACTIVE universe (mode-aware existence check).
  const inUniverse = (key: string): boolean =>
    collapseByName ? collapsedMeta.has(key) : columns.has(key);

  // ── Cell accessors (the ONLY way to read the columnar store) ───
  const internStr = (s: string): number => {
    let i = intern.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      intern.set(s, i);
    }
    return i;
  };
  const rowKeyOf = (r: number): string => `${modelIdsOrder[rowModelIdx[r]]}:${rowLocalId[r]}`;
  // Raw single-column resolution (operates on the per-pset store directly).
  const rawText = (r: number, key: string): string => {
    const c = columns.get(key);
    if (!c) return "";
    const i = c.text[r];
    return i < 0 ? "" : strings[i];
  };
  const rawNum = (r: number, key: string): number => {
    const c = columns.get(key);
    if (!c) return NaN;
    if (c.num) return c.num[r];
    const i = c.text[r];
    return i < 0 ? NaN : asNumber(strings[i]);
  };
  const rawHas = (r: number, key: string): boolean => {
    const c = columns.get(key);
    return !!c && c.text[r] >= 0;
  };
  // Collapse-aware resolution (the ONLY accessors the feature code uses). In
  // by-pset mode they're 1:1 with raw. In collapse mode a property key unions its
  // member psets: present iff ANY member has it; agreed value if all present
  // members match, else the "Varies" sentinel; numeric "varies"/missing → NaN
  // (excluded from numeric compare/agg — conflicting elements are skipped, not
  // zeroed).
  const cellText = (r: number, key: string): string => {
    if (!collapseByName) return rawText(r, key);
    const members = nameMembers.get(key);
    if (!members) return "";
    if (members.length === 1) return rawText(r, members[0]);
    let val: string | undefined;
    let has = false;
    let varies = false;
    for (const m of members) {
      if (!rawHas(r, m)) continue;
      const v = rawText(r, m);
      if (!has) {
        val = v;
        has = true;
      } else if (v !== val) {
        varies = true;
      }
    }
    return !has ? "" : varies ? "Varies" : (val ?? "");
  };
  const cellNum = (r: number, key: string): number => {
    if (!collapseByName) return rawNum(r, key);
    const members = nameMembers.get(key);
    if (!members) return NaN;
    if (members.length === 1) return rawNum(r, members[0]);
    let val = NaN;
    let has = false;
    let varies = false;
    for (const m of members) {
      if (!rawHas(r, m)) continue;
      const n = rawNum(r, m);
      if (!has) {
        val = n;
        has = true;
      } else if (n !== val) {
        varies = true;
      }
    }
    return !has || varies ? NaN : val;
  };
  const cellHas = (r: number, key: string): boolean => {
    if (!collapseByName) return rawHas(r, key);
    const members = nameMembers.get(key);
    if (!members) return false;
    return members.some((m) => rawHas(r, m));
  };

  // Retained store size (bytes): dictionary chars (UTF-16 + per-string overhead)
  // + every column's typed arrays + the row arrays. The typed-array term is
  // O(rows × cols) and DENSE regardless of sparsity (a column allocates a full
  // text[rowCount], and num[rowCount] if numeric), so it scales linearly with
  // rows and with the number of discovered columns — independent of how many
  // cells actually have values. Interning makes the dictionary sub-linear (a
  // category/type string is stored once no matter how many rows repeat it).
  const storeBytes = () => {
    let dict = 0;
    for (const s of strings) dict += s.length * 2 + 16; // UTF-16 + ~obj overhead
    let arrays = 0;
    for (const c of columns.values()) arrays += c.text.byteLength + (c.num?.byteLength ?? 0);
    const rowsB = rowLocalId.byteLength + rowModelIdx.byteLength;
    return { dict, arrays, rowsB, total: dict + arrays + rowsB };
  };
  const logStoreBytes = (phase: string) => {
    const b = storeBytes();
    const mb = (n: number) => (n / 1048576).toFixed(2);
    console.log(
      `[data-table] retained store (${phase}): ${mb(b.total)} MB ` +
        `[dict ${mb(b.dict)} + typed-arrays ${mb(b.arrays)} + rows ${mb(b.rowsB)}] ` +
        `· ${rowCount.toLocaleString()} rows × ${columns.size} cols · dict ${strings.length.toLocaleString()} strings`,
    );
  };

  // Register/return a column, allocating its rowCount-length arrays. preferNumber
  // upgrades a text column to numeric (heterogeneous psets may mix).
  const ensureColumn = (
    key: string,
    group: string,
    label: string,
    kind: "text" | "number",
    width: number,
    preferNumber = false,
  ): Col => {
    let col = columns.get(key);
    if (!col) {
      col = {
        key,
        group,
        label,
        kind,
        width,
        text: new Int32Array(rowCount).fill(-1),
        num: kind === "number" ? new Float64Array(rowCount).fill(NaN) : null,
      };
      columns.set(key, col);
    } else if (preferNumber && col.kind === "text") {
      col.kind = "number";
      if (!col.num) col.num = new Float64Array(rowCount).fill(NaN);
    }
    return col;
  };

  // ── Aggregation over a set of rowIdx (reads the columnar store) ─
  // Numeric reduces use cellNum (skip NaN/"no value"); count = present values;
  // distinct = distinct present display strings. Returns "" when nothing to show.
  const computeAgg = (arr: number[], col: string, fn: AggFn): string => {
    if (fn === "count") {
      let n = 0;
      for (const r of arr) if (cellHas(r, col)) n++;
      return n.toLocaleString();
    }
    if (fn === "distinct") {
      const s = new Set<string>();
      for (const r of arr) {
        if (cellHas(r, col)) s.add(cellText(r, col));
      }
      return s.size.toLocaleString();
    }
    let acc = 0;
    let n = 0;
    let mn = Infinity;
    let mx = -Infinity;
    for (const r of arr) {
      const x = cellNum(r, col);
      if (Number.isNaN(x)) continue; // "no value" excluded from numeric reduce
      acc += x;
      n++;
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    if (n === 0) return "";
    switch (fn) {
      case "sum": return fmtNum(acc);
      case "avg": return fmtNum(acc / n);
      case "min": return fmtNum(mn);
      case "max": return fmtNum(mx);
      default: return "";
    }
  };

  // mixed-value-sentinel: a non-aggregated column's group cell shows the shared
  // value if all members agree, "Varies" if they differ, or empty if all members
  // have "no value" (distinct from "varies").
  const groupShared = (arr: number[], col: string): { text: string; varies: boolean } => {
    let first: string | undefined;
    let has = false;
    for (const r of arr) {
      if (!cellHas(r, col)) continue;
      const v = cellText(r, col);
      if (!has) {
        first = v;
        has = true;
      } else if (v !== first) {
        return { text: "Varies", varies: true };
      }
    }
    return has ? { text: first ?? "", varies: false } : { text: "", varies: false };
  };
  let query = ""; // quick filter (global contains across visible columns)
  let conditions: Condition[] = []; // structured filter (AND-of-ORs)
  let condId = 0;
  // value-faceting (scan-on-demand-distinct): distinct values per column for the
  // operand suggestions, cached; invalidated on each index rebuild.
  const facetCache = new Map<string, string[]>();
  // multi-key-stable-sort: ordered (column, direction) keys; the base JS sort is
  // stable, so layering keys composes (first non-equal key decides, ties fall to
  // the next, final ties keep prior order).
  let sortSpec: { col: string; dir: 1 | -1 }[] = [];
  // grouping-key/property-value-key: ordered list of columns to group by (one
  // group level per entry, nested); empty = ungrouped.
  let groupCols: string[] = [];
  // per-column-function-selection: columnKey → roll-up function (footer + group).
  const aggs = new Map<string, AggFn>();
  const collapsedGroups = new Set<string>();
  const selectedRowKeys = new Set<string>();

  // ── Saved views (persisted to the hidden __project_data/bim-viewer/ folder) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any = null;
  let projectId: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = getAppManager(components) as any;
    client = app?.client ?? null;
    projectId = client?.context?.projectId;
  } catch {
    /* no AppManager (e.g. standalone dev harness) → views just don't persist */
  }
  let savedViews: SavedView[] = [];
  let activeViewName: string | null = null;
  let savingNew = false; // the "Save as…" inline name input is open
  let newViewName = "";
  // Which on-demand editor is open below the compact toolbar (one at a time).
  let openEditor: "" | "filter" | "group" | "views" = "";

  // Filtered+sorted data rows, then the flattened visible list (group bands +
  // data rows) the virtualizer renders.
  let filtered: number[] = []; // rowIdx of rows passing the filter, in sort order
  type VRow =
    | {
        t: "group";
        gkey: string; // full path key (unique across levels) for collapse state
        label: string;
        count: number;
        level: number; // 0-based nesting depth (multi-level grouping)
        // per-column group roll-up display (aggregate or shared/"varies" value)
        cells: Record<string, string>;
        varies: Set<string>; // columns whose group cell is the "varies" sentinel
      }
    | { t: "data"; row: number; level: number }; // row = rowIdx; level = indent depth
  let visible: VRow[] = [];

  let rebuildToken = 0;
  let searchTimer: number | undefined;
  // Guard against the select→table→select feedback loop: raised around a
  // table-initiated highlight drive, consumed by the echoing onHighlight.
  let pendingInternal = 0;

  // ── Virtualization DOM (created once, managed imperatively) ─────
  const viewport = document.createElement("div");
  viewport.className = "dt-vp";
  const head = document.createElement("div");
  head.className = "dt-head";
  const body = document.createElement("div");
  body.className = "dt-body";
  body.style.position = "relative";
  const content = document.createElement("div");
  content.style.position = "absolute";
  content.style.top = "0";
  content.style.left = "0";
  content.appendChild(document.createElement("div")); // placeholder, replaced
  content.firstElementChild?.remove();
  body.appendChild(content);
  viewport.appendChild(head);
  viewport.appendChild(body);

  // Re-fill width on panel resize (recompute the last-column flex + repaint).
  let resizeRaf = 0;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      recomputeFlex();
      renderHead();
      render(true);
    });
  });
  resizeObserver.observe(viewport);

  // User-dragged column widths, keyed by the active-universe column key (collapsed
  // name: key or raw pset key per mode) so they survive re-renders + the by-pset
  // toggle. In-memory only for now (persisting across sessions is task #34).
  const userWidths = new Map<string, number>();
  // Rendered column width: the user's dragged width if any, else the column's
  // declared width — floored at MIN_COL so a skinny column still reads.
  const colW = (k: string) => Math.max(MIN_COL, userWidths.get(k) ?? colMeta(k)?.width ?? 150);

  // Extra px added to the LAST visible column so the table FILLS the panel width
  // (no dead gutter) when the columns don't already overflow. Recomputed in
  // refreshList from the viewport's client width; 0 when columns overflow (then
  // the body scrolls horizontally as normal).
  let lastColExtra = 0;
  const recomputeFlex = () => {
    const avail = viewport.clientWidth || 0;
    const base = visibleCols.reduce((w, k) => w + colW(k), 0);
    lastColExtra = avail > 0 ? Math.max(0, avail - base) : 0;
  };
  // Effective rendered width: colW plus the flex remainder on the last column —
  // but a USER-RESIZED last column keeps its dragged width (auto-fill yields to an
  // explicit width); the resize of any non-last column still leaves the last one
  // filling the gap.
  const effColW = (k: string) => {
    const isLast = k === visibleCols[visibleCols.length - 1];
    return colW(k) + (isLast && !userWidths.has(k) ? lastColExtra : 0);
  };

  const totalWidth = () => visibleCols.reduce((w, k) => w + effColW(k), 0);

  // ── Header row ─────────────────────────────────────────────────
  const renderHead = () => {
    const tw = totalWidth();
    head.style.width = `${tw}px`;
    head.innerHTML = visibleCols
      .map((k) => {
        const c = colMeta(k);
        if (!c) return "";
        const si = sortSpec.findIndex((s) => s.col === k);
        const active = si >= 0;
        const arrow = active ? (sortSpec[si].dir === 1 ? "mdi:menu-up" : "mdi:menu-down") : "";
        // Show the 1-based sort order only when more than one key is active.
        const ord = active && sortSpec.length > 1 ? `<span class="dt-hc-ord">${si + 1}</span>` : "";
        return (
          `<div class="dt-hc${active ? " sorted" : ""}" data-col="${esc(k)}" style="width:${effColW(k)}px" title="${esc(c.label)} — click to sort, shift-click to add a secondary key">` +
          `<span class="dt-hc-lbl">${esc(c.label)}</span>` +
          (arrow ? `<bim-icon class="dt-hc-arr" icon="${arrow}"></bim-icon>` : "") +
          ord +
          `<span class="dt-hc-rz" data-col="${esc(k)}" title="Drag to resize"></span>` +
          `</div>`
        );
      })
      .join("");
  };

  // ── Body rows ──────────────────────────────────────────────────
  const dataRowHtml = (r: number, level: number) => {
    const cells = visibleCols
      .map((k, idx) => {
        const c = colMeta(k);
        const w = effColW(k);
        const v = cellText(r, k);
        const num = c?.kind === "number";
        // Indent the first cell by the nesting depth so grouped rows step in.
        const pad = idx === 0 ? `padding-left:${CELL_PAD + level * INDENT}px;` : "";
        // Value lives in an inner span: text-overflow:ellipsis needs a block-ish
        // child, it never applies to a bare text node in a flex cell (would clip
        // with no "…"). The span is the ellipsizing element.
        return `<div class="dt-c${num ? " num" : ""}" style="width:${w}px;${pad}" title="${esc(v)}"><span class="dt-c-tx">${esc(v)}</span></div>`;
      })
      .join("");
    const rk = rowKeyOf(r);
    return (
      `<div class="dt-row${selectedRowKeys.has(rk) ? " sel" : ""}" data-rk="${esc(rk)}" ` +
      `style="height:${ROW_H}px;width:${totalWidth()}px">${cells}</div>`
    );
  };

  const groupRowHtml = (g: Extract<VRow, { t: "group" }>) => {
    const collapsed = collapsedGroups.has(g.gkey);
    // Per-column cells: the first visible column carries the group identity
    // (caret + label + count); the rest show the column's roll-up (aggregate, or
    // shared value / "varies" sentinel) aligned under its header.
    const cells = visibleCols
      .map((k, idx) => {
        const col = colMeta(k);
        const w = effColW(k);
        const num = col?.kind === "number";
        if (idx === 0) {
          return (
            `<div class="dt-c dt-gc-id" style="width:${w}px;padding-left:${CELL_PAD + g.level * INDENT}px">` +
            `<bim-icon class="dt-g-car" icon="${collapsed ? "mdi:chevron-right" : "mdi:chevron-down"}"></bim-icon>` +
            `<span class="dt-g-lbl">${esc(g.label)}</span>` +
            `<span class="dt-g-cnt">${g.count.toLocaleString()}</span>` +
            `</div>`
          );
        }
        const txt = g.cells[k] ?? "";
        const isVaries = g.varies.has(k);
        return `<div class="dt-c${num ? " num" : ""}${isVaries ? " varies" : ""}" style="width:${w}px" title="${esc(txt)}"><span class="dt-c-tx">${esc(txt)}</span></div>`;
      })
      .join("");
    return (
      `<div class="dt-group" data-gkey="${esc(g.gkey)}" style="height:${ROW_H}px;width:${totalWidth()}px">` +
      cells +
      `</div>`
    );
  };

  const vRowHtml = (v: VRow) => (v.t === "group" ? groupRowHtml(v) : dataRowHtml(v.row, v.level));

  const buildRow = (i: number): HTMLElement => {
    const tmp = document.createElement("div");
    tmp.innerHTML = vRowHtml(visible[i]);
    return tmp.firstElementChild as HTMLElement;
  };

  // Index→element recycler (fixed height): rows staying in the window keep their
  // exact DOM (and rendered bim-icons) across scroll; only entering rows are
  // built, leaving rows removed. A forced rebuild drops all (data/filter/sort
  // changed) so the window is rebuilt once off the scroll path.
  const mounted = new Map<number, HTMLElement>();
  let lastStart = -1;
  let lastEnd = -1;

  const render = (force = false) => {
    const total = visible.length;
    body.style.height = `${total * ROW_H}px`;
    body.style.width = `${totalWidth()}px`;
    const top = viewport.scrollTop;
    const vh = (viewport.clientHeight || ROW_H) - HEAD_H;
    const start = Math.max(0, Math.floor(top / ROW_H) - BUFFER);
    const end = Math.min(total, Math.ceil((top + vh) / ROW_H) + BUFFER);
    if (!force && start === lastStart && end === lastEnd) return;
    if (force) {
      mounted.clear();
      content.textContent = "";
    }
    lastStart = start;
    lastEnd = end;
    content.style.transform = `translateY(${start * ROW_H}px)`;
    for (const [i, el] of mounted) {
      if (i < start || i >= end) {
        el.remove();
        mounted.delete(i);
      }
    }
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
    }
  };

  // ── Filter → sort → group → flatten ────────────────────────────
  // Quick filter: normalized contains across visible columns (the convenience
  // bar, ANDed with the structured query below).
  const quickMatch = (r: number, q: string) => {
    if (!q) return true;
    for (const k of visibleCols) {
      if (normText(cellText(r, k)).includes(q)) return true;
    }
    return false;
  };

  // Evaluate one typed predicate against a row (filter-operator-set). "No value"
  // (absent column) satisfies only `unset`; value operators exclude it. An
  // incomplete value-operator (blank operand) is ignored (treated as pass) so
  // the table isn't emptied while the user is still typing the operand.
  const evalCondition = (r: number, c: Condition): boolean => {
    const col = colMeta(c.col);
    if (!col) return true; // stale column → ignore
    const present = cellHas(r, c.col);
    const raw = cellText(r, c.col);
    if (c.op === "unset") return !present;
    if (c.op === "set") return present;
    if (c.op === "empty") return present && raw === "";
    if (!PRESENCE_OPS.has(c.op) && c.v.trim() === "") return true; // incomplete → ignore
    if (col.kind === "number") {
      const n = present ? cellNum(r, c.col) : NaN;
      if (Number.isNaN(n)) return false; // "no value" satisfies no numeric compare
      const x = roundC(n);
      const a = roundC(asNumber(c.v));
      switch (c.op) {
        case "eqn": return x === a;
        case "neqn": return x !== a;
        case "lt": return x < a;
        case "le": return x <= a;
        case "gt": return x > a;
        case "ge": return x >= a;
        case "between": {
          const b = roundC(asNumber(c.v2));
          return x >= Math.min(a, b) && x <= Math.max(a, b);
        }
        default: return true;
      }
    }
    if (!present) return false;
    const hv = normText(raw);
    const nv = normText(c.v);
    switch (c.op) {
      case "contains": return hv.includes(nv);
      case "ncontains": return !hv.includes(nv);
      case "eq": return hv === nv;
      case "neq": return hv !== nv;
      case "starts": return hv.startsWith(nv);
      default: return true;
    }
  };

  // Compile the flat condition list to AND-of-ORs and test a row: walk the list,
  // a run of OR-tagged conditions forms a disjunctive group, AND-tagged starts a
  // new group; the row passes iff EVERY group has at least one true condition.
  const structuredMatch = (r: number): boolean => {
    if (conditions.length === 0) return true;
    let i = 0;
    while (i < conditions.length) {
      let groupOk = evalCondition(r, conditions[i]);
      let j = i + 1;
      while (j < conditions.length && conditions[j].conj === "OR") {
        groupOk = groupOk || evalCondition(r, conditions[j]);
        j++;
      }
      if (!groupOk) return false; // a conjunctive group failed
      i = j;
    }
    return true;
  };

  // value-faceting (scan-on-demand-distinct): distinct, present values of a
  // column for operand suggestions. Cached; bounded so a huge column can't flood.
  const distinctValues = (col: string): string[] => {
    const hit = facetCache.get(col);
    if (hit) return hit;
    const seen = new Set<string>();
    for (let r = 0; r < rowCount; r++) {
      if (cellHas(r, col)) seen.add(cellText(r, col));
      if (seen.size > 400) break;
    }
    const out = [...seen]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 100);
    facetCache.set(col, out);
    return out;
  };

  // The group-key VALUE for a row on a column (property-value-key). "No value"
  // is its own deterministic group; the category column is prettified to match
  // how it reads elsewhere.
  const groupValueOf = (r: number, col: string): string => {
    if (!cellHas(r, col)) return "(no value)";
    const v = cellText(r, col);
    if (v === "") return "(no value)";
    return col === "attr:_category" ? prettyCategory(v) || v : v;
  };

  // Type-aware, null-last comparison of two rows on one column for a direction.
  // "No value" always sinks last regardless of `dir` (deterministic-null-
  // ordering); present values use natural-numeric collation / canonical numeric.
  const compareByCol = (a: number, b: number, col: string, dir: 1 | -1): number => {
    if (colMeta(col)?.kind === "number") {
      const an = cellNum(a, col);
      const bn = cellNum(b, col);
      const am = Number.isNaN(an);
      const bm = Number.isNaN(bn);
      if (am && bm) return 0;
      if (am) return 1;
      if (bm) return -1;
      return (an - bn) * dir;
    }
    const av = cellText(a, col);
    const bv = cellText(b, col);
    const am = av === "";
    const bm = bv === "";
    if (am && bm) return 0;
    if (am) return 1;
    if (bm) return -1;
    return av.localeCompare(bv, undefined, { numeric: true }) * dir;
  };

  // Per-column group roll-up cells (skip the first visible column — it carries
  // the group identity): a selected aggregate, else shared-value / "varies".
  const groupRollup = (arr: number[]) => {
    const cells: Record<string, string> = {};
    const varies = new Set<string>();
    visibleCols.forEach((k, idx) => {
      if (idx === 0) return;
      const fn = aggs.get(k);
      if (fn) {
        cells[k] = computeAgg(arr, k, fn);
      } else {
        const s = groupShared(arr, k);
        cells[k] = s.text;
        if (s.varies) varies.add(k);
      }
    });
    return { cells, varies };
  };

  const rebuildVisible = () => {
    const q = normText(query);
    filtered = [];
    for (let r = 0; r < rowCount; r++) {
      if (quickMatch(r, q) && structuredMatch(r)) filtered.push(r);
    }

    // multi-key-stable-sort: first non-equal key decides; ties fall to the next;
    // final ties keep prior order (stable sort).
    if (sortSpec.length) {
      filtered.sort((a, b) => {
        for (const { col, dir } of sortSpec) {
          const c = compareByCol(a, b, col, dir);
          if (c !== 0) return c;
        }
        return 0;
      });
    }

    const out: VRow[] = [];
    if (groupCols.length === 0) {
      for (const r of filtered) out.push({ t: "data", row: r, level: 0 });
    } else {
      // grouping-materialization/eager-full-tree: build the nested group tree in
      // one pass (bounded store), flattening to visible rows honoring collapse.
      const build = (arr: number[], level: number, prefix: string) => {
        if (level >= groupCols.length) {
          for (const r of arr) out.push({ t: "data", row: r, level });
          return;
        }
        const col = groupCols[level];
        const buckets = new Map<string, number[]>();
        for (const r of arr) {
          const gv = groupValueOf(r, col);
          (buckets.get(gv) ?? buckets.set(gv, []).get(gv)!).push(r);
        }
        const keys = [...buckets.keys()].sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true }),
        );
        for (const gv of keys) {
          const sub = buckets.get(gv)!;
          const path = `${prefix}${level}:${gv}`; // unique across levels
          const { cells, varies } = groupRollup(sub);
          out.push({ t: "group", gkey: path, label: gv, count: sub.length, level, cells, varies });
          if (!collapsedGroups.has(path)) build(sub, level + 1, path);
        }
      };
      build(filtered, 0, "");
    }
    visible = out;
  };

  // Footer aggregation: count of filtered DATA rows + the grand roll-up of every
  // column that has a selected function, over the whole filtered set. Plain
  // columnar scan over the bounded store.
  const footer = () => {
    const count = filtered.length;
    const parts: { label: string; value: string }[] = [];
    for (const [k, fn] of aggs) {
      const col = colMeta(k);
      if (!col) continue;
      const v = computeAgg(filtered, k, fn);
      if (v !== "") parts.push({ label: `${fn} ${col.label}`, value: v });
    }
    return { count, parts };
  };

  const refreshList = (force = true) => {
    rebuildNameIndex(); // refresh the name-collapse universe (cheap; columns grow during pset fill)
    rebuildVisible();
    recomputeFlex(); // stretch the last column to fill the panel width (no gutter)
    lastStart = lastEnd = -1;
    renderHead();
    render(force);
    syncFooter();
  };

  // ── 3D selection sync ──────────────────────────────────────────
  const rowMapFromKeys = (keys: Iterable<string>): OBC.ModelIdMap => {
    const map: OBC.ModelIdMap = {};
    for (const rk of keys) {
      const idx = rk.lastIndexOf(":");
      const modelId = rk.slice(0, idx);
      const localId = Number(rk.slice(idx + 1));
      if (!Number.isFinite(localId)) continue;
      (map[modelId] ??= new Set<number>()).add(localId);
    }
    return map;
  };

  const driveHighlight = async (keys: Set<string>) => {
    pendingInternal++;
    try {
      if (keys.size === 0) {
        await highlighter.clear(selectName);
      } else {
        await highlighter.highlightByID(selectName, rowMapFromKeys(keys), true, false);
      }
    } catch (error) {
      console.warn("[data-table] highlight failed", error);
    } finally {
      Promise.resolve().then(() => {
        if (pendingInternal > 0) pendingInternal--;
      });
    }
  };

  const onRowClick = (rowKey: string, additive: boolean) => {
    if (additive) {
      if (selectedRowKeys.has(rowKey)) selectedRowKeys.delete(rowKey);
      else selectedRowKeys.add(rowKey);
    } else {
      selectedRowKeys.clear();
      selectedRowKeys.add(rowKey);
    }
    void driveHighlight(selectedRowKeys);
    render(true);
  };

  // Scroll the first selected visible row into view (used when 3D drives us).
  const scrollSelectionIntoView = () => {
    if (selectedRowKeys.size === 0) return;
    const idx = visible.findIndex((v) => v.t === "data" && selectedRowKeys.has(rowKeyOf(v.row)));
    if (idx < 0) return;
    const rowTop = idx * ROW_H;
    const vh = (viewport.clientHeight || ROW_H) - HEAD_H;
    const cur = viewport.scrollTop;
    if (rowTop < cur || rowTop + ROW_H > cur + vh) {
      viewport.scrollTop = Math.max(0, rowTop - vh / 2);
    }
  };

  // ── Delegated interaction ──────────────────────────────────────
  // ── Column resize (drag a header's right edge) ─────────────────
  let rzCol: string | null = null;
  let rzStartX = 0;
  let rzStartW = 0;
  let rzRaf = 0;
  let rzMoved = false; // suppress the sort-click that fires after a drag
  const onRzMove = (e: PointerEvent) => {
    if (rzCol === null) return;
    rzMoved = true;
    const w = Math.max(MIN_COL, rzStartW + (e.clientX - rzStartX));
    userWidths.set(rzCol, w);
    if (rzRaf) return;
    rzRaf = requestAnimationFrame(() => {
      rzRaf = 0;
      recomputeFlex();
      renderHead();
      render(true); // only the ~window of virtualized rows re-emits widths
    });
  };
  const onRzUp = () => {
    rzCol = null;
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", onRzMove);
    // Let the trailing click fire, then clear the suppression flag.
    setTimeout(() => {
      rzMoved = false;
    }, 0);
  };
  head.addEventListener("pointerdown", (e) => {
    const handle = (e.target as HTMLElement).closest<HTMLElement>(".dt-hc-rz");
    if (!handle?.dataset.col) return;
    e.preventDefault();
    e.stopPropagation();
    rzCol = handle.dataset.col;
    rzStartX = e.clientX;
    rzStartW = colW(rzCol);
    rzMoved = false;
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onRzMove);
    window.addEventListener("pointerup", onRzUp, { once: true });
  });

  head.addEventListener("click", (e) => {
    // Ignore clicks on the resize handle and the click that ends a resize drag.
    if ((e.target as HTMLElement).closest(".dt-hc-rz") || rzMoved) return;
    const hc = (e.target as HTMLElement).closest<HTMLElement>(".dt-hc");
    if (!hc?.dataset.col) return;
    const k = hc.dataset.col;
    const shift = (e as MouseEvent).shiftKey;
    const idx = sortSpec.findIndex((s) => s.col === k);
    if (shift) {
      // Add a secondary key, then cycle asc → desc → remove on repeat shift-clicks.
      if (idx < 0) sortSpec.push({ col: k, dir: 1 });
      else if (sortSpec[idx].dir === 1) sortSpec[idx].dir = -1;
      else sortSpec.splice(idx, 1);
    } else if (sortSpec.length === 1 && idx === 0) {
      sortSpec[0].dir = sortSpec[0].dir === 1 ? -1 : 1; // toggle the sole key
    } else {
      sortSpec = [{ col: k, dir: 1 }]; // replace with a single primary key
    }
    refreshList();
  });

  content.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const groupEl = target.closest<HTMLElement>(".dt-group");
    if (groupEl?.dataset.gkey) {
      const gk = groupEl.dataset.gkey;
      if (collapsedGroups.has(gk)) collapsedGroups.delete(gk);
      else collapsedGroups.add(gk);
      refreshList();
      return;
    }
    const rowEl = target.closest<HTMLElement>(".dt-row");
    if (rowEl?.dataset.rk) {
      onRowClick(rowEl.dataset.rk, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey);
    }
  });

  let scrollRaf = 0;
  viewport.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      render();
    });
  });
  new ResizeObserver(() => render()).observe(viewport);

  // ── CSV export (delimited-text per export-serialization) ───────
  // RFC 4180 quoting; a UTF-8 BOM so importers detect encoding; FULL-PRECISION
  // numerics (raw stored value, not the thousands-separated display string, so
  // downstream math isn't corrupted); and when grouped, one leading column per
  // group level (the level-column convention) so the group structure survives
  // the flat stream and the result is pivot-friendly.
  const exportCsv = () => {
    const cell = (s: string) =>
      /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    // Numeric columns export their canonical value (full precision); text keeps
    // its display string.
    const cellFor = (r: number, k: string) => {
      const col = colMeta(k);
      if (col?.kind === "number") {
        const n = cellNum(r, k);
        if (!Number.isNaN(n)) return cell(String(n));
      }
      return cell(cellText(r, k));
    };
    const labels = visibleCols.map((k) => cell(colMeta(k)?.label ?? k));
    const lines: string[] = [];
    if (groupCols.length === 0) {
      lines.push(labels.join(","));
      for (const r of filtered) lines.push(visibleCols.map((k) => cellFor(r, k)).join(","));
    } else {
      const gLabels = groupCols.map((k) => cell(`Group: ${colMeta(k)?.label ?? k}`));
      lines.push([...gLabels, ...labels].join(","));
      // Sort the filtered rows by the group tuple so groups are contiguous; emit
      // each row with its group values prepended (complete — ignores collapse).
      const sorted = [...filtered].sort((a, b) => {
        for (const col of groupCols) {
          const c = groupValueOf(a, col).localeCompare(groupValueOf(b, col), undefined, { numeric: true });
          if (c !== 0) return c;
        }
        return 0;
      });
      for (const r of sorted) {
        lines.push(
          [...groupCols.map((k) => cell(groupValueOf(r, k))), ...visibleCols.map((k) => cellFor(r, k))].join(","),
        );
      }
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "elements.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Themed single-select (BUI bim-dropdown) replacing native <select>. Each
  // bim-option binds its raw `.value` (property, not attribute → no JSON parse),
  // and bim-dropdown.value returns the picked option's value, so onPick gets the
  // exact value (no label-collision risk). `width` keeps the dropdowns compact.
  const dropdown = (
    opts: { value: string; label: string }[],
    selected: string,
    onPick: (value: string) => void,
    width?: string,
  ) =>
    BUI.html`<bim-dropdown
      style=${width ? `width:${width};` : ""}
      @change=${(e: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (e.target as any).value?.[0];
        if (v !== undefined && v !== null) onPick(String(v));
      }}
    >
      ${opts.map(
        (o) => BUI.html`<bim-option .value=${o.value} label=${o.label} ?checked=${o.value === selected}></bim-option>`,
      )}
    </bim-dropdown>`;

  // ── Structured-filter builder handlers ─────────────────────────
  // The active column universe (name-collapsed by default, or raw per-pset when
  // "show by pset" is on), alphabetical, as filter / group / picker targets.
  const allColumns = (): ColMeta[] | Col[] =>
    [...universe()].sort((a, b) => a.label.localeCompare(b.label));
  const defaultOp = (kind: "text" | "number"): Op => (kind === "number" ? "eqn" : "contains");
  // Operand typing debounced (don't re-render the chrome on each keystroke — that
  // would steal focus; only the table refreshes).
  let filterTimer: number | undefined;
  const debouncedFilter = () => {
    if (filterTimer !== undefined) clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      viewport.scrollTop = 0;
      refreshList();
    }, 200);
  };
  const addCondition = () => {
    const first = allColumns()[0];
    if (!first) return;
    conditions.push({ id: ++condId, col: first.key, op: defaultOp(first.kind), v: "", v2: "", conj: "AND" });
    refreshList();
    update({});
  };
  const removeCondition = (id: number) => {
    conditions = conditions.filter((c) => c.id !== id);
    viewport.scrollTop = 0;
    refreshList();
    update({});
  };
  const onColChange = (c: Condition, key: string) => {
    c.col = key;
    const kind = colMeta(key)?.kind ?? "text";
    const valid = (kind === "number" ? NUM_OPS : TEXT_OPS).some((o) => o.op === c.op);
    if (!valid) c.op = defaultOp(kind);
    refreshList();
    update({});
  };

  // ── Group-by (multi-level) handlers ────────────────────────────
  const regroup = () => {
    collapsedGroups.clear();
    viewport.scrollTop = 0;
    refreshList();
    update({});
  };
  const addGroupLevel = () => {
    const used = new Set(groupCols);
    const next = allColumns().find((c) => !used.has(c.key)) ?? allColumns()[0];
    if (!next) return;
    groupCols.push(next.key);
    regroup();
  };

  // ── Saved-view storage (mirrors CDEManager's __project_data/<app>/ pattern
  //    with the raw client — __project_data is excluded from CDE listings, so
  //    this is genuinely hidden, not a visible root file) ────────────────────
  const PDATA = "__project_data";
  const APP = "bim-viewer";
  const VIEWS_FILE = "saved-views.json";
  let appFolderId: string | null = null;
  const ensureAppFolder = async (): Promise<string | null> => {
    if (appFolderId) return appFolderId;
    if (!client || !projectId) return null;
    try {
      const roots = await client.listFolders({ projectId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let root = roots.find((f: any) => f.name === PDATA && !f.parentId);
      if (!root) root = await client.createFolder(PDATA, undefined, projectId);
      const subs = await client.listFolders({ parentFolderId: root._id, projectId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let app = subs.find((f: any) => f.name === APP);
      if (!app) app = await client.createFolder(APP, root._id, projectId);
      appFolderId = String(app._id);
      return appFolderId;
    } catch (error) {
      console.warn("[data-table] ensureAppFolder failed", error);
      return null;
    }
  };
  const findViewsFileId = async (folderId: string): Promise<string | null> => {
    const items = await client.listFiles({ projectId });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = items.find((i: any) => i.folderId === folderId && i.name === VIEWS_FILE);
    return f ? String(f._id) : null;
  };
  const readViews = async (): Promise<SavedView[]> => {
    if (!client || !projectId) return [];
    try {
      const folderId = await ensureAppFolder();
      if (!folderId) return [];
      const id = await findViewsFileId(folderId);
      if (!id) return [];
      const resp = await client.downloadFile(id);
      const data = await resp.json();
      return Array.isArray(data?.views) ? (data.views as SavedView[]) : [];
    } catch (error) {
      console.warn("[data-table] readViews failed", error);
      return [];
    }
  };
  const writeViews = async (views: SavedView[]): Promise<void> => {
    if (!client || !projectId) return;
    try {
      const folderId = await ensureAppFolder();
      if (!folderId) return;
      const blob = new Blob([JSON.stringify({ views }, null, 2)], { type: "application/json" });
      const id = await findViewsFileId(folderId);
      // Versioning is optional for v1 — overwrite via updateFile (createVersion
      // isn't guaranteed on this client; updateFile is the proven path here).
      if (id) await client.updateFile(id, { file: blob, versionTag: `v${Date.now()}` });
      else
        await client.createFile({
          file: blob,
          name: VIEWS_FILE,
          versionTag: "v1",
          projectId,
          parentFolderId: folderId,
        });
    } catch (error) {
      console.warn("[data-table] writeViews failed", error);
    }
  };

  // ── Capture / apply / dirty-detect (content-hash-dirty-detection) ──────────
  const captureConfig = (): ViewConfig => ({
    visibleCols: [...visibleCols],
    aggs: [...aggs.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    conditions: conditions.map(({ col, op, v, v2, conj }) => ({ col, op, v, v2, conj })),
    query,
    sortSpec: sortSpec.map((s) => ({ col: s.col, dir: s.dir })),
    groupCols: [...groupCols],
  });
  // Canonical serialization (stable field order via the literal above + sorted
  // aggs) → string equality is the dirty check.
  const serializeConfig = (cfg: ViewConfig) => JSON.stringify(cfg);
  const isDirty = () => {
    if (!activeViewName) return false;
    const v = savedViews.find((s) => s.name === activeViewName);
    return !v || serializeConfig(v.config) !== serializeConfig(captureConfig());
  };
  const applyConfig = (cfg: ViewConfig) => {
    rebuildNameIndex(); // ensure the universe is current before validity-filtering keys
    visibleCols = cfg.visibleCols.filter((k) => inUniverse(k));
    if (visibleCols.length === 0) visibleCols = [...DEFAULT_VISIBLE].filter((k) => inUniverse(k));
    aggs.clear();
    for (const [k, fn] of cfg.aggs) if (inUniverse(k)) aggs.set(k, fn);
    conditions = cfg.conditions.map((c) => ({ ...c, id: ++condId }));
    query = cfg.query ?? "";
    sortSpec = cfg.sortSpec.filter((s) => inUniverse(s.col));
    groupCols = cfg.groupCols.filter((k) => inUniverse(k));
    collapsedGroups.clear();
    viewport.scrollTop = 0;
  };

  const loadSavedViews = async () => {
    savedViews = await readViews();
    update({});
  };
  const restoreView = (name: string) => {
    const v = savedViews.find((s) => s.name === name);
    if (!v) return;
    applyConfig(v.config);
    activeViewName = name;
    refreshList();
    update({});
  };
  const persistView = async (name: string) => {
    const cfg = captureConfig();
    savedViews = [...savedViews.filter((s) => s.name !== name), { name, config: cfg }].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    activeViewName = name;
    savingNew = false;
    newViewName = "";
    update({});
    await writeViews(savedViews);
  };
  const deleteView = async (name: string) => {
    savedViews = savedViews.filter((s) => s.name !== name);
    if (activeViewName === name) activeViewName = null;
    update({});
    await writeViews(savedViews);
  };

  // ── Column picker (transient popover, mounted to body, BUI-rendered) ────────
  // Built with BUI.Component.create so its controls are real bim components
  // (bim-checkbox / bim-dropdown / bim-text-input) themed like every other panel
  // — no native <select>/<input>. Positioned fixed near the toolbar button.
  let picker: HTMLElement | null = null;
  let pickerSearch = "";
  const closePicker = () => {
    if (picker) {
      picker.remove();
      picker = null;
      document.removeEventListener("pointerdown", onDocDown, true);
    }
  };
  const onDocDown = (e: PointerEvent) => {
    if (picker && !picker.contains(e.target as Node)) closePicker();
  };
  const setColumnVisible = (key: string, on: boolean) => {
    if (on) {
      if (!visibleCols.includes(key)) visibleCols.push(key);
    } else {
      visibleCols = visibleCols.filter((k) => k !== key);
      aggs.delete(key);
      sortSpec = sortSpec.filter((s) => s.col !== key); // drop sort key on the gone column
    }
    refreshList();
    update({});
  };
  const setColumnAgg = (key: string, fn: string) => {
    if (fn) aggs.set(key, fn as AggFn);
    else aggs.delete(key);
    refreshList();
  };
  // Flip between name-collapsed (default) and raw per-pset provenance. Keys differ
  // between modes, so prune any view state that doesn't exist in the new universe
  // (attr/storey keys are valid in both; property selections may drop).
  const togglePsetMode = (byPset: boolean) => {
    collapseByName = !byPset;
    rebuildNameIndex();
    visibleCols = visibleCols.filter(inUniverse);
    if (visibleCols.length === 0) visibleCols = [...DEFAULT_VISIBLE].filter(inUniverse);
    conditions = conditions.filter((c) => inUniverse(c.col));
    sortSpec = sortSpec.filter((s) => inUniverse(s.col));
    groupCols = groupCols.filter(inUniverse);
    for (const k of [...aggs.keys()]) if (!inUniverse(k)) aggs.delete(k);
    facetCache.clear();
    refreshList();
    update({});
  };
  const openPicker = (anchor: HTMLElement) => {
    if (picker) {
      closePicker();
      return;
    }
    pickerSearch = "";
    const [el, pickerUpdate] = BUI.Component.create<HTMLElement, { tick: number }>(
      (_s) => {
        rebuildNameIndex(); // current universe (collapsed or by-pset) for this render
        const byGroup = new Map<string, (ColMeta | Col)[]>();
        for (const c of universe()) {
          let arr = byGroup.get(c.group);
          if (!arr) {
            arr = [];
            byGroup.set(c.group, arr);
          }
          arr.push(c);
        }
        const order = (g: string) =>
          g === "Attributes" ? 0 : g === "Spatial" ? 1 : g === "Properties" ? 2 : 3;
        const groups = [...byGroup.keys()].sort(
          (a, b) => order(a) - order(b) || a.localeCompare(b),
        );
        const q = pickerSearch.trim().toLowerCase();
        const blocks = groups
          .map((g) => {
            const cols = byGroup
              .get(g)!
              .filter((c) => !q || c.label.toLowerCase().includes(q))
              .sort((a, b) => a.label.localeCompare(b.label));
            if (cols.length === 0) return null;
            return BUI.html`
              <div class="dt-pk-grp">${g}</div>
              ${cols.map(
                (c) => BUI.html`
                  <div class="dt-pk-item">
                    <bim-checkbox class="dt-pk-cb" label=${c.label} ?checked=${visibleCols.includes(c.key)}
                      @change=${(e: Event) => setColumnVisible(c.key, !!(e.target as { checked?: boolean }).checked)}
                    ></bim-checkbox>
                    ${c.kind === "number" ? BUI.html`<span class="dt-pk-num">#</span>` : null}
                    ${(c as ColMeta).conflict
                      ? BUI.html`<bim-icon class="dt-pk-warn" icon="mdi:alert"><bim-tooltip>Mixed types across property sets — shown as text, not coerced</bim-tooltip></bim-icon>`
                      : null}
                    ${dropdown(
                      [{ value: "", label: "∑ —" }, ...fnsFor(c.kind).map((f) => ({ value: f, label: f }))],
                      aggs.get(c.key) ?? "",
                      (v) => setColumnAgg(c.key, v),
                      "5rem",
                    )}
                  </div>`,
              )}`;
          })
          .filter(Boolean);
        return BUI.html`
          <div class="dt-picker">
            <div class="dt-pk-hd">
              <span>Columns</span>
              <bim-icon class="dt-pk-x" icon="mdi:close" @click=${closePicker}></bim-icon>
            </div>
            <bim-text-input class="dt-pk-search" icon="mdi:magnify" icon-inside placeholder="Filter columns…"
              .value=${pickerSearch}
              @input=${(e: Event) => {
                pickerSearch = String((e.target as { value?: string }).value ?? "");
                pickerUpdate({ tick: 0 });
              }}
            ></bim-text-input>
            <label class="dt-pk-mode">
              <bim-checkbox ?checked=${!collapseByName}
                @change=${(e: Event) => {
                  togglePsetMode(!!(e.target as { checked?: boolean }).checked);
                  pickerUpdate({ tick: 0 });
                }}
              ></bim-checkbox>
              <span>Show by property set</span>
            </label>
            <div class="dt-pk-list">
              ${blocks.length ? blocks : BUI.html`<div class="dt-pk-empty">No columns yet.</div>`}
            </div>
          </div>`;
      },
      { tick: 0 },
    );
    const rect = anchor.getBoundingClientRect();
    el.style.position = "fixed";
    el.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 360)}px`;
    el.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;
    el.style.zIndex = "9999";
    // The popover is mounted to document.body — OUTSIDE the app's themed subtree —
    // so .dt-picker's `var(--bim-ui_bg-base)` doesn't resolve and falls back to the
    // dark hardcoded value. Copy the RESOLVED var values from the panel's own
    // themed light-DOM content (`viewport` — where the table cells already render
    // themed, proving the vars resolve there) onto the popover, so its existing
    // var-based CSS resolves to the exact same surface as the panel. (Reading from
    // `anchor` failed: it's in shadow DOM where getPropertyValue returns empty.)
    const tcs = getComputedStyle(viewport);
    for (const v of [
      "--bim-ui_bg-base",
      "--bim-ui_bg-contrast-10",
      "--bim-ui_bg-contrast-20",
      "--bim-ui_bg-contrast-30",
      "--bim-ui_bg-contrast-40",
      "--bim-ui_bg-contrast-60",
      "--bim-ui_bg-contrast-80",
      "--bim-ui_bg-contrast-90",
      "--bim-ui_bg-contrast-100",
      "--bim-ui_accent-base",
      "--bim-ui_color-warning",
    ]) {
      const val = tcs.getPropertyValue(v);
      if (val) el.style.setProperty(v, val);
    }
    // The visible bim-panel SURFACE is #262629 — NOT --bim-ui_bg-base (#19191E,
    // which is darker and what .dt-picker's CSS fell back to). Match the real panel
    // surface explicitly so this body-mounted popover reads as the same panel.
    el.style.background = "#262629";
    document.body.appendChild(el);
    picker = el;
    document.addEventListener("pointerdown", onDocDown, true);
  };

  // ── Bulk index: interned columnar store from all loaded models ─────
  // FIRST PAINT is attributes-only (model.getTableData({ mode: "attributes" }))
  // for a sub-second populate; pset/quantity columns are then filled lazily in
  // the BACKGROUND (model.getTablePsets, batched per model) and merged in. Both
  // return the interned columnar TableData; each payload carries its OWN string
  // dictionary, so we remap its indices into the panel's master dictionary.

  // Default rendered width for a worker-reported column.
  const ATTR_WIDTH = new Map<string, number>(ATTR_COLUMNS.map((c) => [c.key, c.width]));
  const defaultColWidth = (col: { key: string; kind: "text" | "number" }) =>
    ATTR_WIDTH.get(col.key) ?? (col.kind === "number" ? 120 : 160);

  const PSET_BATCH = 4000; // localIds per getTablePsets call (background fill)

  const resetStore = () => {
    strings = [];
    intern = new Map<string, number>();
    rowCount = 0;
    rowLocalId = new Uint32Array(0);
    rowModelIdx = new Uint16Array(0);
    modelIdsOrder = [];
    columns.clear();
  };

  // Intern a payload's dictionary into the master dictionary; returns the
  // payload-index -> master-index remap.
  const internDict = (dict: string[]): Int32Array => {
    const remap = new Int32Array(dict.length);
    for (let i = 0; i < dict.length; i++) remap[i] = internStr(dict[i]);
    return remap;
  };

  // Merge one worker TableData column into the master store. `remap` maps payload
  // string indices -> master indices; `rowOf(i)` gives the master rowIdx for
  // payload row i (-1 to skip); `n` = number of payload rows to read.
  const mergeColumn = (
    pc: FRAGS.TableColumn,
    remap: Int32Array,
    rowOf: (i: number) => number,
    n: number,
  ) => {
    const col = ensureColumn(
      pc.key, pc.group, pc.label, pc.kind, defaultColWidth(pc), pc.kind === "number",
    );
    for (let i = 0; i < n; i++) {
      const r = rowOf(i);
      if (r < 0) continue;
      const si = pc.text[i];
      col.text[r] = si < 0 ? -1 : remap[si];
      if (col.num && pc.num) col.num[r] = pc.num[i];
    }
  };

  // OPTIONAL storey enrichment (the worker table has no storey column). Cheap:
  // walks the spatial tree and fetches ONLY storey-level Names, not per-element
  // data. Returns localId -> storeyId and storeyId -> storey name.
  const collectStoreys = async (model: FRAGS.FragmentsModel) => {
    const storeyOf = new Map<number, string>();
    const storeyName = new Map<string, string>();
    const storeyIds: number[] = [];
    const structure = await model.getSpatialStructure().catch(() => null);
    if (structure) {
      const walk = (node: FRAGS.SpatialTreeItem, storey: number | null) => {
        const cat = (node.category ?? "").toUpperCase();
        let curStorey = storey;
        if (cat === "IFCBUILDINGSTOREY" && node.localId != null) {
          curStorey = node.localId;
          storeyIds.push(node.localId);
        }
        if (node.localId != null && !CONTAINER_CATEGORIES.has(cat) && curStorey != null) {
          storeyOf.set(node.localId, String(curStorey));
        }
        node.children?.forEach((c) => walk(c, curStorey));
      };
      walk(structure, null);
    }
    if (storeyIds.length > 0) {
      const sData = await model.getItemsData(storeyIds, {
        attributesDefault: false,
        attributes: ["Name"],
      });
      sData.forEach((d, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nm = (d as any)?.Name;
        if (nm && "value" in nm && nm.value != null) {
          storeyName.set(String(storeyIds[i]), String(nm.value));
        }
      });
    }
    return { storeyOf, storeyName };
  };

  // PASS 1 — attributes only: build the row set + attribute columns + storey.
  const indexAttributes = async (token: number) => {
    const models = [...fragments.list.values()];
    type P = {
      modelId: string;
      data: FRAGS.TableData;
      storeyOf: Map<number, string>;
      storeyName: Map<string, string>;
    };
    const payloads: P[] = [];
    let total = 0;
    let notReady = false;
    for (const model of models) {
      if (total >= MAX_ROWS) break;
      try {
        const data = await model.getTableData({ mode: "attributes" });
        if (token !== rebuildToken) return { notReady: false };
        const { storeyOf, storeyName } = await collectStoreys(model).catch(() => ({
          storeyOf: new Map<number, string>(),
          storeyName: new Map<string, string>(),
        }));
        if (token !== rebuildToken) return { notReady: false };
        payloads.push({ modelId: model.modelId, data, storeyOf, storeyName });
        total += data.localIds.length;
        console.log(
          `[data-table] getTableData(attributes) ${model.modelId}: ` +
            `${data.stats.rowCount} rows, ${data.stats.columnCount} cols, ` +
            `${Math.round(data.stats.ms)}ms`,
        );
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (/Model not found/i.test(String((error as any)?.message ?? error))) notReady = true;
        else console.warn("[data-table] getTableData failed", model.modelId, error);
      }
    }
    // Allocate the master row arrays (capped at MAX_ROWS).
    rowCount = Math.min(total, MAX_ROWS);
    rowLocalId = new Uint32Array(rowCount);
    rowModelIdx = new Uint16Array(rowCount);
    modelIdsOrder = payloads.map((p) => p.modelId);
    let w = 0;
    payloads.forEach((p, mi) => {
      const ids = p.data.localIds;
      const take = Math.min(ids.length, rowCount - w);
      const startRow = w;
      const remap = internDict(p.data.strings);
      for (let i = 0; i < take; i++) {
        const r = startRow + i;
        rowLocalId[r] = ids[i];
        rowModelIdx[r] = mi;
      }
      for (const pc of p.data.columns) {
        mergeColumn(pc, remap, (i) => startRow + i, take);
      }
      if (p.storeyOf.size > 0) {
        const sc = ensureColumn(STOREY_KEY, "Spatial", "Storey", "text", 140);
        for (let i = 0; i < take; i++) {
          const sid = p.storeyOf.get(ids[i]);
          const name = sid ? p.storeyName.get(sid) : undefined;
          if (name) sc.text[startRow + i] = internStr(name);
        }
      }
      w += take;
    });
    return { notReady };
  };

  // PASS 2 (background) — fetch pset/quantity columns for ALL rows in batches per
  // model and merge progressively. Pset-column ops (filter/sort/group/aggregate)
  // become correct as each batch lands; a subtle note shows until done.
  const fillPsets = async (token: number) => {
    for (let mi = 0; mi < modelIdsOrder.length; mi++) {
      const modelId = modelIdsOrder[mi];
      const model = fragments.list.get(modelId);
      if (!model) continue;
      const ids: number[] = [];
      const rowOfId = new Map<number, number>();
      for (let r = 0; r < rowCount; r++) {
        if (rowModelIdx[r] === mi) {
          ids.push(rowLocalId[r]);
          rowOfId.set(rowLocalId[r], r);
        }
      }
      for (let i = 0; i < ids.length; i += PSET_BATCH) {
        const batch = ids.slice(i, i + PSET_BATCH);
        let data: FRAGS.TableData;
        try {
          data = await model.getTablePsets(batch, { includeTypePsets: true });
        } catch (error) {
          console.warn("[data-table] getTablePsets failed", modelId, error);
          continue;
        }
        if (token !== rebuildToken) return;
        const remap = internDict(data.strings);
        const bIds = data.localIds; // echoes input order
        for (const pc of data.columns) {
          mergeColumn(pc, remap, (j) => rowOfId.get(bIds[j]) ?? -1, bIds.length);
        }
        facetCache.clear();
        // Force a full repaint: merged pset values land in columns that may be
        // visible (e.g. a restored saved view) AND may change sort/group order,
        // and the row recycler keeps same-index DOM on a soft refresh.
        refreshList(true);
        update({ status: "ready", note: indexNote(rowCount, false) });
        await new Promise<void>((res) => setTimeout(res, 0)); // yield between batches
        if (token !== rebuildToken) return;
      }
    }
    facetCache.clear();
    refreshList(true);
    update({ status: rowCount > 0 ? "ready" : "empty", note: indexNote(rowCount, true) });
    if (rowCount > 0) logStoreBytes("full");
  };

  const indexNote = (n: number, done = true) => {
    const base =
      n >= MAX_ROWS
        ? `${MAX_ROWS.toLocaleString()}+ elements (capped)`
        : `${n.toLocaleString()} element${n === 1 ? "" : "s"}`;
    return done ? base : `${base} · loading properties…`;
  };

  let readyRetries = 0; // bounded retries when a model isn't worker-ready yet
  const rebuild = async () => {
    const token = ++rebuildToken;
    resetStore();
    facetCache.clear();
    selectedRowKeys.clear();
    collapsedGroups.clear();
    const models = [...fragments.list.values()];
    visibleCols = [...DEFAULT_VISIBLE];
    if (models.length === 0) {
      refreshList();
      update({ status: "empty", note: "" });
      return;
    }
    update({ status: "loading", note: "Indexing…" });
    try {
      const { notReady } = await indexAttributes(token);
      if (token !== rebuildToken) return;
      // A model can throw "Model not found" when an onItemSet fires before its
      // worker is ready. If NOTHING indexed, retry from scratch. If SOME rows
      // landed (e.g. model #1 ready, model #2 still loading), paint what we have
      // now AND schedule a retry to pick up the not-yet-ready model(s) — we don't
      // rely solely on onModelLoaded re-firing for the second model.
      if (rowCount === 0 && notReady && readyRetries < 8) {
        readyRetries++;
        setTimeout(() => {
          if (token === rebuildToken) void rebuild();
        }, 500);
        return;
      }
      // Show default-visible columns that exist; else the first 3 discovered.
      visibleCols = [...DEFAULT_VISIBLE].filter((k) => columns.has(k));
      if (visibleCols.length === 0) visibleCols = [...columns.keys()].slice(0, 3);
      // FIRST PAINT now (attributes only) — don't wait for psets.
      refreshList();
      update({ status: rowCount > 0 ? "ready" : "empty", note: indexNote(rowCount, rowCount === 0) });
      if (rowCount > 0) logStoreBytes("attributes");
      // Some models weren't ready yet but others gave rows → retry (bounded) to
      // fold the missing model(s) in, while the current rows stay on screen.
      if (notReady && rowCount > 0 && readyRetries < 8) {
        readyRetries++;
        setTimeout(() => {
          if (token === rebuildToken) void rebuild();
        }, 600);
        return; // the retry will run fillPsets once the full set is in
      }
      readyRetries = 0; // clean pass — every model in the list indexed
      // Background pset fill (non-blocking; cancels if a newer rebuild starts).
      if (rowCount > 0) void fillPsets(token);
    } catch (error) {
      if (token !== rebuildToken) return;
      console.warn("[data-table] index failed", error);
      update({ status: "empty", note: "" });
    }
  };

  // ── Panel chrome (BUI) ─────────────────────────────────────────
  interface PanelState {
    status: "loading" | "empty" | "ready";
    note: string;
  }
  let footerEl: HTMLElement | null = null;
  const syncFooter = () => {
    if (!footerEl) return;
    const { count, parts } = footer();
    footerEl.innerHTML =
      `<span class="dt-ft-item"><b>${count.toLocaleString()}</b> rows</span>` +
      parts
        .map((p) => `<span class="dt-ft-item">${esc(p.label)}: <b>${esc(p.value)}</b></span>`)
        .join("");
  };

  const [panel, update] = BUI.Component.create<BUI.Panel, PanelState>(
    (state) => {
      const onHostCreated = (el?: Element) => {
        if (!el || el.contains(viewport)) return;
        el.appendChild(viewport);
        render(true);
      };
      const onFooterCreated = (el?: Element) => {
        footerEl = (el as HTMLElement) ?? null;
        syncFooter();
      };
      const colLabel = (k: string) => colMeta(k)?.label ?? k;
      const opLabel = (op: Op) => [...TEXT_OPS, ...NUM_OPS].find((o) => o.op === op)?.label ?? op;
      const condLabel = (c: Condition) =>
        `${colLabel(c.col)} ${opLabel(c.op)}${
          PRESENCE_OPS.has(c.op) ? "" : ` ${c.op === "between" ? `${c.v}–${c.v2}` : c.v}`
        }`;
      const toggleEditor = (k: typeof openEditor) => {
        openEditor = openEditor === k ? "" : k;
        update({});
      };

      return BUI.html`
        <bim-panel
          label="Element Data"
          icon="mdi:table"
          header-hidden
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .dt-vp { height: 100%; overflow: auto; }
            .dt-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .dt-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .dt-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }
            /* The intersection of the H+V scrollbars defaults to white — match the surface. */
            .dt-vp::-webkit-scrollbar-corner { background-color: transparent; }
            .dt-head { position: sticky; top: 0; z-index: 3; display: flex; height: ${HEAD_H}px;
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.2)); }
            .dt-hc { position: relative; box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center; gap: 0.2rem;
              padding: 0 0.5rem; cursor: pointer; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.01em;
              color: var(--bim-ui_bg-contrast-80, #c9c9c9); white-space: nowrap; overflow: hidden;
              border-right: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08)); }
            .dt-hc:hover { background: var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.14)); }
            .dt-hc.sorted { color: var(--bim-ui_accent-base, #6528d7); }
            .dt-hc-lbl { overflow: hidden; text-overflow: ellipsis; }
            .dt-hc-arr { flex: 0 0 auto; font-size: 0.9rem; }
            /* Column resize handle: grab strip on the header's right edge. */
            .dt-hc-rz { position: absolute; top: 0; right: 0; width: 6px; height: 100%;
              cursor: col-resize; z-index: 1; touch-action: none; }
            .dt-hc-rz:hover { background: var(--bim-ui_accent-base, #6528d7); opacity: 0.5; }
            .dt-body { position: relative; }
            .dt-row { display: flex; box-sizing: border-box; cursor: pointer;
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.07)); }
            .dt-row:hover { background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.06)); }
            .dt-row.sel { background: var(--bim-ui_accent-base, #6528d7); color: #fff; }
            .dt-c { box-sizing: border-box; flex: 0 0 auto; display: flex; align-items: center;
              padding: 0 0.5rem; font-size: 0.74rem; line-height: ${ROW_H}px;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3); white-space: nowrap; overflow: hidden;
              text-overflow: ellipsis;
              border-right: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.05)); }
            .dt-row.sel .dt-c { color: #fff; }
            .dt-c.num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
            /* The ellipsizing element: a bare text node in a flex cell never gets
               an ellipsis, so the value lives in this span. flex:0 1 auto + min-width:0
               lets it shrink to the cell width and truncate; for .num cells the
               cell's flex-end keeps short numbers right-aligned. */
            .dt-c-tx { flex: 0 1 auto; min-width: 0; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; }
            /* Force neutral THEME text on every cell value — the .dt-vp prefix
               lifts specificity over any inherited/external color so values never
               render red/green/black; selected rows go white. */
            .dt-vp .dt-c, .dt-vp .dt-c-tx { color: var(--bim-ui_bg-contrast-100, #e3e3e3); }
            .dt-vp .dt-row.sel .dt-c, .dt-vp .dt-row.sel .dt-c-tx { color: #fff; }
            /* A group's roll-up cell that's the "varies" sentinel — muted/italic
               so it reads as informational, not as a real value. */
            .dt-c.varies { opacity: 0.5; font-style: italic; }
            /* Group row: a row of column-aligned roll-up cells over a band bg. */
            .dt-group { display: flex; align-items: center; box-sizing: border-box; cursor: pointer;
              font-weight: 600; color: var(--bim-ui_bg-contrast-90, #d5d5d5);
              background: var(--bim-ui_bg-contrast-10, rgba(255,255,255,0.05));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.12)); }
            .dt-group .dt-c { color: var(--bim-ui_bg-contrast-90, #d5d5d5); }
            /* Identity cell (first column): caret + group label + count. */
            .dt-gc-id { gap: 0.3rem; }
            .dt-g-car { flex: 0 0 auto; color: var(--bim-ui_bg-contrast-60, #9a9a9a); }
            .dt-g-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .dt-g-cnt { flex: 0 0 auto; opacity: 0.7; font-variant-numeric: tabular-nums;
              padding: 0.02rem 0.4rem; border-radius: 0.6rem; font-size: 0.68rem;
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .dt-ctrls { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
            /* Compact toolbar: full-width search + icon controls (no wrap). */
            .dt-toolbar { display: flex; align-items: stretch; gap: 0.3rem; }
            .dt-search { flex: 1 1 auto; min-width: 0; }
            .dt-tbtn { flex: 0 0 auto; }
            /* Active filter / group chips (shown only when present). */
            .dt-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
            .dt-chip { display: inline-flex; align-items: center; gap: 0.25rem; max-width: 100%;
              font-size: 0.68rem; padding: 0.08rem 0.2rem 0.08rem 0.45rem; border-radius: 0.8rem;
              color: var(--bim-ui_bg-contrast-90, #d5d5d5);
              background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08));
              border: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.14)); }
            .dt-chip.grp bim-icon { font-size: 0.8rem; opacity: 0.7; }
            .dt-chip-tx { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 9rem; }
            .dt-chip-x { cursor: pointer; opacity: 0.55; padding: 0 0.2rem; border-radius: 50%; }
            .dt-chip-x:hover { opacity: 1; background: var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.14)); }
            .dt-footer { display: flex; align-items: center; gap: 1rem; padding: 0.3rem 0.5rem;
              font-size: 0.72rem; color: var(--bim-ui_bg-contrast-80, #c9c9c9);
              border-top: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.12)); }
            .dt-ft-item b { color: var(--bim-ui_bg-contrast-100, #e3e3e3); }
            /* Column-picker popover (mounted to body, fixed-positioned). */
            .dt-picker { z-index: 9999; width: 260px; max-height: 360px; display: flex; flex-direction: column;
              background: var(--bim-ui_bg-base, #1b1b1f); color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              border: 1px solid var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.2)); border-radius: 0.4rem;
              box-shadow: 0 6px 20px rgba(0,0,0,0.4); font-size: 0.76rem; overflow: hidden; }
            .dt-pk-hd { display: flex; align-items: center; justify-content: space-between; padding: 0.45rem 0.6rem;
              font-weight: 600; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .dt-pk-x { cursor: pointer; opacity: 0.7; }
            .dt-pk-x:hover { opacity: 1; }
            .dt-pk-search { margin: 0.4rem 0.6rem; } /* bim-text-input — self-themed */
            .dt-pk-list { flex: 1 1 auto; overflow-y: auto; padding: 0 0.3rem 0.4rem; }
            .dt-pk-list::-webkit-scrollbar { width: 0.4rem; }
            .dt-pk-list::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: #3C3C41; }
            .dt-pk-grp { padding: 0.4rem 0.4rem 0.2rem; font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
              letter-spacing: 0.04em; color: var(--bim-ui_bg-contrast-60, #99a0ae); }
            .dt-pk-item { display: flex; align-items: center; gap: 0.4rem; padding: 0.2rem 0.4rem; border-radius: 0.25rem; }
            .dt-pk-item:hover { background: var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.08)); }
            .dt-pk-lbl { display: flex; align-items: center; gap: 0.4rem; flex: 1 1 auto; min-width: 0; cursor: pointer; }
            .dt-pk-lbl span { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .dt-pk-num { flex: 0 0 auto; opacity: 0.5; font-weight: 700; }
            .dt-pk-warn { flex: 0 0 auto; color: var(--bim-ui_color-warning, #e0a23b); font-size: 0.85rem; }
            .dt-pk-item bim-checkbox { flex: 1 1 auto; min-width: 0; }
            /* "Show by property set" provenance toggle at the foot of the picker. */
            .dt-pk-mode { display: flex; align-items: center; gap: 0.4rem; cursor: pointer;
              margin: 0 0.6rem 0.4rem; padding-top: 0.3rem; padding-bottom: 0.4rem; font-size: 0.7rem;
              color: var(--bim-ui_bg-contrast-80, #c9c9c9);
              border-top: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
              border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); }
            .dt-pk-empty { padding: 0.6rem; opacity: 0.6; }
            /* Structured-filter builder (AND-of-ORs condition rows). */
            .dtf { display: flex; flex-direction: column; gap: 0.3rem; }
            .dtf-head { display: flex; align-items: center; justify-content: space-between; }
            .dtf-title { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem;
              font-weight: 600; color: var(--bim-ui_bg-contrast-80, #c9c9c9); }
            .dtf-actions { display: inline-flex; gap: 0.3rem; }
            .dtf-row { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
            .dtf-where { font-size: 0.68rem; opacity: 0.55; width: 2.6rem; }
            /* bim-text-input operand — layout only; the component is self-themed. */
            .dtf-val { flex: 1 1 5rem; min-width: 4rem; }
            .dtf-and { font-size: 0.68rem; opacity: 0.55; }
            /* Multi-level group-by control. */
            .dtg { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
            .dtg-title { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem;
              font-weight: 600; color: var(--bim-ui_bg-contrast-80, #c9c9c9); }
            .dtg-chip { display: inline-flex; align-items: center; gap: 0.15rem; }
            .dtg-arrow { opacity: 0.45; font-size: 0.8rem; }
            /* Sort-order badge in a header cell (multi-key sort) — neutral. */
            .dt-hc-ord { flex: 0 0 auto; font-size: 0.6rem; font-weight: 700; line-height: 1;
              padding: 0.05rem 0.2rem; border-radius: 0.5rem;
              color: var(--bim-ui_bg-contrast-100, #e3e3e3);
              background: var(--bim-ui_bg-contrast-40, rgba(255,255,255,0.2)); }
            /* Saved-views control. */
            .dtv { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
            .dtv-title { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem;
              font-weight: 600; color: var(--bim-ui_bg-contrast-80, #c9c9c9); }
            /* bim-text-input view-name — layout only; the component is self-themed. */
            .dtv-name { flex: 1 1 7rem; min-width: 6rem; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            ${cardHeader("mdi:table", "Element Data", "1.1rem")}
            ${state.status === "empty"
              ? BUI.html`<div style="padding: 0.75rem 1.1rem;"><bim-label style="opacity: 0.6; white-space: normal;">No model loaded. Load a model to populate the table.</bim-label></div>`
              : BUI.html`
                <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 0.4rem; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));">
                  <!-- ONE compact toolbar: full-width search + icon controls. -->
                  <div class="dt-toolbar">
                    <bim-text-input
                      class="dt-search" icon="mdi:magnify" icon-inside placeholder="Search…"
                      .value=${query}
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
                    <bim-button class="dt-tbtn" icon="mdi:table-column-plus-after"
                      @click=${(e: Event) => openPicker(e.currentTarget as HTMLElement)}
                    ><bim-tooltip>Columns</bim-tooltip></bim-button>
                    <bim-button class="dt-tbtn" icon="mdi:filter-variant"
                      ?active=${conditions.length > 0 || openEditor === "filter"}
                      @click=${() => toggleEditor("filter")}
                    ><bim-tooltip>Filter</bim-tooltip></bim-button>
                    <bim-button class="dt-tbtn" icon="mdi:format-list-group"
                      ?active=${groupCols.length > 0 || openEditor === "group"}
                      @click=${() => toggleEditor("group")}
                    ><bim-tooltip>Group</bim-tooltip></bim-button>
                    ${client && projectId
                      ? BUI.html`<bim-button class="dt-tbtn" icon="mdi:bookmark-multiple-outline"
                          ?active=${!!activeViewName || openEditor === "views"}
                          @click=${() => toggleEditor("views")}
                        ><bim-tooltip>Saved views</bim-tooltip></bim-button>`
                      : null}
                    <bim-button class="dt-tbtn" icon="mdi:file-delimited-outline"
                      @click=${exportCsv}
                    ><bim-tooltip>Export CSV</bim-tooltip></bim-button>
                  </div>

                  <!-- Active filter + group chips — only when present. -->
                  ${conditions.length || groupCols.length
                    ? BUI.html`<div class="dt-chips">
                        ${conditions.map(
                          (c) => BUI.html`<span class="dt-chip" title=${condLabel(c)}>
                            <span class="dt-chip-tx">${condLabel(c)}</span>
                            <span class="dt-chip-x" @click=${() => removeCondition(c.id)}>✕</span>
                          </span>`,
                        )}
                        ${groupCols.map(
                          (g, i) => BUI.html`<span class="dt-chip grp" title=${colLabel(g)}>
                            <bim-icon icon="mdi:format-list-group"></bim-icon>
                            <span class="dt-chip-tx">${colLabel(g)}</span>
                            <span class="dt-chip-x" @click=${() => { groupCols.splice(i, 1); regroup(); }}>✕</span>
                          </span>`,
                        )}
                      </div>`
                    : null}

                  <!-- Saved-views editor (on demand). -->
                  ${openEditor === "views" && client && projectId
                    ? BUI.html`
                      <div class="dtv">
                        ${dropdown(
                          [
                            { value: "", label: "— Saved views —" },
                            ...savedViews.map((sv) => ({
                              value: sv.name,
                              label: `${sv.name}${activeViewName === sv.name && isDirty() ? " •" : ""}`,
                            })),
                          ],
                          activeViewName ?? "",
                          (v) => { if (v) restoreView(v); },
                          "9rem",
                        )}
                        ${savingNew
                          ? BUI.html`
                            <bim-text-input class="dtv-name" placeholder="View name" .value=${newViewName}
                              @input=${(e: Event) => { newViewName = String((e.target as { value?: string }).value ?? ""); }}
                              @keydown=${(e: KeyboardEvent) => {
                                if (e.key === "Enter" && newViewName.trim()) persistView(newViewName.trim());
                                else if (e.key === "Escape") { savingNew = false; update({}); }
                              }}></bim-text-input>
                            <bim-button label="Save" @click=${() => { if (newViewName.trim()) persistView(newViewName.trim()); }}></bim-button>
                            <bim-button icon="mdi:close" @click=${() => { savingNew = false; newViewName = ""; update({}); }}><bim-tooltip>Cancel</bim-tooltip></bim-button>`
                          : BUI.html`<bim-button label="Save as…" @click=${() => { savingNew = true; newViewName = activeViewName ?? ""; update({}); }}></bim-button>`}
                        ${activeViewName && !savingNew
                          ? BUI.html`
                            <bim-button label="Update" ?disabled=${!isDirty()} @click=${() => persistView(activeViewName!)}></bim-button>
                            <bim-button label="Delete" @click=${() => deleteView(activeViewName!)}></bim-button>`
                          : null}
                      </div>`
                    : null}

                  <!-- Filter editor (on demand). -->
                  ${openEditor === "filter"
                    ? BUI.html`<div class="dtf">
                    <div class="dtf-head">
                      <span class="dtf-title"><bim-icon icon="mdi:filter-variant"></bim-icon>Filters${conditions.length ? ` (${conditions.length})` : ""}</span>
                      <span class="dtf-actions">
                        ${conditions.length
                          ? BUI.html`<bim-button label="Clear" @click=${() => { conditions = []; viewport.scrollTop = 0; refreshList(); update({}); }}></bim-button>`
                          : null}
                        <bim-button label="Add filter" icon="mdi:plus" @click=${addCondition}></bim-button>
                      </span>
                    </div>
                    ${conditions.map((c, i) => {
                      const kind = colMeta(c.col)?.kind ?? "text";
                      const ops = kind === "number" ? NUM_OPS : TEXT_OPS;
                      const needOperand = !PRESENCE_OPS.has(c.op);
                      const between = c.op === "between";
                      return BUI.html`
                        <div class="dtf-row">
                          ${i > 0
                            ? dropdown(
                                [{ value: "AND", label: "AND" }, { value: "OR", label: "OR" }],
                                c.conj,
                                (v) => { c.conj = v as "AND" | "OR"; refreshList(); },
                                "3.6rem",
                              )
                            : BUI.html`<span class="dtf-where">Where</span>`}
                          ${dropdown(
                            allColumns().map((cc) => ({ value: cc.key, label: cc.label })),
                            c.col,
                            (v) => onColChange(c, v),
                            "8rem",
                          )}
                          ${dropdown(
                            ops.map((o) => ({ value: o.op, label: o.label })),
                            c.op,
                            (v) => { c.op = v as Op; refreshList(); update({}); },
                            "6rem",
                          )}
                          ${needOperand
                            ? BUI.html`<bim-text-input class="dtf-val" type=${kind === "number" ? "number" : "text"} .value=${c.v}
                                placeholder="value"
                                @input=${(e: Event) => { c.v = String((e.target as { value?: string }).value ?? ""); debouncedFilter(); }}></bim-text-input>`
                            : null}
                          ${between
                            ? BUI.html`<span class="dtf-and">and</span>
                              <bim-text-input class="dtf-val" type="number" .value=${c.v2} placeholder="value"
                                @input=${(e: Event) => { c.v2 = String((e.target as { value?: string }).value ?? ""); debouncedFilter(); }}></bim-text-input>`
                            : null}
                          <bim-button icon="mdi:close" @click=${() => removeCondition(c.id)}><bim-tooltip>Remove condition</bim-tooltip></bim-button>
                        </div>`;
                    })}
                  </div>`
                    : null}

                  <!-- Group editor (on demand). -->
                  ${openEditor === "group"
                    ? BUI.html`<div class="dtg">
                    <span class="dtg-title"><bim-icon icon="mdi:format-list-group"></bim-icon>Group by</span>
                    ${groupCols.map(
                      (gc, i) => BUI.html`
                        <span class="dtg-chip">
                          ${i > 0 ? BUI.html`<span class="dtg-arrow">›</span>` : null}
                          ${dropdown(
                            allColumns().map((cc) => ({ value: cc.key, label: cc.label })),
                            gc,
                            (v) => { groupCols[i] = v; regroup(); },
                            "8rem",
                          )}
                          <bim-button icon="mdi:close" @click=${() => { groupCols.splice(i, 1); regroup(); }}><bim-tooltip>Remove level</bim-tooltip></bim-button>
                        </span>`,
                    )}
                    <bim-button label="Level" icon="mdi:plus" @click=${addGroupLevel}></bim-button>
                    ${groupCols.length
                      ? BUI.html`<bim-button label="Ungroup" @click=${() => { groupCols = []; regroup(); }}></bim-button>`
                      : BUI.html`<span style="font-size: 0.68rem; opacity: 0.5; color: var(--bim-ui_bg-contrast-80, #c9c9c9);">none</span>`}
                  </div>`
                    : null}

                  ${state.note
                    ? BUI.html`<div style="font-size: 0.7rem; opacity: 0.6; color: var(--bim-ui_bg-contrast-80, #c9c9c9);">${state.note}</div>`
                    : null}
                </div>
                ${state.status === "loading"
                  ? BUI.html`<div style="padding: 0.5rem 1.1rem;"><bim-label style="opacity: 0.6;">Indexing…</bim-label></div>`
                  : null}
                <div
                  ${BUI.ref(onHostCreated)}
                  style=${BUI.styleMap({ flex: "1 1 auto", minHeight: "0" })}
                ></div>
                <div class="dt-footer" ${BUI.ref(onFooterCreated)}></div>`}
          </div>
        </bim-panel>
      `;
    },
    { status: "loading", note: "" },
  );

  // ── 3D → table selection reflection ────────────────────────────
  highlighter.events.select.onHighlight.add((modelIdMap: OBC.ModelIdMap) => {
    // Skip the echo of our own row-click drive (avoids feedback loop).
    if (pendingInternal > 0) {
      pendingInternal--;
      return;
    }
    selectedRowKeys.clear();
    for (const [modelId, set] of Object.entries(modelIdMap)) {
      for (const id of set) selectedRowKeys.add(`${modelId}:${id}`);
    }
    render(true);
    scrollSelectionIntoView();
  });

  highlighter.events.select.onClear.add(() => {
    if (selectedRowKeys.size === 0) return;
    selectedRowKeys.clear();
    render(true);
  });

  // ── Triggers ───────────────────────────────────────────────────
  // Index whatever is already in fragments.list at construction (the panel is
  // lazy — it may be created AFTER the auto-loaded model arrived, so onModelLoaded
  // would never fire for it). Then (re)index on every model load. We listen to
  // BOTH the worker-ready signal (onModelLoaded — the reliable one) AND the raw
  // list add (onItemSet) as a fallback: an early onItemSet may fail with "Model
  // not found", but the rebuildToken makes the later successful pass win, so an
  // empty table can never get stuck if onModelLoaded is missed.
  // LAZY indexing — the per-model `getTableData` build must NEVER run on the
  // model-load path: firing it on every onModelLoaded/onItemSet (even with the
  // panel CLOSED) would contend with the fragments worker during streaming and
  // make hover/select/auto-anchor crawl for the whole load window. So we only
  // index when the Data panel is actually VISIBLE. Model changes just mark the
  // index dirty; the (re)build happens the next time the panel is shown — by
  // then the model has finished streaming, so there's no contention.
  let rebuildScheduled = false;
  let indexDirty = true; // models already in fragments.list need a first index
  let panelVisible = false;
  const maybeRebuild = () => {
    if (!panelVisible || !indexDirty || rebuildScheduled) return;
    rebuildScheduled = true;
    queueMicrotask(() => {
      rebuildScheduled = false;
      indexDirty = false;
      void rebuild();
    });
  };
  const markDirty = () => {
    indexDirty = true;
    maybeRebuild(); // re-index immediately only if the panel is open right now
  };
  fragments.core.onModelLoaded.add(markDirty);
  fragments.list.onItemSet.add(markDirty);
  fragments.list.onItemDeleted.add(markDirty);
  // Flip on when the docked panel is shown by the layout switcher, off when hidden.
  const visObserver = new IntersectionObserver((entries) => {
    const shown = entries.some((e) => e.isIntersecting);
    if (shown) {
      panelVisible = true;
      maybeRebuild();
    } else {
      panelVisible = false;
    }
  });
  visObserver.observe(panel);
  void loadSavedViews(); // hydrate the Views dropdown from __project_data/bim-viewer/

  return panel;
};
