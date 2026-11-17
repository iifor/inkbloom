// The ground a town is laid out on, and the 4 m raster every stage of its layout works over
// (layout.ts runs the stages): the land's heights, where rivers run, how steep each cell is,
// the districts, and the paintable surfaces as they are handed out.
import { TUNING } from '@/content/tuning';
import { Rng } from '../math/rng';
import type { SurfaceInfo, SurfaceKind } from '../paint/surfaces';
import { WATER_LEVEL } from '../wilderness/generator';

export const ROAD_NONE = 0;
export const ROAD_ALLEY = 1;
export const ROAD_SIDE = 2;
export const ROAD_MAIN = 3;
export type RoadClass = typeof ROAD_ALLEY | typeof ROAD_SIDE | typeof ROAD_MAIN;

/** Directions: 0 +x, 1 +z, 2 -x, 3 -z. */
export const DX = [1, 0, -1, 0] as const;
export const DZ = [0, 1, 0, -1] as const;

export type Face = 'px' | 'nx' | 'pz' | 'nz';

export interface Point {
  readonly x: number;
  readonly z: number;
}

/** Cells either side of a gate's middle left open in the wall. */
export const GATE_HALF = 2;
/** Ground below this is river: a cell whose middle is this low is water. */
export const WET = WATER_LEVEL + 0.2;

/** The land under a town: where it stands, its raster and the heights at the cell corners. */
export interface Land {
  readonly ox: number;
  readonly oz: number;
  readonly n: number;
  readonly cell: number;
  readonly heights: Float32Array;
}

/** Ground height inside a town, the way the wilderness interpolates it: two triangles per cell
 * split along the (x+1, z)–(x, z+1) diagonal. */
export function groundAt(l: Land, x: number, z: number): number {
  const n = l.n;
  const gx = Math.min(n, Math.max(0, (x - l.ox) / l.cell));
  const gz = Math.min(n, Math.max(0, (z - l.oz) / l.cell));
  const ix = Math.min(n - 1, Math.floor(gx));
  const iz = Math.min(n - 1, Math.floor(gz));
  const u = gx - ix;
  const v = gz - iz;
  const h = l.heights;
  const a = iz * (n + 1) + ix;
  const c10 = h[a + 1]!;
  const c01 = h[a + n + 1]!;
  if (u + v <= 1) return (1 - u - v) * h[a]! + u * c10 + v * c01;
  return (u + v - 1) * h[a + n + 2]! + (1 - v) * c10 + (1 - u) * c01;
}

/** A town being laid out, town-local (north-west corner at the origin). */
export interface Site {
  readonly seed: number;
  /** The layout's one random stream: every stage draws from it in turn. */
  readonly rng: Rng;
  /** Blocks (districts) per side. */
  readonly chunks: number;
  /** Cells per side. */
  readonly n: number;
  readonly cell: number;
  /** Metres per side. */
  readonly size: number;
  readonly heights: Float32Array;
  /** 1 where the cell's middle is under (or just at) the water. */
  readonly water: Uint8Array;
  /** Rise over run across each cell. */
  readonly slope: Float32Array;
  /** Paintable surfaces handed out so far; a surface's id is its index. */
  readonly surfaces: SurfaceInfo[];
  idx(ix: number, iz: number): number;
  /** Inside the wall: not on the town's outermost ring of cells. */
  inside(ix: number, iz: number): boolean;
  ground(x: number, z: number): number;
  /** Height at a cell corner, clamped to the town. */
  corner(kx: number, kz: number): number;
  /** Water within `r` cells of a cell. */
  nearWater(ix: number, iz: number, r: number): boolean;
  /** The middle of a cell, metres. */
  centreOf(i: number): Point;
  /** The district (block) a point lies in. */
  chunkOf(x: number, z: number): number;
  addSurface(kind: SurfaceKind, chunk: number, c: number, area: number, x: number, z: number): number;
}

/** Survey the land for a town of `chunks` districts a side, on ground of the given height. */
export function surveySite(seed: number, chunks: number, height: (x: number, z: number) => number): Site {
  const cell = TUNING.city.cell;
  const n = Math.round((chunks * TUNING.world.chunkSize) / cell);
  const size = n * cell;
  const idx = (ix: number, iz: number): number => iz * n + ix;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let kz = 0; kz <= n; kz++)
    for (let kx = 0; kx <= n; kx++) heights[kz * (n + 1) + kx] = height(kx * cell, kz * cell);
  const land: Land = { ox: 0, oz: 0, n, cell, heights };
  const ground = (x: number, z: number): number => groundAt(land, x, z);
  const corner = (kx: number, kz: number): number =>
    heights[Math.min(n, Math.max(0, kz)) * (n + 1) + Math.min(n, Math.max(0, kx))]!;
  // rivers: the cells whose middle is under (or just at) the water
  const water = new Uint8Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++)
      water[idx(ix, iz)] = ground((ix + 0.5) * cell, (iz + 0.5) * cell) < WET ? 1 : 0;
  const slope = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const c = [corner(ix, iz), corner(ix + 1, iz), corner(ix, iz + 1), corner(ix + 1, iz + 1)];
      slope[idx(ix, iz)] = (Math.max(...c) - Math.min(...c)) / cell;
    }
  const per = TUNING.world.chunkSize;
  const surfaces: SurfaceInfo[] = [];
  return {
    seed,
    rng: new Rng(seed),
    chunks,
    n,
    cell,
    size,
    heights,
    water,
    slope,
    surfaces,
    idx,
    inside: (ix, iz) => ix >= 1 && iz >= 1 && ix < n - 1 && iz < n - 1,
    ground,
    corner,
    nearWater: (ix, iz, r) => {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          const x = ix + dx;
          const z = iz + dz;
          if (x >= 0 && z >= 0 && x < n && z < n && water[idx(x, z)]) return true;
        }
      return false;
    },
    centreOf: (i) => ({ x: ((i % n) + 0.5) * cell, z: (Math.floor(i / n) + 0.5) * cell }),
    chunkOf: (x, z) =>
      Math.min(chunks - 1, Math.max(0, Math.floor(z / per))) * chunks +
      Math.min(chunks - 1, Math.max(0, Math.floor(x / per))),
    addSurface: (kind, chunk, c, area, x, z) => {
      surfaces.push({ kind, chunk, color: c, area, x, z });
      return surfaces.length - 1;
    },
  };
}
