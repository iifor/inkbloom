// A wilderness chunk as plain data. The renderer and physics build from this; tests check it.
import { BIOMES } from '@/content/biomes';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { grovesNear, patchMask, seasNear } from './groves';
import { inkWellInChunk } from './ink-wells';
import { type Lookout, lookoutsInChunk, type Spring, springsInChunk } from './landmarks';
import { type Bridge, pathsOf } from './paths';
import { type PigmentSource, sourcesInChunk } from './sources';
import { type Ruin, ruinsInChunk } from './ruins';

export interface Tree {
  readonly x: number;
  readonly z: number;
  /** Ground height under the trunk. */
  readonly y: number;
  readonly height: number;
  readonly crown: number;
  readonly color: number;
  /** A great old tree standing alone (height is its whole height, crown its spread), or a
   * clump of bamboo in a grove (height its tallest culm, crown the clump's spread). */
  readonly kind?: 'great' | 'bamboo';
}

export interface WildChunk {
  readonly cx: number;
  readonly cz: number;
  /** World position of the chunk's minimum corner. */
  readonly x0: number;
  readonly z0: number;
  /** Cells per side. */
  readonly n: number;
  readonly cell: number;
  /** Terraced height at each cell, row-major [iz * n + ix]. */
  readonly heights: Float32Array;
  readonly biomes: Uint8Array;
  readonly trees: readonly Tree[];
  readonly hasWater: boolean;
  readonly sources: readonly PigmentSource[];
  readonly ruins: readonly Ruin[];
  /** Footpath bridges whose deck's middle is in this chunk (see paths.ts). */
  readonly bridges: readonly Bridge[];
  /** Hot springs and summit lookouts whose middle is in this chunk (see landmarks.ts). */
  readonly springs: readonly Spring[];
  readonly lookouts: readonly Lookout[];
}

/** Bamboo clumps: the chance per terrain cell deep in a grove, metres tall, clump spread. */
const BAMBOO = { density: 0.75, maxSlope: 2.2, height: [7, 11], crown: [1.3, 2.1] } as const;

/** Trees keep this far (metres) from a footpath's edge. */
const PATH_ROOM = 2.5;

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

export function generateWildChunk(w: Wilderness, cx: number, cz: number): WildChunk {
  const size = TUNING.world.chunkSize;
  const cell = TUNING.world.cellSize;
  const n = size / cell;
  const x0 = cx * size;
  const z0 = cz * size;
  const heights = new Float32Array(n * n);
  const biomes = new Uint8Array(n * n);
  let hasWater = false;
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const x = x0 + (ix + 0.5) * cell;
      const z = z0 + (iz + 0.5) * cell;
      const h = w.heightAt(x, z);
      heights[iz * n + ix] = h;
      biomes[iz * n + ix] = w.biomeAt(x, z);
      if (h < WATER_LEVEL) hasWater = true;
    }

  const trees: Tree[] = [];
  // bamboo stands in place of the trees in a grove; a flower sea is open ground
  const mid = { x: x0 + size / 2, z: z0 + size / 2 };
  const groves = grovesNear(w, mid.x, mid.z, size * 0.75);
  const seas = seasNear(w, mid.x, mid.z, size * 0.75);
  const at = (ix: number, iz: number): number =>
    ix >= 0 && iz >= 0 && ix < n && iz < n
      ? heights[iz * n + ix]!
      : w.heightAt(x0 + (ix + 0.5) * cell, z0 + (iz + 0.5) * cell);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const biome = BIOMES[biomes[iz * n + ix]!]!;
      const h = hashAt(w.seed, 'tree', cx * n + ix, cz * n + iz);
      const cxz = { x: x0 + (ix + 0.5) * cell, z: z0 + (iz + 0.5) * cell };
      const grove = groves.reduce((m, g) => Math.max(m, patchMask(g, cxz.x, cxz.z)), 0);
      const bamboo = grove > 0.2;
      if (unit(h) >= (bamboo ? BAMBOO.density * grove : biome.treeDensity)) continue;
      if (!bamboo && seas.some((f) => patchMask(f, cxz.x, cxz.z) > 0.05)) continue;
      const y = heights[iz * n + ix]!;
      if (y < WATER_LEVEL + 0.5) continue;
      const slope = Math.max(
        Math.abs(at(ix + 1, iz) - y),
        Math.abs(at(ix - 1, iz) - y),
        Math.abs(at(ix, iz + 1) - y),
        Math.abs(at(ix, iz - 1) - y),
      );
      if (slope > (bamboo ? BAMBOO.maxSlope : biome.treeMaxSlope)) continue;
      // (shifted hashes are too few bits for `unit`, which lines trees up near the cell's corner;
      // bamboo, packed close, would stand in rows: it draws its spot properly)
      const x = x0 + (ix + 0.2 + 0.6 * unit(bamboo ? hashInts(h, 3) : h >>> 3)) * cell;
      const z = z0 + (iz + 0.2 + 0.6 * unit(bamboo ? hashInts(h, 4) : h >>> 11)) * cell;
      if (Math.hypot(x, z) < 14) continue;
      if (w.townAt(x, z, TUNING.structures.townClearance)) continue;
      if (bamboo) {
        trees.push({
          x,
          z,
          y: w.heightAt(x, z) - 0.15,
          // taller in the heart of the grove, shorter shoots at its edge
          height:
            (BAMBOO.height[0] + (BAMBOO.height[1] - BAMBOO.height[0]) * unit(hashInts(h, 1))) *
            (0.6 + 0.4 * grove),
          crown: BAMBOO.crown[0] + (BAMBOO.crown[1] - BAMBOO.crown[0]) * unit(hashInts(h, 2)),
          color: color('cedar'),
          kind: 'bamboo',
        });
        continue;
      }
      trees.push({
        x,
        z,
        // rooted a little into the slope where it actually stands
        y: w.heightAt(x, z) - 0.2,
        height: 4 + 5 * unit(h >>> 5),
        crown: 1.6 + 1.4 * unit(h >>> 17),
        color: biome.treeColor,
      });
    }

  const sources = sourcesInChunk(w, cx, cz);
  const ruins = ruinsInChunk(w, cx, cz);
  // now and then a great old tree stands alone in the open, the others giving it room
  const paths = pathsOf(w);
  const offPath = (x: number, z: number): boolean => paths.edgeDistance(x, z) > PATH_ROOM;
  const great = greatTreeIn(w, cx, cz, sources, ruins);
  // springs and lookouts here and next door: trees near a chunk's edge give them room too
  const springs = springsInChunk(w, cx, cz);
  const lookouts = lookoutsInChunk(w, cx, cz);
  const marks: { x: number; z: number; room: number }[] = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      for (const s of springsInChunk(w, cx + dx, cz + dz)) marks.push({ x: s.x, z: s.z, room: s.r + 5 });
      for (const l of lookoutsInChunk(w, cx + dx, cz + dz)) marks.push({ x: l.x, z: l.z, room: 7 });
      const well = inkWellInChunk(w, cx + dx, cz + dz);
      if (well) marks.push({ x: well.x, z: well.z, room: 6 });
    }
  // keep trees off sources, ruins, paths and landmarks so they stay visible and reachable
  const clearTrees = trees.filter(
    (t) =>
      !sources.some((src) => Math.hypot(t.x - src.x, t.z - src.z) < 4) &&
      !ruins.some((r) => Math.hypot(t.x - r.x, t.z - r.z) < 14) &&
      !(great && Math.hypot(t.x - great.x, t.z - great.z) < GREAT.room) &&
      !marks.some((m) => Math.hypot(t.x - m.x, t.z - m.z) < m.room) &&
      offPath(t.x, t.z),
  );
  if (great) clearTrees.push(great);
  const bridges: Bridge[] = [];
  for (const t of paths.trailsNear(x0, z0, x0 + size, z0 + size))
    for (const b of t.bridges) {
      const mx = (b.x0 + b.x1) / 2;
      if (mx < x0 || mx >= x0 + size || b.z < z0 || b.z >= z0 + size) continue;
      // paths that cross the river at the same spot share one bridge: the widest of theirs
      const at = bridges.findIndex(
        (o) => b.x0 < o.x1 && o.x0 < b.x1 && Math.abs(b.z - o.z) < b.half + o.half + 1,
      );
      if (at < 0) bridges.push(b);
      else if (b.half > bridges[at]!.half) bridges[at] = b;
    }
  return {
    cx,
    cz,
    x0,
    z0,
    n,
    cell,
    heights,
    biomes,
    trees: clearTrees,
    hasWater,
    sources,
    ruins,
    bridges,
    springs,
    lookouts,
  };
}

