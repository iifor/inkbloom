// A continuous landscape between playable chunks and the painted mountain backdrop.
// Only height/soil are sampled: no towns, actors, physics or grass are instantiated here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING } from '@/content/tuning';
import { makeInkMaterial, NO_SHADOW_LAYER } from '@/engine/render/ink-material';
import { riverbedMeadow, type Wilderness } from '@/world/wilderness/generator';
import { landscapeTiles, type LandscapeTile } from '@/world/wilderness/landscape';
import { MAX_EARTHWORK } from '@/world/wilderness/paths';

/** Tile boundaries sample the same 4 m edge as detailed terrain, including between LODs.
 * Interior cells use triangle fans, joining those fine edges without cracks or skirts. */
export function* landscapeGeometry(
  w: Wilderness,
  tile: LandscapeTile,
): Generator<void, THREE.BufferGeometry> {
  const { x, z, size } = tile;
  const n = TUNING.world.landscape.cells,
    step = size / n,
    edge = TUNING.world.cellSize;
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const vertices = new Map<string, number>();
  const vertex = (px: number, pz: number): number => {
    const key = `${px},${pz}`;
    const cached = vertices.get(key);
    if (cached !== undefined) return cached;
    const i = positions.length / 3;
    // Road benches are a near-ground detail. Surveying remote road networks here
    // would stall streaming; perimeter skirts join this approximation to graded chunks.
    positions.push(px, w.terrainHeightAt(px, pz), pz);
    const normal = new THREE.Vector3(
      w.terrainHeightAt(px - edge, pz) - w.terrainHeightAt(px + edge, pz),
      edge * 2,
      w.terrainHeightAt(px, pz - edge) - w.terrainHeightAt(px, pz + edge),
    ).normalize();
    normals.push(normal.x, normal.y, normal.z);
    colors.push(-1 - riverbedMeadow(w.climate(px, pz)));
    vertices.set(key, i);
    return i;
  };
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const ax = x + ix * step,
        az = z + iz * step;
      const center = vertex(ax + step / 2, az + step / 2),
        ring: number[] = [];
      const side = (sx: number, sz: number, dx: number, dz: number, fine: boolean): void => {
        const count = fine ? step / edge : 1;
        for (let k = 0; k < count; k++) ring.push(vertex(sx + (dx * k) / count, sz + (dz * k) / count));
      };
      side(ax, az, 0, step, ix === 0);
      side(ax, az + step, step, 0, iz === n - 1);
      side(ax + step, az + step, 0, -step, ix === n - 1);
      side(ax + step, az, -step, 0, iz === 0);
      for (let i = 0; i < ring.length; i++) indices.push(center, ring[i]!, ring[(i + 1) % ring.length]!);
      yield;
    }
  // Only the smallest tiles meet playable chunks. Hide their bounded cut/fill
  // height difference with buried skirts, in the existing batch/draw call.
  if (size === TUNING.world.chunkSize) {
    const side = (sx: number, sz: number, dx: number, dz: number) => {
      for (let k = 0; k < size; k += edge) {
        const a = vertex(sx + dx * k, sz + dz * k),
          b = vertex(sx + dx * (k + edge), sz + dz * (k + edge));
        const start = positions.length / 3;
        for (const i of [a, b]) {
          positions.push(
            positions[i * 3]!,
            positions[i * 3 + 1]! - MAX_EARTHWORK - 0.3,
            positions[i * 3 + 2]!,
          );
          normals.push(dz, 0, -dx);
          colors.push(colors[i]!);
        }
        indices.push(a, start, b, b, start, start + 1);
      }
    };
    side(x, z, 0, 1);
    side(x, z + size, 1, 0);
    side(x + size, z + size, 0, -1);
    side(x + size, z, -1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 1));
  g.setAttribute('aSurface', new THREE.Float32BufferAttribute(new Float32Array(colors.length).fill(-1), 1));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

interface Built {
  tile: LandscapeTile;
  mesh: THREE.Mesh;
}
/** One draw per large landscape block. Mask a detailed chunk by collapsing only its indices,
 * without rebuilding the terrain or uploading its vertex buffers when chunks stream. */
