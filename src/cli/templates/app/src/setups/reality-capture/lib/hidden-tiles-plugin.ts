// 3DTilesRendererJS plugin: serve a STANDARD loose 3D Tiles dataset whose tiles
// are stored as platform HIDDEN files, streamed one-file-per-tile.
//
// Seam: the renderer's `fetchData(url, options)` hook (intercepts BOTH the root
// tileset and every tile content fetch). Point the TilesRenderer at
// `<baseUrl>/tileset.json`; relative content URIs then resolve to
// `<baseUrl>/<relUri>` (e.g. "mem://t/tiles/n12_d3.spz"), which we strip back to
// the dataset-relative path (`relUri`) and look up in the `hiddenFiles` map to
// find the platform hidden-file id to download.
//
// SHARED CONTRACT (matches the converters): the main visible file is a standard
// `tileset.json`; each tile `content.uri` is a relative path under "tiles/".
// tileset.json carries a top-level `hiddenFiles: { "<content.uri>": "<id>" }`
// map. We fetch a tile blob with `client.downloadHiddenFile(id)` -> Response.
//
// Per-tile streaming = one `downloadHiddenFile` per visible tile; the controller's
// Q1 LRU/count-budget governor bounds how many are resident/loading at once.

// Structural type for the platform client: download a normal file by id (the
// tileset main file) and a hidden file by id (each tile). PlatformClient /
// EngineServicesClient satisfy this.
export interface HiddenTilesClient {
  downloadFile(fileId: string, params?: any): Promise<Response>;
  downloadHiddenFile(hiddenId: string): Promise<Response>;
}

export interface HiddenTilesOptions {
  baseUrl: string; // synthetic base the TilesRenderer is pointed at, e.g. "mem://t"
  tilesetBytes: Uint8Array; // the already-downloaded tileset.json bytes
  hiddenFiles: Record<string, string>; // content.uri -> hidden file id
  client: HiddenTilesClient;
}

export class HiddenTilesPlugin {
  name = "HIDDEN_TILES_PLUGIN";
  private baseUrl: string;
  private tilesetBytes: Uint8Array;
  private hiddenFiles: Record<string, string>;
  private client: HiddenTilesClient;

  constructor({ baseUrl, tilesetBytes, hiddenFiles, client }: HiddenTilesOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.tilesetBytes = tilesetBytes;
    this.hiddenFiles = hiddenFiles;
    this.client = client;
  }

  // dataset-relative path for URLs under our synthetic base, else null.
  private rel(url: string): string | null {
    const prefix = this.baseUrl + "/";
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }

  // The renderer fetch hook. Return a Response, or null to let the default fetch
  // run (URLs that aren't under our base).
  async fetchData(url: string, _options: any): Promise<Response | null> {
    const rel = this.rel(url);
    if (rel === null) return null;

    // Root tileset request: serve the bytes we already downloaded.
    if (rel === "tileset.json") {
      // copy out into a standalone ArrayBuffer for the Response
      const b = this.tilesetBytes;
      const ab = (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength
        ? b.buffer
        : b.slice().buffer) as ArrayBuffer;
      return new Response(ab, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Content (tile) request: strip query/fragment, look up the hidden id.
    const relUri = decodeURIComponent(rel.split("?")[0].split("#")[0]);
    const hiddenId = this.hiddenFiles[relUri];
    if (!hiddenId) {
      // not a known tile -> 404 so the renderer treats it as a failed fetch.
      return new Response(null, { status: 404, statusText: "Not Found" });
    }

    const res = await this.client.downloadHiddenFile(hiddenId);
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }
}