/** Great trees: the chance a chunk has one, their size, and the room they are given. */
const GREAT = { chance: 0.35, height: [16, 22], crown: [8.5, 11.5], room: 14, steep: 1.6 } as const;

/** A chunk's great old tree, if it has one: on gentle open ground, dry, away from spawn, towns,
 * pigment sources and ruins. Deterministic from the world seed, like everything else in a chunk. */
export function greatTreeIn(
  w: Wilderness,
  cx: number,
  cz: number,
  sources: readonly { x: number; z: number }[] = sourcesInChunk(w, cx, cz),
  ruins: readonly { x: number; z: number }[] = ruinsInChunk(w, cx, cz),
): Tree | null {
  const size = TUNING.world.chunkSize;
  const h = hashAt(w.seed, 'great-tree', cx, cz);
  if (unit(h) >= GREAT.chance) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = hashAt(w.seed, 'great-tree-spot', cx, cz, attempt);
    const x = cx * size + 20 + unit(r) * (size - 40);
    const z = cz * size + 20 + unit(r >>> 7) * (size - 40);
    if (Math.hypot(x - size / 2, z - size / 2) < 70) continue;
    if (w.townAt(x, z, 30)) continue;
    if (sources.some((p) => Math.hypot(p.x - x, p.z - z) < GREAT.room)) continue;
    if (ruins.some((p) => Math.hypot(p.x - x, p.z - z) < GREAT.room + 10)) continue;
    // a great tree stands in the open, not in the middle of a bamboo grove
    if (grovesNear(w, x, z, 0).some((g) => patchMask(g, x, z) > 0)) continue;
    // beside a footpath, not on it: its spread may reach over the way
    if (pathsOf(w).edgeDistance(x, z) < PATH_ROOM + 3) continue;
    const y = w.heightAt(x, z);
    if (y < WATER_LEVEL + 1.2) continue;
    // gentle ground under the whole spread
    let lo = y;
    let hi = y;
    for (const [dx, dz] of [
      [10, 0],
      [-10, 0],
      [0, 10],
      [0, -10],
    ] as const) {
      const g = w.heightAt(x + dx, z + dz);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
      if (g < WATER_LEVEL + 0.5) lo = -Infinity;
    }
    if (hi - lo > GREAT.steep) continue;
    const t = hashAt(w.seed, 'great-tree-size', cx, cz);
    return {
      x,
      z,
      y: y - 0.3,
      height: GREAT.height[0] + unit(t) * (GREAT.height[1] - GREAT.height[0]),
      crown: GREAT.crown[0] + unit(t >>> 9) * (GREAT.crown[1] - GREAT.crown[0]),
      color: unit(t >>> 3) < 0.5 ? color('leaf') : color('canopy'),
      kind: 'great',
    };
  }
  return null;
}
