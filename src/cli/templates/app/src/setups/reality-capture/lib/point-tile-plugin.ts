import * as THREE from "three";
import { frame, placeAtAnchor } from "./render-frame";

// ---- decode worker pool -----------------------------------------------------
// Dequantizes node blobs off the main thread (grimoire: worker-zero-copy decode).
//
// INLINE worker: the decode logic is bundled as a source STRING -> Blob -> object
// URL classic worker. NO `new URL("./worker.ts", import.meta.url)` — that breaks
// under esbuild bundling + the platform's sandboxed iframe (Invalid URL). This
// blob-URL form works in every bundler/sandbox (same approach Spark uses).
// Blob: f64 anchor[3] | f32 scale[3] | u32 count | (u16 x,y,z + u8 r,g,b)*count.
const WORKER_SRC = `
self.onmessage = function (e) {
  var id = e.data.id, buffer = e.data.buffer;
  var dv = new DataView(buffer);
  var ax = dv.getFloat64(0, true), ay = dv.getFloat64(8, true), az = dv.getFloat64(16, true);
  var sx = dv.getFloat32(24, true), sy = dv.getFloat32(28, true), sz = dv.getFloat32(32, true);
  var count = dv.getUint32(36, true);
  var positions = new Float32Array(count * 3);
  var colors = new Uint8Array(count * 3);
  var o = 40;
  for (var k = 0; k < count; k++) {
    positions[k * 3] = dv.getUint16(o, true) * sx;
    positions[k * 3 + 1] = dv.getUint16(o + 2, true) * sy;
    positions[k * 3 + 2] = dv.getUint16(o + 4, true) * sz;
    colors[k * 3] = dv.getUint8(o + 6);
    colors[k * 3 + 1] = dv.getUint8(o + 7);
    colors[k * 3 + 2] = dv.getUint8(o + 8);
    o += 9;
  }
  self.postMessage({ id: id, positions: positions, colors: colors, count: count, anchor: [ax, ay, az] }, [positions.buffer, colors.buffer]);
};
`;
let _blobURL: string | null = null;
function workerURL(): string {
  return (_blobURL ??= URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })));
}

type Decoded = { positions: Float32Array; colors: Uint8Array; count: number; anchor: [number, number, number] };
class DecodePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { id: number; buffer: ArrayBuffer; resolve: (d: Decoded) => void }[] = [];
  private pending = new Map<number, (d: Decoded) => void>();
  private nextId = 0;
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(workerURL()); // classic blob worker (no import.meta.url, no module type)
      w.onmessage = (e: MessageEvent<Decoded & { id: number }>) => {
        const r = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        this.idle.push(w);
        r?.(e.data);
        this.drain();
      };
      this.workers.push(w); this.idle.push(w);
    }
  }
  decode(buffer: ArrayBuffer): Promise<Decoded> {
    return new Promise((resolve) => { this.queue.push({ id: this.nextId++, buffer, resolve }); this.drain(); });
  }
  private drain() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!; const job = this.queue.shift()!;
      this.pending.set(job.id, job.resolve);
      w.postMessage({ id: job.id, buffer: job.buffer }, [job.buffer]); // transfer in (zero-copy)
    }
  }
}
// LAZY: workers are created on the FIRST decode (a points tile), never at module
// load — so merely importing this module (e.g. for the splat path) spins up nothing.
let _pool: DecodePool | null = null;
function getPool(): DecodePool {
  return (_pool ??= new DecodePool(Math.min(16, Math.max(3, (navigator.hardwareConcurrency || 4) - 1))));
}
export function decodeStats() {
  const p = _pool as any;
  return p ? { workers: p.workers.length, idle: p.idle.length, queued: p.queue.length, pending: p.pending.size }
           : { workers: 0, idle: 0, queued: 0, pending: 0 };
}

// 3DTilesRendererJS plugin: decodes our quantized point-node format into a
// node-local THREE.Points, tagged with its float64 world anchor for RTC.
//
// Node blob (sliced out of cloud.bin by byte range):
//   header: f64 anchor[3] | f32 scale[3] | u32 count   (40 B)
//   body:   per point u16 x,y,z + u8 r,g,b              (9 B)
// Decoded position = stored * scale  (node-local, small, float32-safe).
//
// Same `parseToMesh` seam the experiment proved with Spark: return a
// THREE.Object3D and the renderer owns transform/cull/cache/eviction. We must
// NOT be async at the top level (invokeOnePlugin treats a Promise as truthy and
// stops iterating), so non-matching content returns null synchronously.

// Shared material for all point nodes. Writes rgb + view-space log-depth (alpha)
// so the EDL post pass gets its depth field for free (no second target).
const pointUniforms = { uPointSize: { value: frame.pointSize } };

const pointMaterial = new THREE.ShaderMaterial({
  uniforms: pointUniforms,
  vertexShader: /* glsl */ `
    attribute vec3 color;
    uniform float uPointSize;
    varying vec3 vColor;
    varying float vLogZ;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vLogZ = log2(max(1e-6, -mv.z));
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uPointSize;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    varying float vLogZ;
    void main() {
      gl_FragColor = vec4(vColor, vLogZ);
    }
  `,
});

export function setPointSize(px: number) {
  pointUniforms.uPointSize.value = px;
}

export class PointTilePlugin {
  name = "POINT_TILE_PLUGIN";
  tiles: any = null;

  init(tiles: any) {
    this.tiles = tiles;
  }

  // parseToMesh: hand the blob to the decode WORKER POOL (off-thread dequant +
  // zero-copy transfer back) so tile loads never hitch the main thread. Must
  // return null synchronously for non-matching content (a Promise is truthy and
  // would stop plugin iteration); matching content returns a Promise<Points>.
  parseToMesh(
    buffer: ArrayBuffer,
    _tile: any,
    _extension: string,
    uri: string,
    signal: AbortSignal
  ) {
    if (!uri.includes(".pnt")) return null;
    if (signal.aborted) return null;
    return getPool().decode(buffer).then((d) => {
      if (signal.aborted) return null;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
      geom.setAttribute("color", new THREE.BufferAttribute(d.colors, 3, true));
      const points = new THREE.Points(geom, pointMaterial);
      points.matrixAutoUpdate = false;
      points.frustumCulled = false; // renderer culls per tile already
      points.userData.worldAnchor = d.anchor; // float64 world anchor for RTC
      placeAtAnchor(points, d.anchor);
      return points;
    });
  }

  disposeTile(tile: any) {
    const scene = tile.engineData?.scene;
    if (scene && scene.geometry) scene.geometry.dispose();
  }
}
