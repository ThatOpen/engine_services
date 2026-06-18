import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import { cardHeader } from "./card-header";
import { formatGlyph } from "./file-format-icons";
import { toolPlaceholderUri } from "../assets/tool-placeholder";

/**
 * The "Project Files" card (mirrors the properties panel). Lists the project's
 * files, lets you upload new ones, and — for IFC files — runs the IFC→fragments
 * cloud component. Returns its `bim-panel` element WITHOUT self-mounting — the
 * caller (leftStack) places it in the left column stack.
 *
 * UI behaviour:
 *  - Each IFC is a top-level row; its generated `.frag` is shown nested under it
 *    (matched by basename) with a Load action. A `.frag` with no source IFC
 *    shows as its own top-level row.
 *  - Conversion is automatic on upload (no manual button). While an upload's IFC
 *    converts, its row shows a progress bar driven by the polled execution %.
 *  - Every row has a delete action (archive, with an inline confirm).
 *
 * Uses the platform client (same instance AppManager holds): listFiles,
 * createFile, downloadFile, listComponents, executeComponent, getExecution,
 * archiveFile.
 *
 * @param components engine components
 * @param client the PlatformClient (from PlatformClient.fromPlatformContext)
 * @returns the `bim-panel` element for the caller to mount
 */
interface FileEntry {
  id: string;
  name: string;
  ext: string;
  base: string;
}

interface Job {
  progress: number;
  label: string;
}

// An optimistic, not-yet-uploaded file shown the instant it's picked.
interface UploadEntry {
  tempId: string;
  name: string;
  ext: string;
  base: string;
}

interface FilesState {
  loading: boolean;
  note: string;
  files: FileEntry[];
  jobs: Record<string, Job>; // keyed by source file id
  confirmDelete: string | null; // file id pending an inline delete confirm
  loaded: string[]; // modelIds currently in the scene (fragments.list keys = fragIds)
  loadedByIfc: Record<string, string>; // IFC fileId → the fragId currently loaded for it
  fragOf: Record<string, string>; // IFC fileId → its fragments fileId (from metadata)
  loadingModels: string[]; // modelIds with an in-flight loadFrag (Add spinner)
  uploads: UploadEntry[]; // optimistic rows for in-flight uploads
  // Frags the app can REACH via IFC metadata but which may be absent from
  // listFiles (old-converter output created without projectId, hidden-file
  // output, or eventual-consistency lag). Keyed by fragId → { name, ifcId }.
  // Guarantees a detached frag never becomes unreachable: even with no listFiles
  // row, it surfaces as a standalone "orphan" row and stays in the attach picker.
  knownFrags: Record<string, { name: string; ifcId: string }>;
  associating: string | null; // IFC fileId whose frag-attach picker is open
  attachOptions: { fragId: string; label: string }[]; // frags offered in the picker
  attachLoading: boolean; // picker is gathering candidate frags
  filter: string; // file-list search query (filters rows by name)
}

const omit = (obj: Record<string, Job>, key: string) => {
  const clone = { ...obj };
  delete clone[key];
  return clone;
};

// Match the app's standard hairline everywhere (1px contrast-20) — the files
// menu must not draw heavier rules than the rest of the panels.
const BORDER = "1px solid var(--bim-ui_bg-contrast-20, rgba(255, 255, 255, 0.1))";

// TEMP DIAGNOSTIC — one-shot guard so the frag-visibility probe runs only once
// per page load (not on every silent reload/refocus). Remove with the diagnostic.
let fragDiagRan = false;

// File name / label text — always theme-coloured (never inherits black).
const nameText = (name: string, muted = false) => BUI.html`
  <span
    style="
      flex: 1 1 auto; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: ${muted
        ? "var(--bim-ui_bg-contrast-80, #c9c9c9)"
        : "var(--bim-ui_bg-contrast-100, #e3e3e3)"};
    "
  >${name}<bim-tooltip>${name}</bim-tooltip></span>
`;