class LandscapeBatch {
  readonly mesh: THREE.Mesh;
  private readonly indices: Uint16Array | Uint32Array;
  private readonly parts: { tile: LandscapeTile; offset: number; count: number; shown: boolean }[] = [];
  constructor(tiles: LandscapeTile[], built: ReadonlyMap<string, Built>, material: THREE.Material) {
    const geometry = mergeGeometries(tiles.map((t) => built.get(t.key)!.mesh.geometry))!;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'landscape-batch';
    this.mesh.layers.set(NO_SHADOW_LAYER);
    this.mesh.visible = false;
    this.indices = (geometry.index!.array as Uint16Array | Uint32Array).slice();
    let offset = 0;
    for (const tile of tiles) {
      const count = built.get(tile.key)!.mesh.geometry.index!.count;
      this.parts.push({ tile, offset, count, shown: true });
      offset += count;
    }
    geometry.computeBoundingSphere();
  }
  update(detailed: ReadonlyMap<string, unknown>): void {
    const size = TUNING.world.chunkSize,
      index = this.mesh.geometry.index!;
    for (const part of this.parts) {
      const { tile, offset, count } = part;
      const shown = !(tile.size === size && detailed.has(`${tile.x / size},${tile.z / size}`));
      if (shown === part.shown) continue;
      part.shown = shown;
      const array = index.array as Uint16Array | Uint32Array;
      if (shown) array.set(this.indices.subarray(offset, offset + count), offset);
      else array.fill(0, offset, offset + count);
      index.addUpdateRange(offset, count);
      index.needsUpdate = true;
    }
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
/** Build within a small real-time budget. When moving, keep the last complete coverage until
 * its replacement is ready, then swap atomically so a LOD change cannot open a sky hole. */
export class DistantTerrain {
  private readonly material = makeInkMaterial();
  private readonly built = new Map<string, Built>();
  private visible = new Set<string>();
  private wanted: LandscapeTile[] = [];
  private pending: { tile: LandscapeTile; steps: Generator<void, THREE.BufferGeometry> } | null = null;
  private cell = '';
  private initial = true;
  private publishedCell = '';
  private groups = new Map<string, LandscapeTile[]>();
  private readonly batches = new Map<string, LandscapeBatch>();
  private activeBatches = new Set<string>();
  private detailedKeys = new Set<string>();
  constructor(
    private readonly w: Wilderness,
    private readonly root: THREE.Group,
  ) {}

  update(p: THREE.Vector3Like, detailed: ReadonlyMap<string, unknown>): void {
    const size = TUNING.world.chunkSize;
    const cell = `${Math.floor(p.x / size)},${Math.floor(p.z / size)}`;
    // Once published, movement within a chunk changes neither geometry nor LOD masks.
    // The loaded map is mutated in place, so compare its keys, not its identity or just size.
    if (
      cell === this.publishedCell &&
      cell === this.cell &&
      detailed.size === this.detailedKeys.size &&
      [...detailed.keys()].every((key) => this.detailedKeys.has(key))
    )
      return;
    this.detailedKeys = new Set(detailed.keys());
    if (cell !== this.cell) {
      this.cell = cell;
      this.wanted = landscapeTiles(p.x, p.z);
      const roots = new Map<string, LandscapeTile[]>();
      for (const tile of this.wanted) {
        const rootSize = TUNING.world.landscape.rootSize;
        const key = `${Math.floor(tile.x / rootSize)},${Math.floor(tile.z / rootSize)}`;
        const list = roots.get(key) ?? [];
        list.push(tile);
        roots.set(key, list);
      }
      this.groups = new Map(
        [...roots.values()].map((tiles) => {
          tiles.sort((a, b) => a.key.localeCompare(b.key));
          return [tiles.map((t) => t.key).join('|'), tiles];
        }),
      );
      for (const [key, batch] of this.batches)
        if (!this.groups.has(key) && !this.activeBatches.has(key)) {
          batch.dispose();
          this.batches.delete(key);
        }
      const keep = new Set(this.wanted.map((t) => t.key));
      if (this.initial) for (const key of this.visible) if (!keep.has(key)) this.visible.delete(key);
      if (this.pending && !keep.has(this.pending.tile.key)) this.pending = null;
      for (const [key, item] of this.built)
        if (!keep.has(key) && !this.visible.has(key)) this.remove(key, item);
    }
    const until = performance.now() + (this.initial ? 4 : 1.5);
    while (performance.now() < until) {
      if (!this.pending) {
        const tile = this.wanted.find((t) => !this.built.has(t.key));
        if (!tile) {
          // Merge at most one block before checking the construction budget again.
          const group = [...this.groups].find(([key]) => !this.batches.has(key));
          if (!group) break;
          const batch = new LandscapeBatch(group[1], this.built, this.material);
          this.root.add(batch.mesh);
          this.batches.set(group[0], batch);
          continue;
        }
        this.pending = { tile, steps: landscapeGeometry(this.w, tile) };
      }
      const next = this.pending.steps.next();
      if (next.done) {
        const { tile } = this.pending;
        const mesh = new THREE.Mesh(next.value, this.material);
        mesh.name = `landscape:${tile.key}`;
        mesh.layers.set(NO_SHADOW_LAYER);
        mesh.visible = false;
        if (this.initial) this.root.add(mesh);
        this.built.set(tile.key, { tile, mesh });
        if (this.initial) this.visible.add(tile.key);
        this.pending = null;
      }
    }
    if (this.publishedCell !== this.cell && [...this.groups.keys()].every((key) => this.batches.has(key))) {
      this.visible = new Set(this.wanted.map((t) => t.key));
      this.initial = false;
      this.publishedCell = this.cell;
      this.activeBatches = new Set(this.groups.keys());
      for (const [key, batch] of this.batches)
        if (!this.activeBatches.has(key)) {
          batch.dispose();
          this.batches.delete(key);
        }
      for (const item of this.built.values()) item.mesh.removeFromParent();
      for (const [key, item] of this.built) if (!this.visible.has(key)) this.remove(key, item);
    }
    for (const [key, { tile, mesh }] of this.built)
      mesh.visible =
        this.initial &&
        this.visible.has(key) &&
        !(tile.size === size && detailed.has(`${tile.x / size},${tile.z / size}`));
    for (const [key, batch] of this.batches) {
      batch.mesh.visible = this.activeBatches.has(key);
      if (batch.mesh.visible) batch.update(detailed);
    }
  }
  private remove(key: string, item: Built): void {
    item.mesh.removeFromParent();
    item.mesh.geometry.dispose();
    this.built.delete(key);
  }
  dispose(): void {
    this.pending = null;
    for (const [key, item] of this.built) this.remove(key, item);
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.activeBatches.clear();
    this.detailedKeys.clear();
    this.material.dispose();
    this.visible.clear();
  }
}
