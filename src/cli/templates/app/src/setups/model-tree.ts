import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";
import { toolPlaceholderUri } from "../assets/tool-placeholder";

/**
 * Model Tree — a VIRTUALIZED (windowed) spatial-structure browser.
 *
 * Why not bim-table: bim-table renders every expanded row as real DOM (with
 * per-row listeners), so expanding a storey with hundreds of elements puts
 * hundreds of DOM rows over the WebGL canvas → per-frame compositing cost. This
 * implementation keeps the model as a plain node tree and renders ONLY the rows
 * currently in the scroll window (recycled on scroll), so DOM rows ≈ viewport
 * height / row height regardless of how big the expanded subtree is.
 *
 * No per-row MutationObserver / requestUpdate (the old idle-CPU feedback loop):
 * the collapsed/expanded label and the selected highlight update by re-rendering
 * the window, and all interaction goes through ONE delegated listener.
 *
 * Features preserved: spatial spine (Project>Site>Building>Storey) with the
 * storey-category flatten + single-child-wrapper skip, the full category icon
 * map, debounced in-memory search (name/category/expressId, ancestors kept),
 * CLICK = select item + all descendants, per-row Focus button (fitToSphere on
 * the subtree), default-expand to storeys, collapsed/expanded label, SELECTION-
 * ONLY (no 3D hover), light-gray text, inset scroll + dividers + card chrome.
 *
 * @param components engine components
 */

const FLATTEN_CATEGORIES = ["IFCBUILDINGSTOREY"];
const FLATTEN_SET = new Set(FLATTEN_CATEGORIES.map((c) => c.toUpperCase()));
const STOREY = "IFCBUILDINGSTOREY";

const ROW_H = 24; // px, fixed row height (enables simple windowing math)
const INDENT = 12; // px per depth level
const BASE_PAD = 18; // px left padding at depth 0 (rows are full-bleed; keeps text inset)
const BUFFER = 6; // extra rows above/below the viewport

const prettyCategory = (category: string) => {
  const base = category.replace(/^IFC/i, "");
  if (!base) return "";
  return base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
};

// Representative icon per IFC category (iconify/mdi names bim-icon takes).
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

interface TreeNode {
  key: string;
  nm: string; // bare instance Name ("" if none)
  prettyCat: string;
  category: string; // raw IFC category, for the icon
  modelId: string;
  localId: number; // ExpressId (-1 if none)
  ids: number[]; // own + all descendant localIds (select / focus)
  children: TreeNode[];
  defaultExpand: boolean; // ancestor of a storey → start expanded
}