// Visual loading bar fed by the polled conversion %.
const progressBar = (job: Job) => {
  const pct = Math.max(0, Math.min(100, Math.round(job.progress)));
  return BUI.html`
    <span style="display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap;">
      <span style="color: var(--bim-ui_bg-contrast-80, #c9c9c9); font-size: 0.68rem;">Processing…</span>
      <span
        title=${`${job.label}…`}
        style="
          position: relative; display: inline-block; width: 4rem; height: 0.4rem;
          border-radius: 0.2rem; overflow: hidden;
          background: var(--bim-ui_bg-contrast-40, rgba(255, 255, 255, 0.14));
        "
      >
        <span
          style="
            position: absolute; left: 0; top: 0; bottom: 0; width: ${pct}%;
            background: var(--bim-ui_accent-base);
            transition: width 0.3s ease;
          "
        ></span>
      </span>
      <span
        style="
          color: var(--bim-ui_bg-contrast-80, #c9c9c9);
          font-size: 0.7rem; font-variant-numeric: tabular-nums;
        "
      >${pct}%</span>
    </span>
  `;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const filesPanel = (components: OBC.Components, client: any) => {
  const fragments = components.get(OBC.FragmentsManager);
  const projectId: string | undefined = client?.context?.projectId;

  // Reality-capture (.3tz point cloud / gaussian splat) viewer — opened from a
  // .3tz row's "View" action. LAZY-imported on first click: the module spins up
  // decode workers at load, so importing it eagerly crashes app startup; the
  // dynamic import keeps it off the boot path. Self-contained fullscreen overlay
  // with an isolated WebGLRenderer (zero interaction with the pen/MRT world).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rcViewer: any = null;
  const openThreeTZ = async (fileId: string) => {
    try {
      if (!rcViewer) {
        const { realityCaptureViewer } = await import("./reality-capture-viewer");
        rcViewer = realityCaptureViewer(components, client);
      }
      await rcViewer.loadThreeTZ(fileId);
    } catch (error) {
      console.error("[files] failed to open .3tz viewer", error);
    }
  };

  // "View in model": load the reality-capture dataset INTO the BIM world's scene
  // (co-located with the .frag models, one shared camera) via loadIntoWorld —
  // instead of the standalone fullscreen overlay. Same lazy-imported rcViewer (it
  // reaches the world via the components it was constructed with).
  const openInModel = async (fileId: string) => {
    try {
      if (!rcViewer) {
        const { realityCaptureViewer } = await import("./reality-capture-viewer");
        rcViewer = realityCaptureViewer(components, client);
      }
      // Persisted alignment: if we've saved a gizmo transform for this dataset,
      // restore it (RC skips the auto-fit when `transform` is supplied); otherwise
      // RC auto-fits to the world origin. Either way `onTransformChange` fires (on
      // gizmo release AND the initial auto-fit), so we save the matrix to app-data
      // → the dataset reopens exactly where the user last aligned it.
      const saved = appData.alignments[fileId];
      // Phase 1 by default: keep postproduction (PEN look) AND occlude the
      // splats behind BIM via W3's depth hook (occlusion confirmed correct).
      await rcViewer.loadIntoWorld(fileId, {
        keepPostproduction: true,
        transform: saved ? new THREE.Matrix4().fromArray(saved) : undefined,
        onTransformChange: (m: THREE.Matrix4) => {
          appData.alignments[fileId] = m.toArray();
          void saveAppData();
        },
      });
    } catch (error) {
      console.error("[files] failed to load reality-capture into model", error);
    }
  };

  let converterId: string | null = null;
  let converterVersionTag: string | null = null; // latest converter version to run
  let current: FilesState = {
    loading: true,
    note: "",
    files: [],
    jobs: {},
    confirmDelete: null,
    loaded: [],
    loadedByIfc: {},
    fragOf: {},
    loadingModels: [],
    uploads: [],
    knownFrags: {},
    associating: null,
    attachOptions: [],
    attachLoading: false,
    filter: "",
  };

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // fragIds with a load/unload currently in progress. Guards against spamming
  // Add/Remove: a second op on the same model is ignored until the first settles,
  // so we never dispose a model mid-load or double-load/double-dispose.
  const inFlight = new Set<string>();

  // ── Project app-data (the source of truth for ifc↔frag links) ──
  // The platform has no project-scoped HIDDEN-file API (hidden files attach to a
  // parent item; createFile is FILE-only). So we persist a regular project file
  // with a dotted name. It never renders in this panel (filtered out by name),
  // though it can still appear in the platform's global file browser.
  const APPDATA_NAME = ".bim-viewer-appdata.json";
  let appData: {
    associations: Record<string, string>;
    loadedModels: string[];
    pending: Record<string, { executionId: string; startedAt: number }>;
    detached: string[];
    alignments: Record<string, number[]>;
  } = {
    associations: {}, // ifcFileId → fragFileId
    loadedModels: [], // modelIds last present in the scene
    pending: {}, // ifcFileId → in-flight conversion execution (survives reload)
    // IFCs the user has MANUALLY detached. The converter's `fragmentsFileId` stays
    // stamped on the IFC metadata forever, so without this, bootstrapFromMetadata
    // would re-link a detached IFC on the next reload. This makes detach stick.
    detached: [],
    // reality-capture fileId → 16-float local→world matrix: the "View in model"
    // gizmo alignment, persisted so a splat dataset reopens at its saved position.
    alignments: {},
  };
  let appDataFileId: string | null = null;
  let appDataLoaded = false;

  // First/only world (created by viewports-manager before this panel mounts).
  // Used to put loaded models into the scene and to frame the camera.
  const worlds = components.get(OBC.Worlds);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getWorld = () => [...worlds.list.values()][0] as any;

  // Hidden file picker, triggered by the Upload button.
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".ifc,.frag";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  document.body.append(fileInput);

  // Trash icon → inline "Delete?" confirm → archive. Renders from `state` so it
  // always reflects the latest confirm target.
  const deleteControls = (state: FilesState, file: FileEntry) =>
    state.confirmDelete === file.id
      ? BUI.html`
          <span style="color: var(--bim-ui_bg-contrast-80, #c9c9c9); font-size: 0.72rem; white-space: nowrap;">Delete?</span>
          <bim-button icon="mdi:check" @click=${() => removeFile(file.id)}></bim-button>
          <bim-button icon="mdi:close" @click=${() => apply({ confirmDelete: null })}></bim-button>`
      : BUI.html`<bim-button
          icon="mdi:trash-can-outline"
          @click=${() => apply({ confirmDelete: file.id })}
        ></bim-button>`;

  // A `.frag` row. `nested` = shown indented under its source IFC.
  const fragRow = (state: FilesState, file: FileEntry, nested: boolean) => BUI.html`
    <div
      style="
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.35rem 0.75rem 0.35rem ${nested ? "2.15rem" : "0.75rem"};
        font-size: 0.78rem; line-height: 1.3;
        ${nested ? "" : `border-bottom: ${BORDER};`}
      "
    >
      ${nested
        ? BUI.html`<span style="color: var(--bim-ui_bg-contrast-60, #9a9a9a); flex-shrink: 0;">↳</span>`
        : null}
      ${formatGlyph(file.ext)}
      ${nameText(file.name, nested)}
      <span style="display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
        ${state.loaded.includes(file.id)
          ? BUI.html`<bim-button
              icon="mdi:eye-off-outline"
              ?loading=${state.loadingModels.includes(file.id)}
              @click=${() => unloadFrag(file.id)}
            ><bim-tooltip>Remove from scene</bim-tooltip></bim-button>`
          : BUI.html`<bim-button
              icon="mdi:eye-outline"
              ?loading=${state.loadingModels.includes(file.id)}
              @click=${() => loadFrag(file.id)}
            ><bim-tooltip>Add to scene</bim-tooltip></bim-button>`}
        ${deleteControls(state, file)}
      </span>
    </div>
  `;

  // A reality-capture 3D Tiles row (root `*.tileset.json`). Always top-level.
  // Two actions: "View" opens the dataset in a standalone fullscreen overlay
  // (loadThreeTZ); "View in model" loads it INTO the BIM world's scene, co-located
  // with the .frag models under one shared camera (loadIntoWorld). Both fetch the
  // root tileset and stream the hidden tile children on demand.
  const tilesRow = (state: FilesState, file: FileEntry) => BUI.html`
    <div
      style="
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.35rem 0.75rem; font-size: 0.78rem; line-height: 1.3;
        border-bottom: ${BORDER};
      "
    >
      ${formatGlyph(file.ext)}
      ${nameText(file.name)}
      <span style="display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
        <bim-button
          icon="mdi:eye-outline"
          label="View"
          @click=${() => void openThreeTZ(String(file.id))}
        ></bim-button>
        <bim-button
          icon="mdi:cube-scan"
          label="View in model"
          @click=${() => void openInModel(String(file.id))}
        ></bim-button>
        ${deleteControls(state, file)}
      </span>
    </div>
  `;

  // The inline frag-attach picker, shown under an IFC row when its clip is
  // clicked. Candidates are gathered from every IFC's metadata + standalone frag
  // files (converter output is hidden, so it isn't in the file list) — see
  // loadAttachOptions. A flat, indented section that reads as part of the row.
  const attachPicker = (state: FilesState, file: FileEntry) => {
    const hasFrag = !!state.fragOf[file.id];
    const opts = state.attachOptions;
    return BUI.html`
      <div class="attach-picker">
        <span class="attach-label">Attach a fragments file</span>
        ${state.attachLoading
          ? BUI.html`<span class="attach-empty">Finding fragments…</span>`
          : opts.length === 0
            ? BUI.html`<span class="attach-empty">No unattached fragments found in this project.</span>`
            : BUI.html`<div class="files-scroll attach-list">
                ${opts.map((o) => {
                  const sel = state.fragOf[file.id] === o.fragId;
                  return BUI.html`<div
                    class="frag-opt${sel ? " sel" : ""}"
                    @click=${() => (sel ? undefined : associate(file.id, o.fragId))}
                  >
                    ${formatGlyph("frag")}
                    <span class="lbl">${o.label}</span>
                    ${sel
                      ? BUI.html`<bim-icon class="frag-opt-check" icon="mdi:check-circle"></bim-icon>`
                      : null}
                  </div>`;
                })}
              </div>`}
        <div class="attach-actions">
          ${hasFrag
            ? BUI.html`<span class="attach-act" @click=${() => detach(file.id)}>
                <bim-icon icon="mdi:link-variant-off"></bim-icon>Detach
              </span>`
            : null}
          <span class="attach-act" @click=${() => apply({ associating: null })}>
            <bim-icon icon="mdi:close"></bim-icon>Close
          </span>
        </div>
      </div>
    `;
  };

  // An IFC row (one row per IFC — the .frag is NOT shown separately). A clip
  // toggle is ALWAYS shown: dim when no frag is attached, bright when one is;
  // clicking it opens the attach picker. The action is Add (convert-if-needed,
  // then load) ↔ Remove, with a progress bar while converting.
  const ifcRow = (state: FilesState, file: FileEntry) => {
    const job = state.jobs[file.id];
    const fragId = state.fragOf[file.id]; // from the app-data associations
    const hasFrag = !!fragId;
    const fragName =
      state.files.find((f) => f.id === fragId)?.name ?? "Fragments attached";
    // "Loaded" must reflect the CURRENTLY associated frag — not merely that some
    // (possibly stale) frag for this IFC is in the scene. If a different frag is
    // loaded for this IFC, the row stays on "Add" so a click loads the new one.
    const loaded = !!fragId && state.loadedByIfc[file.id] === fragId;
    const picking = state.associating === file.id;
    return BUI.html`
      <div style="display: flex; flex-direction: column; padding: 0.4rem 0.75rem; border-bottom: ${BORDER};">
        <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; line-height: 1.3;">
          ${formatGlyph(file.ext)}
          ${nameText(file.name)}
          <span
            class="file-clip"
            @click=${() => openAttach(file)}
            style="position: relative; display: inline-flex; align-items: center; flex-shrink: 0; cursor: pointer;"
          ><bim-icon
            icon=${hasFrag ? "mdi:paperclip" : "mdi:paperclip-plus"}
            style="color: #99a0ae;"
          ></bim-icon><bim-tooltip>${hasFrag ? fragName : "Attach a fragments file"}</bim-tooltip></span>
          <span style="display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
            ${job
              ? progressBar(job)
              : loaded
                ? BUI.html`<bim-button
                    icon="mdi:eye-off-outline"
                    ?loading=${!!fragId && state.loadingModels.includes(fragId)}
                    @click=${() => unloadFrag(fragId!, file.id)}
                  ><bim-tooltip>Remove from scene</bim-tooltip></bim-button>`
                : BUI.html`<bim-button
                    icon="mdi:eye-outline"
                    ?loading=${!!fragId && state.loadingModels.includes(fragId)}
                    @click=${() => addToScene(file)}
                  ><bim-tooltip>Add to scene</bim-tooltip></bim-button>`}
            ${deleteControls(state, file)}
          </span>
        </div>
        ${picking ? attachPicker(state, file) : null}
      </div>
    `;
  };

  // Optimistic row for a file that's still uploading (shown the instant it's
  // picked). No real % is available from createFile, so the bar is indeterminate.
  const uploadRow = (entry: UploadEntry) => BUI.html`
    <div
      style="
        display: flex; align-items: center; gap: 0.5rem;
        padding: 0.4rem 0.75rem; font-size: 0.8rem; line-height: 1.3;
        border-bottom: ${BORDER};
      "
    >
      ${formatGlyph(entry.ext)}
      ${nameText(entry.name)}
      <span style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
        <span style="color: var(--bim-ui_bg-contrast-80, #c9c9c9); font-size: 0.68rem;">Uploading…</span>
        <span class="indet-track"><span class="indet-fill"></span></span>
      </span>
    </div>
  `;

  // Top-level list: every IFC, plus any standalone `.frag` with no source IFC.
  const renderList = (state: FilesState) => {
    const ifcs = state.files.filter((f) => f.ext === "ifc");
    const frags = state.files.filter((f) => f.ext === "frag");
    // Reality-capture 3D Tiles — always standalone top-level rows (no IFC
    // source). The loose-tiles viewer opens the ROOT `*.tileset.json` (tiles are
    // hidden `.spz`/`.pnts` children, streamed on demand). Match the full
    // `.tileset.json` suffix — NOT `ext === "json"`, which would catch app-data
    // and every other JSON. The old `.3tz` zip format is no longer viewable here
    // (the loose-tiles viewer has no unzip path), so it gets no row/View action.
    const tiles = state.files.filter((f) =>
      f.name.toLowerCase().endsWith(".tileset.json"),
    );
    // A frag is "linked" if some IFC's metadata points to it; those are
    // represented by their IFC row, not a standalone row.
    const linked = new Set(Object.values(state.fragOf));
    const standalone = frags.filter((f) => !linked.has(f.id));
    // ORPHAN frags: reachable via IFC metadata but NOT present as a listFiles row
    // (old-converter output with no projectId, hidden-file output, or listFiles
    // lag). Once unlinked, they'd otherwise be invisible — so surface them here as
    // standalone rows. This is what makes the "a detached frag can never become
    // unreachable" guarantee hold even when the frag isn't a listable file.
    const listedIds = new Set(state.files.map((f) => f.id));
    const orphans: FileEntry[] = Object.entries(state.knownFrags)
      .filter(([fid]) => !linked.has(fid) && !listedIds.has(fid))
      .map(([fid, info]) => {
        const name = info.name || "fragments.frag";
        return {
          id: fid,
          name,
          ext: "frag",
          base: name.replace(/\.[^.]+$/, ""),
        };
      });
    const all = [
      ...ifcs.map((f) => ({ kind: "ifc" as const, file: f })),
      ...standalone.map((f) => ({ kind: "frag" as const, file: f })),
      ...orphans.map((f) => ({ kind: "frag" as const, file: f })),
      ...tiles.map((f) => ({ kind: "3tz" as const, file: f })),
    ].sort((a, b) => a.file.name.localeCompare(b.file.name));
    const q = state.filter.trim().toLowerCase();
    const top = q
      ? all.filter((e) => e.file.name.toLowerCase().includes(q))
      : all;
    return BUI.html`
      <div style="display: flex; flex-direction: column; border-top: ${BORDER};">
        ${state.uploads.map((u) => uploadRow(u))}
        ${top.map((entry) =>
          entry.kind === "ifc"
            ? ifcRow(state, entry.file)
            : entry.kind === "3tz"
              ? tilesRow(state, entry.file)
              : fragRow(state, entry.file, false),
        )}
        ${top.length === 0 && all.length > 0
          ? BUI.html`<div style="padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--bim-ui_bg-contrast-70, #9a9a9a);">No files match "${state.filter}".</div>`
          : null}
      </div>
    `;
  };

  // ── Assets coordination settings (increment c) ────────────────
  // Base-model + .frag auto-coordinate, wired to W3's FragmentsManager API
  // (setBaseModel / setAutoCoordinate / coordinate). Cast `as any` — these are
  // new lib methods not yet in the copied dist's types (bounce on wire).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frg = fragments as any;
  let autoCoordOn = true; // global UX: all models use their embedded placement (default)
  const baseModelId = (): string => String(frg.baseCoordinationModel ?? "");
  const modelLabel = (st: FilesState, id: string): string =>
    st.files.find((f) => f.id === id)?.name ?? id;

  const [panel, update] = BUI.Component.create<BUI.Panel, FilesState>(
    (state) => BUI.html`
      <bim-panel
        label="Project Files"
        icon="mdi:folder-multiple-outline"
        header-hidden
        style="width: 20rem; height: 100%; pointer-events: auto;"
      >
        <style>
          .files-scroll::-webkit-scrollbar { width: 0.4rem; height: 0.4rem; }
          .files-scroll::-webkit-scrollbar-thumb {
            border-radius: 0.25rem;
            background-color: var(--bim-scrollbar--c, #3C3C41);
          }
          .files-scroll::-webkit-scrollbar-track {
            background-color: var(--bim-scrollbar--bgc, var(--bim-ui_bg-contrast-10));
          }
          /* Indeterminate upload bar (createFile gives no real %). */
          .indet-track {
            position: relative; display: inline-block;
            width: 4rem; height: 0.4rem; border-radius: 0.2rem; overflow: hidden;
            background: var(--bim-ui_bg-contrast-40, rgba(255, 255, 255, 0.14));
          }
          .indet-fill {
            position: absolute; top: 0; bottom: 0; left: 0; width: 40%;
            border-radius: 0.2rem; background: var(--bim-ui_accent-base);
            animation: indet 1.1s ease-in-out infinite;
          }
          @keyframes indet { 0% { left: -40%; } 100% { left: 100%; } }
          /* Frag-attach picker — compact rows styled like the model tree. */
          .attach-picker {
            display: flex; flex-direction: column; gap: 0.15rem;
            margin: 0.35rem 0 0.1rem 0.4rem; padding-left: 0.6rem;
            border-left: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
          }
          .attach-label {
            font-size: 0.68rem; letter-spacing: 0.02em;
            color: var(--bim-ui_bg-contrast-70, #9a9a9a); padding: 0.1rem 0 0.15rem;
          }
          .attach-empty { font-size: 0.72rem; color: var(--bim-ui_bg-contrast-70, #9a9a9a); padding: 0.1rem 0 0.2rem; }
          .attach-list { display: flex; flex-direction: column; max-height: 11rem; overflow-y: auto; padding-right: 0.2rem; }
          .frag-opt {
            display: flex; align-items: center; gap: 0.4rem;
            height: 1.55rem; padding: 0 0.45rem; border-radius: 0.25rem;
            font-size: 0.72rem; color: var(--bim-ui_bg-contrast-100, #e3e3e3);
            cursor: pointer; user-select: none;
          }
          .frag-opt:hover { background: var(--bim-ui_bg-contrast-20); }
          .frag-opt.sel { background: var(--bim-ui_bg-contrast-20); }
          .frag-opt bim-icon { flex: 0 0 auto; font-size: 0.85rem; color: #99a0ae; }
          .frag-opt.sel bim-icon { color: var(--bim-ui_accent-base); }
          .frag-opt .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
          .frag-opt bim-icon.frag-opt-check { flex: 0 0 auto; color: var(--bim-ui_bg-contrast-80); }
          .frag-attached { flex: 0 0 auto; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--bim-ui_accent-base); opacity: 0.9; }
          .frag-opt.sel { cursor: default; }
          .attach-actions { display: flex; gap: 0.9rem; padding: 0.2rem 0 0.1rem 0.1rem; }
          .attach-act {
            display: inline-flex; align-items: center; gap: 0.25rem;
            font-size: 0.7rem; color: var(--bim-ui_bg-contrast-70, #9a9a9a);
            cursor: pointer; user-select: none;
          }
          .attach-act:hover { color: var(--bim-ui_bg-contrast-100, #e3e3e3); }
          .attach-act bim-icon { font-size: 0.8rem; }
          /* Row action buttons (Add/Remove, clip, trash, confirm): no background
             until hovered, then a subtle gray (override the button's purple
             ripple to a neutral). */
          .files-scroll bim-button {
            /* Muted icon at rest (matches the tree's focus button), brightens on hover. */
          }
          .file-clip {
            padding: 0.2rem; border-radius: var(--bim-ui_size-4xs, 4px);
            transition: background 0.12s ease;
          }
          .file-clip:hover { background: var(--bim-ui_bg-contrast-20); }
          /* Assets coordination settings (base model + auto-coordinate). */
          .as-settings {
            display: flex; flex-direction: column; gap: 0.4rem;
            padding: 0.55rem 0.75rem; flex: 0 0 auto;
            border-bottom: 1px solid var(--bim-ui_bg-contrast-20, rgba(255,255,255,0.1));
          }
          .as-row { display: flex; align-items: center; gap: 0.5rem; }
          .as-toggle { cursor: pointer; justify-content: space-between; }
          .as-lbl { font-size: 0.72rem; white-space: nowrap;
            color: var(--bim-ui_bg-contrast-80, #c9c9c9); }
        </style>
        <!-- Outer column: NO overflow. Header fixed; only the file list scrolls
             (inset inner region), matching the tree + properties cards. -->
        <div style="display: flex; flex-direction: column; height: 100%;">
          ${cardHeader("mdi:folder-multiple-outline", "Project Files", "1.1rem")}
          <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;">
            <!-- Assets coordination settings (base model + .frag auto-coordinate),
                 shown only once a model is loaded. -->
            ${fragments.list.size > 0
              ? BUI.html`<div class="as-settings">
                  <div class="as-row">
                    <span class="as-lbl">Base model</span>
                    <bim-dropdown
                      style="flex: 1 1 auto; min-width: 0;"
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const v = (e.target as any).value?.[0];
                        if (v) void onBaseChange(String(v));
                      }}
                    >
                      ${[...fragments.list.keys()].map(
                        (id) => BUI.html`<bim-option .value=${id} label=${modelLabel(state, id)} ?checked=${id === baseModelId()}></bim-option>`,
                      )}
                    </bim-dropdown>
                  </div>
                  <label class="as-row as-toggle">
                    <span class="as-lbl">Auto-coordinate (.frag placement)</span>
                    <bim-checkbox
                      toggle
                      ?checked=${autoCoordOn}
                      @change=${(e: Event) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        void onAutoCoord(!!(e.target as any).checked);
                      }}
                    ></bim-checkbox>
                  </label>
                </div>`
              : null}
            <!-- Fixed bits: filter searchbar + icon upload + note. -->
            <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.6rem 0.75rem 0.5rem; flex: 0 0 auto;">
              <div style="display: flex; align-items: stretch; gap: 0.4rem;">
                <bim-text-input
                  icon="mdi:magnify"
                  icon-inside
                  placeholder="Filter files…"
                  .value=${state.filter}
                  style="flex: 1 1 auto;"
                  @input=${(e: Event) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    apply({ filter: String((e.target as any).value ?? "") });
                  }}
                ></bim-text-input>
                <bim-button
                  icon="mdi:upload"
                  style="flex: 0 0 auto;"
                  @click=${() => fileInput.click()}
                ><bim-tooltip>Upload file</bim-tooltip></bim-button>
              </div>
              ${state.note
                ? BUI.html`<bim-label style="opacity: 0.7; white-space: normal;">${state.note}</bim-label>`
                : null}
            </div>
            <!-- Scrolling region: the file list. -->
            <div
              class="files-scroll"
              style="flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 0 0.6rem;"
            >
              ${state.loading
                ? BUI.html`<bim-label style="opacity: 0.6;">Loading…</bim-label>`
                : state.files.length === 0
                  ? BUI.html`<div style="
                      display: flex; flex-direction: column; align-items: center; justify-content: center;
                      gap: 0.75rem; height: 100%; min-height: 12rem; padding: 1rem; text-align: center;
                    ">
                      <img src=${toolPlaceholderUri} alt="" style="width: 7.5rem; height: auto; opacity: 0.9;" />
                      <bim-label style="opacity: 0.55; white-space: normal;">No files yet. Upload an IFC to convert it.</bim-label>
                    </div>`
                  : renderList(state)}
            </div>
          </div>
        </div>
      </bim-panel>
    `,
    current,
  );

  const apply = (partial: Partial<FilesState>) => {
    current = update(partial);
  };

  // ── Assets coordination handlers (increment c) ─────────────────
  // Re-coordination can shift models a LOT (geo-referenced CRS coords) → re-fit
  // the camera to the new union bounds so the model never jumps off-screen.
  const refitCamera = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = [...worlds.list.values()][0] as any;
    const controls = world?.camera?.controls;
    if (!controls?.fitToSphere) return;
    const box = new THREE.Box3();
    for (const [, m] of fragments.list) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (m as any).box as THREE.Box3 | undefined;
      if (b && !b.isEmpty()) box.union(b);
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    try {
      await controls.fitToSphere(sphere, true);
    } catch (error) {
      console.warn("[files-panel] re-fit after coordinate failed", error);
    }
  };
  const onBaseChange = async (modelId: string) => {
    if (fragments.list.size === 0 || !modelId) return; // guard per W3
    try {
      await frg.setBaseModel(modelId); // re-coordinates the rest to it (async, self-updates)
    } catch (error) {
      console.warn("[files-panel] setBaseModel failed", error);
    }
    await refitCamera();
    apply({}); // reflect the new base in the dropdown
  };
  const onAutoCoord = async (on: boolean) => {
    autoCoordOn = on;
    // Apply to ALL loaded models (global toggle): on = embedded placement aligned
    // to base; off = each parked at three-space origin.
    for (const id of fragments.list.keys()) {
      try {
        await frg.setAutoCoordinate(id, on);
      } catch (error) {
        console.warn("[files-panel] setAutoCoordinate failed", id, error);
      }
    }
    await refitCamera();
    apply({});
  };

  // ── Scene wiring + reactive loaded-state ───────────────────────
  // `fragments.core.load` only adds a model to `fragments.list`; it does NOT put
  // it in the scene. The model must be added to the world scene and told which
  // camera to use for culling/LOD. This wiring used to live with the (now
  // removed) hardcoded model — its absence is why "Add" loaded nothing visible.
  // Subscribing to the list also keeps the Add/Remove buttons in sync with the
  // actual scene, even if a model is added/removed elsewhere.
  const syncLoaded = () => {
    const loaded = [...fragments.list.keys()];
    // Drop any ifc→fragId mapping whose model is no longer in the scene (it may
    // have been disposed elsewhere), so the IFC row falls back to "Add".
    const inScene = new Set(loaded);
    const loadedByIfc = Object.fromEntries(
      Object.entries(current.loadedByIfc).filter(([, fid]) => inScene.has(fid)),
    );
    apply({ loaded, loadedByIfc });
  };

  // Keep the Add/Remove buttons in sync with the scene. We deliberately do NOT
  // wire the model into the scene here: onItemSet fires while fragments.core.load
  // is still registering the model in the worker, so driving
  // useCamera/scene.add/update(true) now addresses a model the worker doesn't
  // have yet → "Model not found". loadFrag does that wiring AFTER load resolves.
  fragments.list.onItemSet.add(() => syncLoaded());

  fragments.list.onItemDeleted.add((event) => {
    // disposeModel removes it from the list; defensively detach the object from
    // the scene too so Remove always clears it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event as any)?.value?.object?.removeFromParent?.();
    fragments.core.update(true);
    syncLoaded();
  });

  // ── Data ───────────────────────────────────────────────────────
  async function resolveConverter() {
    try {
      const comps = await client.listComponents({ projectId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const match =
        comps.find(
          (c: any) => /ifc/i.test(c.name) && /(frag|convert)/i.test(c.name),
        ) ?? comps.find((c: any) => /ifc/i.test(c.name));
      converterId = match?._id ? String(match._id) : null;
      if (!converterId) {
        apply({ note: "IFC→fragments component not found in this project." });
        return;
      }
      // Resolve the LATEST version so we don't run pinned v1 (old converter).
      // The platform returns versions newest-FIRST, so index-based picking is
      // unsafe. Sort by createdAt desc; fall back to the highest numeric tag.
      try {
        const comp = await client.getComponent(converterId, { showVersions: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const versions: any[] = comp?.versions ?? [];
        const tagNum = (t: unknown) => {
          const m = /(\d+)/.exec(String(t ?? ""));
          return m ? parseInt(m[1], 10) : -1;
        };
        const newest = versions.slice().sort((a, b) => {
          const ta = a?.createdAt ? new Date(a.createdAt).getTime() : NaN;
          const tb = b?.createdAt ? new Date(b.createdAt).getTime() : NaN;
          if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta; // newest first
          return tagNum(b?.tag) - tagNum(a?.tag); // fallback: highest tag first
        })[0];
        converterVersionTag = newest ? String(newest.tag) : null;
      } catch (verError) {
        console.warn("[files-panel] could not read converter versions", verError);
      }
    } catch (error) {
      console.warn("[files-panel] listComponents failed", error);
    }
  }

  async function loadFiles(opts: { silent?: boolean } = {}) {
    if (!projectId) {
      apply({ loading: false, note: "No project context." });
      return;
    }
    if (!opts.silent) apply({ loading: true });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (await client.listFiles({ projectId })) as any[];
      const files: FileEntry[] = items
        .map((it) => {
          const name: string = it.name ?? "file";
          // Use `||` not `??`: converter-created files come back with
          // `fileExtension: ""` (empty string, not null), which `??` would keep
          // — leaving a `.frag` mis-typed as "" and invisible everywhere.
          const ext = (it.fileExtension || name.split(".").pop() || "")
            .toString()
            .toLowerCase();
          return { id: String(it._id), name, ext, base: name.replace(/\.[^.]+$/, "") };
        })
        .filter((f) => f.name !== APPDATA_NAME) // never surface the app-data store
        .sort((a, b) => a.name.localeCompare(b.name));
      apply({ loading: false, files, note: current.note });
      // The app-data JSON is the source of truth for ifc↔frag links.
      await syncAppData(items, files);
      // Build the metadata-reachable frag index (safety net for the data-loss
      // guarantee). Independent of listFiles, so a detached frag never vanishes.
      await discoverKnownFrags(files);
      // If the attach picker is open, refresh its candidate frags so a newly
      // generated/converted model appears without closing & reopening it.
      if (current.associating) {
        const openIfc = current.files.find((f) => f.id === current.associating);
        if (openIfc) loadAttachOptions(openIfc);
      }
    } catch (error) {
      apply({ loading: false, note: `Could not list files: ${error}` });
    }
  }

  // Cache of resolved IFC→frag links. A frag link is stable once known, so we
  // never re-hit the backend for an IFC we've already resolved — this (plus the
  // concurrency cap below) stops discoverKnownFrags from bursting getFile/
  // getFileVersionMetadata across every IFC on every refresh and tripping the API
  // rate limiter (429). IFCs with no link yet are NOT cached, so a pending
  // conversion is still re-checked on later refreshes.
  const fragIdCache = new Map<string, string>();

  // Run an async op over items with a small concurrency cap (instead of
  // Promise.all firing all at once) — keeps request bursts under the rate limit.
  async function mapLimit<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let i = 0;
    const run = async () => {
      while (i < items.length) await fn(items[i++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  }

  // Read an IFC's version metadata and return its linked fragments fileId, or
  // null. The converter stamps `{ fragmentsFileId, conversionStatus }` on the
  // IFC's version. Version tag defaults to "v1" (how uploads are tagged) but we
  // resolve the file's latest tag to be safe. Cached once resolved (see above).
  async function ifcFragId(ifc: FileEntry): Promise<string | null> {
    const cached = fragIdCache.get(ifc.id);
    if (cached) return cached;
    let tag = "v1";
    try {
      const file = await client.getFile(ifc.id, { showVersions: true });
      const versions = file?.versions ?? [];
      if (versions.length) tag = String(versions[versions.length - 1].tag);
    } catch {
      /* fall back to v1 */
    }
    try {
      const meta = await client.getFileVersionMetadata(ifc.id, tag);
      const fragId = meta?.fragmentsFileId;
      if (fragId && meta?.conversionStatus !== "error") {
        fragIdCache.set(ifc.id, String(fragId));
        return String(fragId);
      }
    } catch (error) {
      console.warn("[files-panel] getFileVersionMetadata failed", ifc.id, error);
    }
    return null;
  }

  // Discover EVERY frag the app can reach via IFC version metadata and record it
  // in `knownFrags` (fragId → name + owning IFC). This is the safety net that
  // makes the data-loss guarantee hold: a frag reachable from an IFC's metadata
  // is registered here regardless of whether it appears in listFiles, so it can
  // ALWAYS surface — as an orphan standalone row once unlinked, and in the attach
  // picker — even if it was produced by an old converter (no projectId → not
  // listable), lives as a hidden file, or listFiles is lagging. Resolving the
  // frag's display name uses the listFiles row if present, else getFile by id
  // (works for non-listable files), else the IFC basename.
  // Re-entrancy guard: refresh can fire in bursts (onItemSet). Running discovery
  // concurrently with itself multiplies the request load → 429. So coalesce: if a
  // run is in flight, stash the latest files and run exactly once more when it ends.
  let discovering = false;
  let discoverNext: FileEntry[] | null = null;
  async function discoverKnownFrags(files: FileEntry[]) {
    if (discovering) {
      discoverNext = files;
      return;
    }
    discovering = true;
    try {
      const ifcs = files.filter((f) => f.ext === "ifc");
      const byId = new Map(files.map((f) => [f.id, f]));
      const found: Record<string, { name: string; ifcId: string }> = {};
      await mapLimit(ifcs, 3, async (ifc) => {
        const fragId = await ifcFragId(ifc);
        if (!fragId) return;
        let name = byId.get(fragId)?.name ?? "";
        if (!name) {
          try {
            const item = await client.getFile(fragId);
            name = item?.name ?? "";
          } catch {
            /* non-fatal — fall back to a derived name below */
          }
        }
        if (!name) name = `${ifc.base}.frag`;
        found[fragId] = { name, ifcId: ifc.id };
      });
      apply({ knownFrags: found });
    } finally {
      discovering = false;
      const next = discoverNext;
      discoverNext = null;
      if (next) void discoverKnownFrags(next);
    }
  }

  // Persist the app-data JSON (create the store file the first time, then bump a
  // new version on every save). downloadFile returns the latest version.
  async function saveAppData() {
    if (!projectId) return;
    try {
      const blob = new File([JSON.stringify(appData)], APPDATA_NAME, {
        type: "application/json",
      });
      if (appDataFileId) {
        await client.updateFile(appDataFileId, {
          file: blob,
          versionTag: `v${Date.now()}`,
        });
      } else {
        const created = await client.createFile({
          file: blob,
          name: APPDATA_NAME,
          versionTag: "v1",
          projectId,
        });
        appDataFileId = created?.item?._id ? String(created.item._id) : null;
      }
    } catch (error) {
      console.warn("[files-panel] could not save app-data", error);
    }
  }

  // One-time heal: for any IFC with no JSON association, seed it from the IFC's
  // version metadata (the converter also stamps fragmentsFileId there). Covers
  // frags converted before this JSON store existed (e.g. school_str).
  async function bootstrapFromMetadata(files: FileEntry[]) {
    // Skip IFCs the user manually detached — their metadata still points at the
    // frag, but we must NOT silently re-attach it.
    const detached = new Set(appData.detached);
    const ifcs = files.filter(
      (f) => f.ext === "ifc" && !appData.associations[f.id] && !detached.has(f.id),
    );
    let changed = false;
    await Promise.all(
      ifcs.map(async (ifc) => {
        const fragId = await ifcFragId(ifc);
        if (fragId) {
          appData.associations[ifc.id] = fragId;
          changed = true;
        }
      }),
    );
    if (changed) await saveAppData();
  }

  // Load the app-data store (once), heal from it, then push the
  // associations into the UI as the source of truth.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function syncAppData(items: any[], files: FileEntry[]) {
    const adItem = items.find((it) => it?.name === APPDATA_NAME);
    if (adItem) appDataFileId = String(adItem._id);

    if (!appDataLoaded) {
      appDataLoaded = true;
      if (appDataFileId) {
        try {
          const resp = await client.downloadFile(appDataFileId);
          const parsed = JSON.parse(await resp.text());
          appData = {
            associations: parsed?.associations ?? {},
            loadedModels: parsed?.loadedModels ?? [],
            pending: parsed?.pending ?? {},
            detached: parsed?.detached ?? [],
            alignments: parsed?.alignments ?? {},
          };
        } catch (error) {
          console.warn("[files-panel] could not read app-data", error);
        }
      }
      await bootstrapFromMetadata(files);
      // Proactively create the store on first open if it doesn't exist yet
      // (bootstrap only saves when it seeded something). The `adItem` lookup
      // above sets appDataFileId when the file already exists, so on later opens
      // this is skipped — created exactly once, never duplicated.
      if (!appDataFileId) await saveAppData();
      // No scene restore — Antonio adds models manually each session.
      // Resume any conversion that was still running when the viewer last closed.
      await resumePending(files);
    }
    // Drop dangling references for files deleted outside the app (CDE / project
    // settings). Runs on every loadFiles, so it self-heals on open + on refocus.
    await reconcileAppData(items);
    apply({ fragOf: { ...appData.associations } });
  }

  // Prune appData of references to files that no longer exist in the project.
  // Never touches an IFC with an in-flight conversion, and never calls convert().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function reconcileAppData(items: any[]) {
    const existing = new Set(items.map((it) => String(it._id)));
    let changed = false;
    for (const [ifcId, fragId] of Object.entries(appData.associations)) {
      if (current.jobs[ifcId]) continue; // mid-conversion — leave it alone
      if (!existing.has(ifcId) || !existing.has(fragId)) {
        delete appData.associations[ifcId];
        changed = true;
      }
    }
    // Drop pending conversions whose IFC is gone or already linked (unless a job
    // is actively tracking it this session).
    for (const ifcId of Object.keys(appData.pending)) {
      if (current.jobs[ifcId]) continue;
      if (!existing.has(ifcId) || appData.associations[ifcId]) {
        delete appData.pending[ifcId];
        changed = true;
      }
    }
    // loadedModels is vestigial (scene-restore was removed); keep it empty so it
    // can never hold stale ids.
    if (appData.loadedModels.length) {
      appData.loadedModels = [];
      changed = true;
    }
    if (changed) await saveAppData();
  }

  // Poll the IFC metadata until fragmentsFileId appears (backend consistency can
  // lag a beat after the execution reports SUCCESS).
  async function waitForFragId(ifc: FileEntry, tries: number): Promise<string | null> {
    for (let i = 0; i < tries; i += 1) {
      const fragId = await ifcFragId(ifc);
      if (fragId) return fragId;
      await delay(1000);
    }
    return null;
  }

  // Open (or toggle) the attach picker for an IFC and gather candidate frags.
  function openAttach(file: FileEntry) {
    const opening = current.associating !== file.id;
    apply({
      associating: opening ? file.id : null,
      confirmDelete: null,
      attachOptions: [],
      attachLoading: opening,
    });
    if (opening) loadAttachOptions(file);
  }

  // List the fragments files a user could attach: the project's `.frag` files
  // (from listFiles in loadFiles) MINUS any attached to ANOTHER IFC — a frag
  // belongs to a single IFC. This IFC's OWN attached frag is kept in the list
  // (rendered as "Attached") so the user sees what's linked. Labelled by
  // filename. Synchronous over already-loaded state, so it populates immediately.
  function loadAttachOptions(ifc: FileEntry) {
    if (current.associating !== ifc.id) return; // picker closed/changed meanwhile
    const attachedElsewhere = new Set(
      Object.entries(current.fragOf)
        .filter(([ifcId]) => ifcId !== ifc.id)
        .map(([, fragId]) => fragId),
    );
    const attachOptions = current.files
      .filter((f) => f.ext === "frag" && !attachedElsewhere.has(f.id))
      .map((f) => ({ fragId: f.id, label: f.name }));
    apply({ attachOptions, attachLoading: false });
  }

  // Manually link an IFC to an existing fragments file (clip → picker), and the
  // inverse. Persisted in app-data exactly like an auto-converted association.
  async function associate(ifcId: string, fragId: string) {
    appData.associations[ifcId] = fragId;
    // Re-attaching clears any prior manual-detach override for this IFC.
    appData.detached = appData.detached.filter((id) => id !== ifcId);
    await saveAppData();
    apply({ fragOf: { ...appData.associations }, associating: null });
  }
  async function detach(ifcId: string) {
    // The frag this IFC is being detached from = the one that may be in the scene.
    const fragId = appData.associations[ifcId];
    delete appData.associations[ifcId];
    // Remember the detach so bootstrapFromMetadata won't re-link it on reload.
    if (!appData.detached.includes(ifcId)) appData.detached.push(ifcId);
    await saveAppData();
    // Remove that frag from the scene if it's loaded. Models are keyed by fragId,
    // so dispose by fragId directly (covers frags auto-loaded at startup too, not
    // just ones tracked in loadedByIfc).
    if (fragId && fragments.list.has(fragId)) await unloadFrag(fragId, ifcId);
    apply({ fragOf: { ...appData.associations }, associating: null });
  }

  // Run the IFC→fragments converter for `fileId`. Fires only from user actions
  // (upload, or Add on an un-converted IFC) — never on init. After success we
  // poll the IFC metadata for the produced `fragmentsFileId` (so the attachment
  // icon appears); with `opts.addToScene` we also load that frag into the scene.
  async function convert(
    fileId: string,
    label: string,
    opts: { ifc?: FileEntry; addToScene?: boolean } = {},
  ) {
    // The converter may not have resolved yet (listComponents in flight). Try
    // once more before giving up, so a quick upload still converts.
    if (!converterId) await resolveConverter();
    if (!converterId) {
      console.error(
        "[files-panel] no IFC→fragments converter component resolved — cannot convert",
        label,
      );
      apply({ note: "IFC→fragments component not found in this project." });
      return;
    }
    apply({ jobs: { ...current.jobs, [fileId]: { progress: 0, label: "Converting" } } });
    try {
      console.log(
        "[files-panel] executing converter version",
        converterVersionTag ?? "(default/v1)",
      );
      const { executionId } = await client.executeComponent(
        converterId,
        { projectId, fileId },
        converterVersionTag ?? undefined,
      );
      // Persist the in-flight execution so re-entering the viewer can resume it
      // (the poll loop dies with the page; this id lets us re-attach on load).
      appData.pending[fileId] = {
        executionId: String(executionId),
        startedAt: Date.now(),
      };
      await saveAppData();
      trackExecution(fileId, String(executionId), opts);
    } catch (error) {
      console.error("[files-panel] executeComponent failed", error);
      apply({ jobs: omit(current.jobs, fileId), note: `Conversion failed: ${error}` });
    }
  }

  // Poll a converter execution to completion: drive the row's progress bar and,
  // on success, link (and optionally scene-load) the produced fragments file.
  // Shared by a fresh convert() and by resumePending() on viewer entry; always
  // clears the persisted `pending` entry when the execution ends.
  function trackExecution(
    fileId: string,
    executionId: string,
    opts: { ifc?: FileEntry; addToScene?: boolean } = {},
  ) {
    const finish = async (ok: boolean, note?: string, fragIdFromResult?: string) => {
      const hadPending = !!appData.pending[fileId];
      if (hadPending) delete appData.pending[fileId];
      apply({ jobs: omit(current.jobs, fileId), note: note ?? current.note });
      await loadFiles();
      if (ok && opts.ifc) {
        // Prefer the deterministic id from the execution result; fall back to the
        // IFC metadata (pre-reupload converter), polling for consistency.
        let fragId = fragIdFromResult ?? null;
        if (!fragId) fragId = await waitForFragId(opts.ifc, 6);
        if (fragId) {
          appData.associations[opts.ifc.id] = fragId;
          await saveAppData(); // also persists the pending removal above
          apply({ fragOf: { ...appData.associations } });
          if (opts.addToScene) await loadFrag(fragId, opts.ifc.id);
          return;
        }
        console.warn(
          "[files-panel] conversion SUCCESS but no fragmentsFileId (result token nor metadata)",
          opts.ifc.id,
        );
        apply({
          note: "Converted, but couldn't link the fragments file — try Add again.",
        });
      }
      // Error / no-ifc path still needs to persist the cleared pending entry.
      if (hadPending) await saveAppData();
    };

    // Poll execution status until it completes. The realtime WebSocket
    // (onExecutionProgress / socket.io) does not connect from inside the
    // platform's sandboxed iframe, so polling getExecution is the reliable path
    // for progress + result.
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const exec = await client.getExecution(executionId);
        if (typeof exec.progress === "number") {
          apply({
            jobs: {
              ...current.jobs,
              [fileId]: { progress: exec.progress, label: "Converting" },
            },
          });
        }
        if (exec.result) {
          if (exec.result === "ERROR") {
            console.error("[files-panel] conversion ERROR", exec.resultMessage, exec);
            finish(false, `Conversion failed: ${exec.resultMessage ?? "error"}`);
          } else {
            // New converter appends `[fragmentsFileId=<id>]` to resultMessage.
            const m = /fragmentsFileId=([^\]\s]+)/.exec(exec.resultMessage ?? "");
            finish(true, undefined, m?.[1]);
          }
          return;
        }
      } catch (pollError) {
        console.warn("[files-panel] getExecution poll error (transient)", pollError);
      }
      if (attempts < 400) {
        setTimeout(poll, 1500);
      } else {
        finish(false, "Conversion timed out (may still be running on the server).");
      }
    };
    setTimeout(poll, 1200);
  }

  // On viewer entry, re-attach to any conversion that was still running when the
  // viewer last closed (persisted in appData.pending). Entries that already
  // finished while away, or whose IFC is gone, are dropped.
  async function resumePending(files: FileEntry[]) {
    let changed = false;
    for (const [ifcId, info] of Object.entries(appData.pending)) {
      const ifc = files.find((f) => f.id === ifcId);
      if (!ifc || appData.associations[ifcId]) {
        delete appData.pending[ifcId];
        changed = true;
        continue;
      }
      console.log("[files-panel] resuming conversion for", ifc.name, info.executionId);
      apply({ jobs: { ...current.jobs, [ifcId]: { progress: 0, label: "Converting" } } });
      trackExecution(ifcId, info.executionId, { ifc, addToScene: false });
    }
    if (changed) await saveAppData();
  }

  // Add an IFC's model to the scene: load the CURRENTLY associated frag, or
  // convert first (showing the progress bar on the row) and load the result.
  // If a DIFFERENT (stale) frag is already loaded for this IFC — e.g. the user
  // re-associated it — dispose that one first so the scene matches the UI.
  async function addToScene(ifc: FileEntry) {
    const fragId = current.fragOf[ifc.id];
    if (!fragId) {
      convert(ifc.id, ifc.name, { ifc, addToScene: true });
      return;
    }
    const stale = current.loadedByIfc[ifc.id];
    if (stale && stale !== fragId && fragments.list.has(stale)) {
      await unloadFrag(stale, ifc.id);
    }
    await loadFrag(fragId, ifc.id);
  }

  // ADD: download the .frag and load it, keyed by the fragId (so the scene model
  // tracks the actual frag, not the IFC basename — re-association swaps it). The
  // onItemSet handler above puts it in the scene; here we kick off the load and
  // record which frag is loaded for the owning IFC (if any).
  async function loadFrag(fragId: string, ifcId?: string) {
    if (inFlight.has(fragId)) return; // a load/unload is already running — ignore
    if (ifcId) apply({ loadedByIfc: { ...current.loadedByIfc, [ifcId]: fragId } });
    if (fragments.list.has(fragId)) return; // already in the scene
    inFlight.add(fragId);
    apply({ loadingModels: [...current.loadingModels, fragId] }); // Add spinner
    try {
      const response = await client.downloadFile(fragId);
      const buffer = await response.arrayBuffer();
      // Await load so the model is fully registered in the worker BEFORE we
      // address it (useCamera/scene.add/update post worker actions by modelId).
      await fragments.core.load(buffer, { modelId: fragId });
      const model = fragments.list.get(fragId);
      const world = getWorld();
      if (world && model) {
        model.useCamera(world.camera.three);
        world.scene.three.add(model.object);
      }
      await fragments.core.update(true);
      // Camera intentionally left where it is — Antonio adds models manually and
      // doesn't want the view to jump.
    } catch (error) {
      console.error("[files-panel] failed to add model to scene", error);
      apply({ note: `Could not load model: ${error}` });
    } finally {
      inFlight.delete(fragId);
      apply({ loadingModels: current.loadingModels.filter((m) => m !== fragId) });
    }
  }

  // REMOVE: dispose the model — drops it from the scene and from fragments.list
  // (onItemDeleted re-syncs the buttons back to "Add"). Also clears the IFC's
  // loaded-frag record so its row reverts to "Add".
  async function unloadFrag(fragId: string, ifcId?: string) {
    if (inFlight.has(fragId)) return; // a load/unload is already running — ignore
    if (ifcId) {
      const { [ifcId]: _drop, ...rest } = current.loadedByIfc;
      apply({ loadedByIfc: rest });
    }
    if (!fragments.list.has(fragId)) return; // nothing in the scene to dispose
    inFlight.add(fragId);
    apply({ loadingModels: [...current.loadingModels, fragId] }); // Remove spinner
    try {
      // Clear the current selection FIRST. The Highlighter/Outliner hold
      // references to the selected items' geometry; disposing the model out from
      // under them crashes the next render. Clearing the select style drops those
      // refs (and, via the wired onClear, the Outliner's) before disposal.
      try {
        const highlighter = components.get(OBF.Highlighter);
        await highlighter.clear(highlighter.config.selectName);
      } catch {
        /* highlighter not set up / nothing selected — safe to ignore */
      }
      await fragments.core.disposeModel(fragId);
    } catch (error) {
      console.error("[files-panel] disposeModel failed", error);
      apply({ note: `Could not remove model: ${error}` });
    } finally {
      inFlight.delete(fragId);
      apply({ loadingModels: current.loadingModels.filter((m) => m !== fragId) });
    }
  }

  // Soft-delete (archive) — recoverable server-side. Refreshes the list.
  async function removeFile(fileId: string) {
    apply({ confirmDelete: null });
    try {
      // If a frag is being deleted while it's loaded, drop it from the scene too
      // (models are keyed by fragId). reconcileAppData (in loadFiles) then prunes
      // any IFC association pointing at the now-deleted frag.
      if (fragments.list.has(fileId)) await unloadFrag(fileId);
      await client.archiveFile(fileId);
      await loadFiles();
    } catch (error) {
      apply({ note: `Could not delete file: ${error}` });
    }
  }

  fileInput.onchange = async () => {
    const picked = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    if (picked.length === 0 || !projectId) return;
    // Show every picked file INSTANTLY with an "Uploading…" row (optimistic), so
    // there's no wait for the platform upload. If the user closes the app before
    // an upload finishes, that file simply never lands (acceptable).
    const queued = picked.map((file, i) => {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      const base = file.name.replace(/\.[^.]+$/, "");
      return {
        file,
        entry: { tempId: `up-${Date.now()}-${i}`, name: file.name, ext, base },
      };
    });
    apply({ uploads: [...current.uploads, ...queued.map((q) => q.entry)] });

    // Upload in parallel; settle each optimistic row as its upload completes.
    await Promise.all(
      queued.map(async ({ file, entry }) => {
        try {
          const created = await client.createFile({
            file,
            name: file.name,
            versionTag: "v1",
            projectId,
          });
          const newId = String(created?.item?._id ?? "");
          apply({ uploads: current.uploads.filter((u) => u.tempId !== entry.tempId) });
          await loadFiles();
          // Conversion fires ONLY on a fresh upload — never on load/init for
          // pre-existing IFCs. Pass the IFC entry so the attachment icon appears
          // once metadata links the produced frag (not auto-added to the scene).
          if (entry.ext === "ifc" && newId) {
            convert(newId, entry.name, {
              ifc: { id: newId, name: entry.name, ext: "ifc", base: entry.base },
            });
          }
        } catch (error) {
          apply({
            uploads: current.uploads.filter((u) => u.tempId !== entry.tempId),
            note: `Upload failed for ${file.name}: ${error}`,
          });
        }
      }),
    );
  };

  // Catch external (CDE / project-settings) deletions when Antonio returns to
  // the tab — cheap, no tight polling. Silent reload to avoid UI flicker.
  const onRefocus = () => {
    if (document.visibilityState === "visible") loadFiles({ silent: true });
  };
  window.addEventListener("focus", onRefocus);
  document.addEventListener("visibilitychange", onRefocus);
  // The app runs in the platform iframe, so deletions made in the platform's own
  // file browser (a different frame) never fire our focus/visibility events. A
  // modest silent poll reconciles the list with the backend without a reload.
  window.setInterval(() => {
    if (document.visibilityState === "visible") loadFiles({ silent: true });
  }, 8000);

  // TEMP DIAGNOSTIC ─────────────────────────────────────────────────────────
  // Why are some component-created `.frag` files listable project files while
  // others (school_str / BLOXHUB) are discoverable-by-id but absent from the
  // project "Files" overview? This probes the live platform (the shell has no
  // auth) to surface what distinguishes each frag: its projectId / folderId /
  // owner / archived / hidden flags, and whether listFiles({projectId}) returns
  // it. Runs ONCE after the first loadFiles. Search the console for "[frag-diag".
  // Remove this whole block (and the `fragDiagRan` flag) when done.
  async function runFragDiagnostic() {
    if (fragDiagRan) return;
    fragDiagRan = true;
    try {
      // What the project-wide overview uses: listFiles filtered by projectId.
      const listed = (await client.listFiles({ projectId })) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const listedIds = new Set(listed.map((it) => String(it._id)));
      console.log(
        "[frag-diag] listFiles({projectId}) returned",
        listed.length,
        "items:",
        listed.map((it) => ({ id: String(it._id), name: it.name })),
      );

      // For every IFC, resolve its frag id (metadata / app-data) and fetch the
      // frag item directly — getFile works by id even for non-listable files.
      const ifcs = current.files.filter((f) => f.ext === "ifc");
      for (const ifc of ifcs) {
        const fragId =
          appData.associations[ifc.id] ?? (await ifcFragId(ifc)) ?? null;
        if (!fragId) {
          console.log("[frag-diag]", { ifcName: ifc.name, fragId: null, note: "no frag id resolved" });
          continue;
        }
        let item: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          item = await client.getFile(fragId, { showVersions: true });
        } catch (e) {
          console.log("[frag-diag] getFile failed", { ifcName: ifc.name, fragId, error: String(e) });
          continue;
        }
        // Pull whatever distinguishing fields the item actually carries. The
        // exact field names vary by backend, so log the whole item too.
        console.log("[frag-diag]", {
          ifcName: ifc.name,
          fragId,
          fragName: item?.name,
          projectId: item?.projectId,
          folderId: item?.folderId,
          parentItemId: item?.parentItemId ?? item?.parentId ?? item?.parentFileId,
          owningEntity: item?.owningEntity ?? item?.owner ?? item?.createdBy ?? item?.ownerId,
          archived: item?.archived,
          isHidden: item?.isHidden ?? item?.hidden,
          inListFiles: listedIds.has(String(fragId)), // <-- the key signal
        });
        console.log("[frag-diag] full frag item for", ifc.name, item);
      }
    } catch (e) {
      console.warn("[frag-diag] diagnostic failed", e);
    }
  }
  // END TEMP DIAGNOSTIC ──────────────────────────────────────────────────────

  // Kick off
  resolveConverter();
  // TEMP DIAGNOSTIC: run the frag-visibility probe once after the first load.
  loadFiles().then(() => runFragDiagnostic());

  return panel;
};
