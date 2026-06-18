import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";

// 3DTilesRendererJS plugin that renders .ply Gaussian-splat tiles via Spark —
// the proven seam from Antonio's 3d-tiles experiment, kept intact. The point of
// the slice: the SAME streaming foundation (3DTilesRendererJS) drives this splat
// branch and the point-cloud branch as peers, differing only at parseToMesh.
//
// parseToMesh must not be async at the top level (a returned Promise is treated
// as truthy and stops plugin iteration) — return null synchronously for non-ply.
export class SplatTilePlugin {
  name = "SPLAT_TILE_PLUGIN";
  tiles: any = null;

  init(tiles: any) {
    this.tiles = tiles;
  }

  parseToMesh(
    buffer: ArrayBuffer,
    _tile: any,
    extension: string,
    _uri: string,
    signal: AbortSignal
  ) {
    if (extension !== "ply" && extension !== "spz") return null;
    // Spark's SplatMesh sniffs the actual file type (PLY/SPZ/SPLAT/…) from the
    // bytes, so both load the same way.
    return (async () => {
      if (signal.aborted) return null;
      const splatMesh = new SplatMesh({ fileBytes: new Uint8Array(buffer) });
      await splatMesh.initialized;
      if (signal.aborted) {
        splatMesh.dispose();
        return null;
      }
      // Real splat count from the LOADED data — format-agnostic. (A byte probe of
      // the header is fragile: SPZ is gzipped, so reading bytes off the top gives
      // garbage ~2.6e9, which poisons the motion-budget governor's count and makes
      // the Motion-detail slider a no-op.) packedSplats.numSplats is correct for
      // every format.
      splatMesh.userData.splatCount = (splatMesh as any).packedSplats?.numSplats ?? 0;
      return splatMesh as unknown as THREE.Object3D;
    })();
  }

  disposeTile(tile: any) {
    const scene = tile.engineData?.scene;
    if (scene && typeof scene.dispose === "function") scene.dispose();
  }
}