// Collapsed → `Category - Name - ExpressId`; expanded → `Name - ExpressId`.
const labelFor = (n: TreeNode, collapsed: boolean) => {
  const id = n.localId >= 0 ? String(n.localId) : "";
  const parts = collapsed ? [n.prettyCat, n.nm, id] : [n.nm || n.prettyCat || "Item", id];
  return parts.filter(Boolean).join(" - ");
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const modelTree = (components: OBC.Components) => {
  const fragments = components.get(OBC.FragmentsManager);
  const highlighter = components.get(OBF.Highlighter);
  const selectName = highlighter.config.selectName;

  // ── Tree state ─────────────────────────────────────────────────
  let roots: TreeNode[] = []; // currently displayed tree (spatial OR category)
  let spatialRoots: TreeNode[] = []; // canonical spatial tree (source of truth)
  let mode: "spatial" | "category" = "spatial";
  const nodeByKey = new Map<string, TreeNode>();
  const expanded = new Set<string>(); // keys whose children are shown
  const selectedKeys = new Set<string>(); // clicked rows (row highlight)
  // `anc[c]` = a vertical guide continues at indent column c (ancestor has a
  // following sibling); `last` = this node is the last child (→ half-height
  // elbow). Both are only computed in the normal (non-search) view.
  let visible: { node: TreeNode; depth: number; anc?: boolean[]; last?: boolean }[] = [];
  let query = "";
  let rebuildToken = 0;
  let searchTimer: number | undefined;
  let keyCounter = 0;

  // Virtualization DOM (created once, managed imperatively).
  const viewport = document.createElement("div");
  viewport.className = "tree-vp";
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

  // ── Build node tree from a model's spatial structure ───────────
  const buildModel = async (model: FRAGS.FragmentsModel): Promise<TreeNode | null> => {
    const structure = await model.getSpatialStructure();
    if (!structure) return null;

    // One round-trip for all names.
    const ids: number[] = [];
    const collectIds = (node: FRAGS.SpatialTreeItem) => {
      if (node.localId !== null && node.localId !== undefined) ids.push(node.localId);
      node.children?.forEach(collectIds);
    };
    collectIds(structure);
    const nameMap = new Map<number, string>();
    if (ids.length > 0) {
      const data = await model.getItemsData(ids, {
        attributesDefault: false,
        attributes: ["Name"],
      });
      data.forEach((d, i) => {
        const name = (d as Record<string, unknown>)?.Name;
        if (
          name &&
          !Array.isArray(name) &&
          typeof name === "object" &&
          "value" in name &&
          (name as { value: unknown }).value != null
        ) {
          nameMap.set(ids[i], String((name as { value: unknown }).value));
        }
      });
    }

    // Real per-item category source (same as the data-table): the spatial-tree
    // node's `.category` is only populated for container/spine nodes, so in
    // models where elements sit under a flat container (e.g. BLOXHUB) most
    // element nodes have an EMPTY category and fall through to "Uncategorized".
    // getItemsOfCategories reads each item's actual IFC category from the model's
    // category buffer — use it as the authoritative source, keyed by localId.
    const catMap = new Map<number, string>();
    try {
      const byCat = await model.getItemsOfCategories([/.*/]);
      for (const [cat, lids] of Object.entries(byCat)) {
        for (const lid of lids) catMap.set(lid, cat);
      }
    } catch (error) {
      console.warn("[model-tree] getItemsOfCategories failed", model.modelId, error);
    }

    // Skip pure category-wrapper nodes (single child, no localId), carrying the
    // meaningful category down (it lives on the wrapper, not the instance).
    const resolveInstance = (node: FRAGS.SpatialTreeItem) => {
      let cur = node;
      let chainCat = cur.category ?? "";
      while (
        cur.children &&
        cur.children.length === 1 &&
        (cur.localId === null || cur.localId === undefined)
      ) {
        cur = cur.children[0];
        if (cur.category) chainCat = cur.category;
      }
      return { inst: cur, chainCat };
    };

    type Built = { node: TreeNode; cat: string; storeyAncestor: boolean };

    // Children with whitelisted category-GROUP nodes flattened away.
    const buildChildren = (node: FRAGS.SpatialTreeItem, inheritedCat = ""): Built[] => {
      const out: Built[] = [];
      for (const child of node.children ?? []) {
        const isFlattenGroup =
          (child.localId === null || child.localId === undefined) &&
          !!child.children &&
          child.children.length > 0 &&
          FLATTEN_SET.has((child.category ?? "").toUpperCase());
        if (isFlattenGroup) {
          out.push(...buildChildren(child, child.category ?? inheritedCat));
        } else {
          out.push(toNode(child, inheritedCat));
        }
      }
      return out;
    };

    const toNode = (raw: FRAGS.SpatialTreeItem, inheritedCat = ""): Built => {
      const { inst, chainCat } = resolveInstance(raw);
      const localId = inst.localId ?? -1;
      // Prefer the real per-item category; fall back to the spatial node's.
      const realCat = localId >= 0 ? catMap.get(localId) : undefined;
      const category = realCat || inst.category || chainCat || inheritedCat || "";
      const rawName = localId >= 0 ? nameMap.get(localId) : undefined;
      const nm = rawName ? String(rawName) : "";

      const built = buildChildren(inst);
      const rawHasStorey = (inst.children ?? []).some(
        (c) => (c.category ?? "").toUpperCase() === STOREY,
      );
      const storeyAncestor =
        rawHasStorey || built.some((b) => b.cat === STOREY || b.storeyAncestor);

      const childIds: number[] = [];
      for (const b of built) childIds.push(...b.node.ids);

      const node: TreeNode = {
        key: `${model.modelId}#${(keyCounter += 1)}`,
        nm,
        prettyCat: prettyCategory(category),
        category,
        modelId: model.modelId,
        localId,
        ids: (localId >= 0 ? [localId] : []).concat(childIds),
        children: built.map((b) => b.node),
        defaultExpand: storeyAncestor,
      };
      return { node, cat: category, storeyAncestor };
    };

    return toNode(structure).node;
  };

  // ── Visible-list (flatten by expand state / search filter) ─────
  const indexNodes = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      nodeByKey.set(n.key, n);
      indexNodes(n.children);
    }
  };

  const matchNode = (n: TreeNode, q: string) =>
    `${n.nm} ${n.prettyCat} ${n.localId >= 0 ? n.localId : ""}`
      .toLowerCase()
      .includes(q);

  const rebuildVisible = () => {
    const out: { node: TreeNode; depth: number; anc?: boolean[]; last?: boolean }[] = [];
    const q = query.trim().toLowerCase();

    if (q) {
      // Search: a matching node shows its whole subtree; a non-matching node is
      // kept only as an ancestor of a match. Returns the node's emitted rows, or
      // null if neither it nor any descendant matches.
      const subtree = (n: TreeNode, depth: number, acc: { node: TreeNode; depth: number }[]) => {
        acc.push({ node: n, depth });
        for (const c of n.children) subtree(c, depth + 1, acc);
      };
      const dfs = (n: TreeNode, depth: number): { node: TreeNode; depth: number }[] | null => {
        if (matchNode(n, q)) {
          const acc: { node: TreeNode; depth: number }[] = [];
          subtree(n, depth, acc);
          return acc;
        }
        const childRows: { node: TreeNode; depth: number }[] = [];
        for (const c of n.children) {
          const r = dfs(c, depth + 1);
          if (r) childRows.push(...r);
        }
        return childRows.length ? [{ node: n, depth }, ...childRows] : null;
      };
      for (const r of roots) {
        const res = dfs(r, 0);
        if (res) out.push(...res);
      }
    } else {
      // Carry the connector-guide state: `anc` holds, for each indent column
      // 0..depth-2, whether that ancestor branch continues below; `last` marks a
      // last child (half-height elbow). A child gains a guide column for THIS
      // node only when this node actually has an indent column (depth ≥ 1).
      const dfs = (n: TreeNode, depth: number, anc: boolean[], last: boolean) => {
        out.push({ node: n, depth, anc, last });
        if (!expanded.has(n.key)) return;
        const childAnc = depth >= 1 ? [...anc, !last] : anc;
        n.children.forEach((c, i) =>
          dfs(c, depth + 1, childAnc, i === n.children.length - 1),
        );
      };
      roots.forEach((r, i) => dfs(r, 0, [], i === roots.length - 1));
    }
    visible = out;
  };

  // ── Render the window ──────────────────────────────────────────
  // Tree connector guides: vertical lines at each continuing ancestor column +
  // an elbow (vertical-to-middle + horizontal) into the node. Absolutely
  // positioned so they cost no layout. Suppressed in search (filtered view).
  const GUIDE_O = 7; // px, aligns a guide with an ancestor caret's centre
  const guideHtml = (
    depth: number,
    anc: boolean[],
    last: boolean,
    expanded: boolean,
  ) => {
    if (query) return "";
    let h = "";
    if (depth > 0) {
      for (let c = 0; c < depth - 1; c += 1) {
        if (anc[c]) {
          h += `<span class="t-guide t-vline" style="left:${BASE_PAD + c * INDENT + GUIDE_O}px"></span>`;
        }
      }
      const ex = BASE_PAD + (depth - 1) * INDENT + GUIDE_O;
      h += `<span class="t-guide t-elbow${last ? "" : " full"}" style="left:${ex}px"></span>`;
      h += `<span class="t-guide t-hline" style="left:${ex}px;width:${INDENT}px"></span>`;
    }
    // Descending stub: when this node is expanded with visible children, draw a
    // half-height vertical at the CHILDREN's column (depth) from the caret centre
    // (50%) to the row bottom, so the down-chevron connects to the first child's
    // full-height ancestor vertical below. x matches the children's elbow column.
    if (expanded) {
      h += `<span class="t-guide t-vstub" style="left:${BASE_PAD + depth * INDENT + GUIDE_O}px"></span>`;
    }
    return h;
  };
  const isCollapsed = (n: TreeNode) => !query && !expanded.has(n.key);
  const rowHtml = (node: TreeNode, depth: number, anc?: boolean[], last?: boolean) => {
    const hasKids = node.children.length > 0;
    const collapsed = isCollapsed(node);
    const showsChildVertical = !query && hasKids && expanded.has(node.key);
    const caret = hasKids
      ? `<span class="t-caret" data-act="toggle"><bim-icon icon="${
          collapsed ? "mdi:chevron-right" : "mdi:chevron-down"
        }"></bim-icon></span>`
      : `<span class="t-caret"></span>`;
    return (
      `<div class="t-row${selectedKeys.has(node.key) ? " sel" : ""}" data-key="${node.key}" ` +
      `style="height:${ROW_H}px;padding-left:${BASE_PAD + depth * INDENT}px;">` +
      guideHtml(depth, anc ?? [], last ?? true, showsChildVertical) +
      caret +
      `<bim-icon class="t-ico" icon="${iconFor(node.category)}"></bim-icon>` +
      `<span class="t-label">${esc(labelFor(node, collapsed))}</span>` +
      `<span class="t-focus" data-act="focus"><bim-icon icon="mdi:image-filter-center-focus"></bim-icon><bim-tooltip placement="top">Focus</bim-tooltip></span>` +
      `</div>`
    );
  };

  // Build a single row element from its HTML (so entering rows get the exact
  // same markup the old innerHTML path produced — caret, icons, focus tooltip).
  const buildRow = (i: number): HTMLElement => {
    const v = visible[i];
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(v.node, v.depth, v.anc, v.last);
    return tmp.firstElementChild as HTMLElement;
  };

  // Index→element recycler. A row that stays within the window keeps its exact
  // DOM element (and its already-rendered <bim-icon>s) across scroll, so icons
  // are never recreated → no blink. Only rows ENTERING the window are built and
  // rows LEAVING are removed. A forced rebuild (selection/expand/search/data
  // change) clears this map so the affected rows are rebuilt once.
  const mounted = new Map<number, HTMLElement>();

  let lastStart = -1;
  let lastEnd = -1;
  const render = (force = false) => {
    const total = visible.length;
    sizer.style.height = `${total * ROW_H}px`;
    const top = viewport.scrollTop;
    const vh = viewport.clientHeight || ROW_H;
    const start = Math.max(0, Math.floor(top / ROW_H) - BUFFER);
    const end = Math.min(total, Math.ceil((top + vh) / ROW_H) + BUFFER);
    if (!force && start === lastStart && end === lastEnd) return;
    // Defensive: a <bim-tooltip> reparents itself into a global body-level
    // container when shown, so removing a row below would NOT remove a tooltip
    // that is currently visible (its row gets detached but the tooltip lives
    // elsewhere). The library self-heals via a host observer, but we also
    // proactively dismiss any visible tooltip here so it can't flicker: fire
    // mouseleave on each current Focus host (where the hide listener is bound).
    if (document.querySelector("bim-tooltip[visible]")) {
      for (const host of content.querySelectorAll<HTMLElement>(".t-focus")) {
        host.dispatchEvent(new MouseEvent("mouseleave"));
      }
    }
    // A forced rebuild means the underlying data/markup for the window changed
    // (selection highlight, expand/collapse, search, rebuild). Drop every
    // mounted row so they are rebuilt once with fresh markup — this only happens
    // off the scroll path, so the (unnoticeable) one-time rebuild is fine; plain
    // scrolling never forces and so always reuses existing rows.
    if (force) {
      mounted.clear();
      content.textContent = "";
    }
    lastStart = start;
    lastEnd = end;
    content.style.transform = `translateY(${start * ROW_H}px)`;
    // Remove rows that have scrolled out of [start, end).
    for (const [i, el] of mounted) {
      if (i < start || i >= end) {
        el.remove();
        mounted.delete(i);
      }
    }
    // Insert rows entering [start, end), keeping DOM order by index. We walk the
    // window in order and splice each new element before the first already-
    // mounted element with a higher index (or append if none).
    let cursor = content.firstElementChild as HTMLElement | null;
    for (let i = start; i < end; i++) {
      const existing = mounted.get(i);
      if (existing) {
        // Already in place (in index order) — advance the cursor past it.
        cursor = existing.nextElementSibling as HTMLElement | null;
        continue;
      }
      const el = buildRow(i);
      content.insertBefore(el, cursor);
      mounted.set(i, el);
      // cursor stays pointing at the same following node, so the next entering
      // index is inserted after this one (preserving ascending DOM order).
    }
  };

  // ── Interaction (one delegated listener) ───────────────────────
  const idsMap = (n: TreeNode): OBC.ModelIdMap | null => {
    const real = n.ids.filter((id) => id >= 0);
    if (real.length === 0) return null;
    return { [n.modelId]: new Set(real) };
  };

  const selectNode = (n: TreeNode, additive: boolean) => {
    if (additive) {
      if (selectedKeys.has(n.key)) selectedKeys.delete(n.key);
      else selectedKeys.add(n.key);
    } else {
      selectedKeys.clear();
      selectedKeys.add(n.key);
    }
    const map = idsMap(n);
    if (map) void highlighter.highlightByID(selectName, map, !additive, false);
    else if (!additive) void highlighter.clear(selectName);
    render(true); // refresh row highlight
  };

  const focusNode = async (n: TreeNode) => {
    const map = idsMap(n);
    if (!map) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = [...components.get(OBC.Worlds).list.values()][0] as any;
    const controls = world?.camera?.controls;
    if (!controls) return;
    try {
      const boxes = (await fragments.getBBoxes(map)) as THREE.Box3[];
      const box = new THREE.Box3();
      for (const b of boxes) box.union(b);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      await controls.fitToSphere(sphere, true); // animated, preserves view dir
    } catch (error) {
      console.warn("[model-tree] focus failed", error);
    }
  };

  const toggleExpand = (key: string) => {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    rebuildVisible();
    render(true);
  };

  content.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const rowEl = target.closest<HTMLElement>(".t-row");
    if (!rowEl) return;
    const node = nodeByKey.get(rowEl.dataset.key ?? "");
    if (!node) return;
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "toggle") {
      toggleExpand(node.key);
    } else if (act === "focus") {
      // Focus also selects the node (and its descendants), like a plain click.
      selectNode(node, false);
      void focusNode(node);
    } else {
      selectNode(node, (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey);
    }
  });

  // Re-window on scroll (rAF-coalesced) and on resize.
  let scrollRaf = 0;
  viewport.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      render();
    });
  });
  new ResizeObserver(() => render()).observe(viewport);

  // Clearing the selection elsewhere clears the tree row highlight.
  highlighter.events.select.onClear.add(() => {
    if (selectedKeys.size === 0) return;
    selectedKeys.clear();
    render(true);
  });

  // ── Category grouping ──────────────────────────────────────────
  // Flat grouping by IFC category derived from the spatial tree (each element
  // node carries its category), so it covers exactly the elements the spatial
  // view shows — no separate Classifier round-trip, always in sync. Each
  // category becomes an expandable group whose children are its element nodes.
  const buildCategoryRoots = (source: TreeNode[]): TreeNode[] => {
    const byCat = new Map<string, TreeNode[]>();
    const visit = (n: TreeNode) => {
      if (n.localId >= 0) {
        const cat = n.category || "Uncategorized";
        let arr = byCat.get(cat);
        if (!arr) {
          arr = [];
          byCat.set(cat, arr);
        }
        arr.push({
          key: `${n.modelId}#cat#${(keyCounter += 1)}`,
          nm: n.nm,
          prettyCat: n.prettyCat,
          category: n.category,
          modelId: n.modelId,
          localId: n.localId,
          ids: [n.localId],
          children: [],
          defaultExpand: false,
        });
      }
      n.children.forEach(visit);
    };
    source.forEach(visit);

    const cats = [...byCat.keys()].sort((a, b) =>
      prettyCategory(a).localeCompare(prettyCategory(b)),
    );
    return cats.map((cat) => {
      const kids = byCat.get(cat)!;
      kids.sort((a, b) =>
        (a.nm || String(a.localId)).localeCompare(b.nm || String(b.localId)),
      );
      const ids: number[] = [];
      for (const k of kids) ids.push(...k.ids);
      return {
        key: `catgroup#${(keyCounter += 1)}`,
        nm: "",
        // The label cell shows "Category (count)" via prettyCat; raw category
        // drives the icon.
        prettyCat: `${prettyCategory(cat) || cat} (${kids.length})`,
        category: cat,
        modelId: kids[0]?.modelId ?? "",
        localId: -1,
        ids,
        children: kids,
        defaultExpand: false,
      };
    });
  };

  // Switch the displayed tree to the current `mode` and re-render. Selection in
  // the 3D scene (driven by the Highlighter) is independent of tree keys, so it
  // persists across a mode switch; only the row-highlight set is reset.
  const applyMode = () => {
    roots = mode === "category" ? buildCategoryRoots(spatialRoots) : spatialRoots;
    nodeByKey.clear();
    indexNodes(roots);
    expanded.clear();
    if (mode === "spatial") {
      const markExpand = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (n.defaultExpand) expanded.add(n.key);
          markExpand(n.children);
        }
      };
      markExpand(roots);
    }
    selectedKeys.clear();
    rebuildVisible();
    lastStart = lastEnd = -1;
    viewport.scrollTop = 0;
    render(true);
    update({}); // re-render the panel template so the view-mode buttons' active state refreshes
  };

  // ── Rebuild from all loaded models ─────────────────────────────
  const rebuild = async () => {
    const token = ++rebuildToken;
    const models = [...fragments.list.values()];
    if (models.length === 0) {
      if (token === rebuildToken) {
        spatialRoots = [];
        roots = [];
        nodeByKey.clear();
        rebuildVisible();
        render(true);
        update({ status: "empty" });
      }
      return;
    }
    update({ status: "loading" });
    try {
      const built = (
        await Promise.all(
          models.map((m) =>
            buildModel(m).catch((error) => {
              if (!/Model not found/i.test(String(error?.message ?? error))) {
                console.warn("[model-tree] failed to build", m.modelId, error);
              }
              return null;
            }),
          ),
        )
      ).filter((n): n is TreeNode => n !== null);
      if (token !== rebuildToken) return;
      spatialRoots = built;
      // Build the displayed tree for the current mode (default-expands storeys
      // in spatial mode; categories start collapsed in category mode).
      applyMode();
      update({ status: built.length > 0 ? "ready" : "empty" });
    } catch (error) {
      if (token !== rebuildToken) return;
      console.warn("[model-tree] failed to build spatial structure", error);
      update({ status: "empty" });
    }
  };

  // ── Panel chrome (BUI) — the windowed viewport is mounted into it ──
  interface PanelState {
    status: "loading" | "empty" | "ready";
  }
  const [panel, update] = BUI.Component.create<BUI.Panel, PanelState>(
    (state) => {
      const onHostCreated = (el?: Element) => {
        if (!el || el.contains(viewport)) return;
        el.appendChild(viewport);
        render(true);
      };
      return BUI.html`
        <bim-panel
          label="Items"
          icon="mdi:file-tree"
          header-hidden
          style="width: 100%; height: 100%; pointer-events: auto;"
        >
          <style>
            .tree-vp { height: 100%; overflow-y: auto; }
            .tree-vp::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
            .tree-vp::-webkit-scrollbar-thumb { border-radius: 0.25rem; background-color: var(--bim-scrollbar--c, #3C3C41); }
            .tree-vp::-webkit-scrollbar-track { background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10)); }
            .t-row { position: relative; display: flex; align-items: center; gap: 0.3rem; box-sizing: border-box; padding-right: 0.4rem; font-size: 0.72rem; line-height: 1.1; color: var(--bim-ui_bg-contrast-100, #e3e3e3); border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1)); cursor: pointer; }
            /* Tree connector guides (absolute → no layout cost). */
            .t-guide { position: absolute; top: 0; height: 100%; pointer-events: none; }
            .t-vline { width: 0; border-left: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.16)); }
            .t-elbow { width: 0; height: 50%; top: 0; border-left: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.16)); }
            .t-elbow.full { height: 100%; }
            .t-hline { height: 0; top: 50%; border-top: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.16)); }
            .t-vstub { width: 0; top: 50%; height: 50%; border-left: 1px solid var(--bim-ui_bg-contrast-30, rgba(255,255,255,0.16)); }
            .t-row:hover { background: var(--bim-ui_bg-contrast-20); }
            .t-row.sel { background: color-mix(in lab, var(--bim-ui_bg-contrast-20) 35%, var(--bim-ui_bg-contrast-70) 12%); }
            /* Caret + icon sit ABOVE the absolutely-positioned guide lines
               (positioned elements paint over the guides regardless of DOM
               order; the guides are pointer-events:none so clicks still land). */
            .t-caret { position: relative; z-index: 1; flex: 0 0 auto; width: 0.95rem; display: inline-flex; align-items: center; justify-content: center; color: var(--bim-ui_bg-contrast-60, #9a9a9a); font-size: 0.85rem; }
            .t-ico { position: relative; z-index: 1; flex: 0 0 auto; color: #99a0ae; font-size: 0.9rem; }
            .t-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .t-focus { flex: 0 0 auto; display: inline-flex; align-items: center; cursor: pointer; color: #99a0ae; font-size: 0.85rem; margin-right: 0.5rem; }
          </style>
          <div style="display: flex; flex-direction: column; height: 100%; width: 100%;">
            ${cardHeader("mdi:file-tree", "Items", "1.1rem")}
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 0.4rem 0.4rem 0.4rem 1.1rem; gap: 0.25rem;">
              ${state.status === "empty"
                ? BUI.html`<div style="
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    gap: 0.75rem; height: 100%; min-height: 12rem; padding: 1rem; text-align: center;
                  ">
                    <img src=${toolPlaceholderUri} alt="" style="width: 7.5rem; height: auto; opacity: 0.9;" />
                    <bim-label style="opacity: 0.55; white-space: normal;">No model loaded.</bim-label>
                  </div>`
                : state.status === "loading"
                  ? BUI.html`<div style="padding: 0.75rem;"><bim-label style="opacity: 0.6;">Loading…</bim-label></div>`
                  : null}
              ${state.status === "ready"
                ? BUI.html`<bim-text-input
                    icon="mdi:magnify"
                    icon-inside
                    placeholder="Search tree…"
                    style="flex: 0 0 auto; width: 100%; margin: 0 0 0.25rem -0.35rem;"
                    @input=${(e: Event) => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const v = String((e.target as any).value ?? "");
                      if (searchTimer !== undefined) clearTimeout(searchTimer);
                      searchTimer = window.setTimeout(() => {
                        query = v;
                        rebuildVisible();
                        viewport.scrollTop = 0;
                        render(true);
                      }, 200);
                    }}
                  ></bim-text-input>
                  <!-- View-mode selector: a segmented row of buttons (extensible —
                       add more views later). Active view = main-accent filled. -->
                  <div style="flex: 0 0 auto; display: flex; gap: 0; width: 100%; box-sizing: border-box; margin: 0 0 0.3rem -0.35rem;">
                    <bim-button
                      label="Tree"
                      icon="mdi:file-tree"
                      ?active=${mode === "spatial"}
                      @click=${() => {
                        if (mode !== "spatial") {
                          mode = "spatial";
                          applyMode();
                        }
                      }}
                      style="flex: 1 1 0; height: 1.7rem; border-radius: 0.3rem 0 0 0.3rem;"
                    ></bim-button>
                    <bim-button
                      label="Categories"
                      icon="mdi:shape-outline"
                      ?active=${mode === "category"}
                      @click=${() => {
                        if (mode !== "category") {
                          mode = "category";
                          applyMode();
                        }
                      }}
                      style="flex: 1 1 0; height: 1.7rem; border-radius: 0 0.3rem 0.3rem 0;"
                    ></bim-button>
                  </div>
                  <div style="flex: 0 0 auto; border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255, 255, 255, 0.1)); margin: 0 -0.4rem 0.1rem -1.1rem;"></div>`
                : null}
              <div
                ${BUI.ref(onHostCreated)}
                style=${BUI.styleMap({
                  display: state.status === "ready" ? "block" : "none",
                  flex: "1 1 auto",
                  minHeight: "0",
                  // Break out of the container's horizontal padding so the row
                  // dividers reach both panel edges (full-bleed).
                  marginLeft: "-1.1rem",
                  marginRight: "-0.4rem",
                })}
              ></div>
            </div>
          </div>
        </bim-panel>
      `;
    },
    { status: "loading" },
  );

  // ── Triggers ───────────────────────────────────────────────────
  fragments.core.onModelLoaded.add(() => rebuild());
  fragments.list.onItemDeleted.add(() => rebuild());
  rebuild();

  return panel;
};
