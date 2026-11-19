// Town skeleton generator. Runs once per town, fully deterministic from the town's seed and the
// land under it, so the skeleton is never saved: only per-surface state is. A town grows the
// way a village does on a hillside:
//   1. a square on the flattest ground near the middle, and gates in the wall round it
//      (gates.ts)
//   2. a main street from each gate to the square, along the cheapest way there: climbing
//      costs, and a slow noise makes the streets wander (streets.ts)
//   3. lanes out to points spread over the rest of the town, each joining the nearest street
//      (running along a street is cheap, so lanes branch off the streets like a tree)
//   4. houses along both sides of every street, turned to face it, each on a level pad
//      (houses.ts)
//   5. the land left over becomes yards: paintable ground, cut into patches per district
//      (yards.ts)
// Everything is also kept on a 4 m raster (streets, houses, yards) for walking, stains and
// patrols; site.ts surveys the land for it.
import { CITY_PREFIX, CITY_SUFFIX } from '@/content/names';
import { TUNING } from '@/content/tuning';
import { settlementBoundary, type BoundaryKind } from './settlement';
import type { SurfaceInfo } from '../paint/surfaces';
import { type Entrance, type Wilderness, WATER_LEVEL } from '../wilderness/generator';
import type { Tree } from '../wilderness/chunk';
import { type CitySkeleton, placeFeatures } from './features';
import { type Gate, type Square, placeGates, placeSquare } from './gates';
import { type Building, placeHouses } from './houses';
import { type Face, type Point, ROAD_MAIN, ROAD_NONE, type Site, surveySite } from './site';
import { type Street, layStreets } from './streets';
import { fillYards, plantYardTrees } from './yards';
import { villageGroundEdge } from './outline';

export {
  GATE_HALF,
  ROAD_ALLEY,
  ROAD_MAIN,
  ROAD_NONE,
  ROAD_SIDE,
  WET,
  groundAt,
  type Face,
  type Point,
  type RoadClass,
} from './site';
export { type Gate, type WorldGate, townGates } from './gates';
export type { Street } from './streets';
export { type Building, rectsOverlap } from './houses';

export interface CityLayout extends CitySkeleton {
  readonly boundary: BoundaryKind;
  /** Where the town stands: its north-west corner. Every metre position below (streets,
   * buildings, surfaces, stains, doors, spawn) is in world space; the rasters are cells counted
   * from this corner. */
  readonly ox: number;
  readonly oz: number;
  /** Blocks (districts) per side. */
  readonly chunks: number;
  readonly id: string;
  readonly seed: number;
  readonly name: string;
  /** Cells per side. */
  readonly n: number;
  readonly cell: number;
  /** Metres per side. */
  readonly size: number;
  /** Ground height at the cell corners, row-major [kz * (n + 1) + kx]. */
  readonly heights: Float32Array;
  /** Street class per cell, row-major [iz * n + ix]. */
  readonly roads: Uint8Array;
  /** 1 where a river runs through the cell (streets cross it by bridge). */
  readonly water: Uint8Array;
  /** Yard region id + 1 per cell (0 = street or wall). */
  readonly blockOf: Uint16Array;
  /** Building id + 1 per cell (0 = none). */
  readonly buildingOf: Uint16Array;
  /** Paintable ground surface per cell, or -1. */
  readonly groundOf: Int32Array;
  readonly gates: readonly Gate[];
  readonly streets: readonly Street[];
  readonly square: Square;
  /** Trees in the yards (as the wilderness's trees: ground height, size, leaf colour). */
  readonly trees: readonly Tree[];
  /** A mill's waterwheel in the river beside a house, turning on an axle along x; null when
   * no river runs through. */
  readonly wheel: (Point & { readonly y: number; readonly r: number }) | null;
  readonly buildings: readonly Building[];
  readonly surfaces: readonly SurfaceInfo[];
  /** Where a player entering through the main gate appears. */
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
}

/** A mill's waterwheel, metres. */
const WHEEL_RADIUS = 2.4;
/** It stands where the river is at least this deep, at most this far from its mill's middle. */
const WHEEL_DEPTH = 0.8;
const WHEEL_REACH = 12;

/**
 * A town laid out with its north-west corner at the origin and its main gate in the `main`
 * wall, on ground of the given height (metres, town-local; flat when left out). Pass it through
 * `placeCity` to stand it in the world.
 */
export function generateCity(
  id: string,
  seed: number,
  chunks: number = TUNING.city.chunks,
  main: Face = 'pz',
  height: (x: number, z: number) => number = () => 0,
): CityLayout {
  const site = surveySite(seed, chunks, height);
  const { n, cell, size, heights, water, surfaces, rng } = site;
  // ---- 1. gates and the square --------------------------------------------------------------
  const { gates, gateCell } = placeGates(site, main);
  const { square, at: sq } = placeSquare(site);
  // ---- 2 and 3. streets ---------------------------------------------------------------------
  const plan = layStreets(site, gates, gateCell, square, sq);
  const { roads, streets } = plan;
  // ---- 4. houses ----------------------------------------------------------------------------
  const { buildings, buildingOf } = placeHouses(site, plan, square);
  // ---- 5. yards -----------------------------------------------------------------------------
  const { blockOf, groundOf } = fillYards(site, roads, buildingOf);
  const trees = plantYardTrees(site, roads, blockOf, buildingOf, buildings, square);
  const wheel = placeWheel(site, roads, buildings, square);
  const spawn = spawnPoint(streets, square);
  const name = rng.pick(CITY_PREFIX) + rng.pick(CITY_SUFFIX);
  return {
    id,
    boundary: settlementBoundary(seed, chunks),
    ox: 0,
    oz: 0,
    chunks,
    seed,
    name,
    n,
    cell,
    size,
    heights,
    roads,
    water,
    blockOf,
    buildingOf,
    groundOf,
    gates,
    streets,
    square,
    trees,
    wheel,
    buildings,
    surfaces,
    spawn,
    ...placeFeatures({ seed, n, cell, chunks, roads, water, surfaces, buildings, spawn }),
  };
}

/** A waterwheel beside the riverside house nearest the square, where the river is deep enough
 * for its paddles. */
function placeWheel(
  site: Site,
  roads: Uint8Array,
  buildings: readonly Building[],
  square: Square,
): CityLayout['wheel'] {
  const { cell, idx, inside, water, ground } = site;
  let wheel: CityLayout['wheel'] = null;
  let wheelD = Infinity;
  for (const b of buildings) {
    const reach = Math.ceil((Math.max(b.hw, b.hd) + WHEEL_REACH) / cell);
    const bx = Math.floor(b.x / cell);
    const bz = Math.floor(b.z / cell);
    let near = -1;
    let nearD = Infinity;
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const x = bx + dx;
        const z = bz + dz;
        if (!inside(x, z) || !water[idx(x, z)] || roads[idx(x, z)] !== ROAD_NONE) continue;
        if (ground((x + 0.5) * cell, (z + 0.5) * cell) > WATER_LEVEL - WHEEL_DEPTH) continue;
        const d = Math.hypot((x + 0.5) * cell - b.x, (z + 0.5) * cell - b.z);
        if (d < nearD) {
          nearD = d;
          near = idx(x, z);
        }
      }
    if (near < 0 || nearD > Math.max(b.hw, b.hd) + WHEEL_REACH) continue;
    const d = Math.hypot(b.x - square.x, b.z - square.z);
    if (d < wheelD) {
      wheelD = d;
      const c = site.centreOf(near);
      wheel = { x: c.x, z: c.z, r: WHEEL_RADIUS, y: WATER_LEVEL + WHEEL_RADIUS * 0.55 };
    }
  }
  return wheel;
}

/** Spawn on the main street a little way in from the main gate, looking up it. */
function spawnPoint(streets: readonly Street[], square: Square): CityLayout['spawn'] {
  let spawn = { x: square.x, z: square.z, yaw: 0 };
  const entry = streets.find((s) => s.cls === ROAD_MAIN && s.points.length > 2);
  if (entry) {
    let walked = 0;
    for (let k = 0; k < entry.points.length - 1; k++) {
      const a = entry.points[k]!;
      const b = entry.points[k + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (walked + len < 16 && k < entry.points.length - 2) {
        walked += len;
        continue;
      }
      const t = Math.min(1, (16 - walked) / (len || 1));
      spawn = {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
      };
      break;
    }
  }
  return spawn;
}

/** The same town stood in the world with its north-west corner at (x, z). Heights belong to the
 * land, so they stay as they are. */
export function placeCity(c: CityLayout, at: Point): CityLayout {
  const move = <T extends Point>(p: T): T => ({ ...p, x: p.x + at.x, z: p.z + at.z });
  return {
    ...c,
    ox: c.ox + at.x,
    oz: c.oz + at.z,
    streets: c.streets.map((s) => ({ ...s, points: s.points.map(move) })),
    square: move(c.square),
    wheel: c.wheel && move(c.wheel),
    trees: c.trees.map(move),
    buildings: c.buildings.map(move),
    surfaces: c.surfaces.map(move),
    stains: c.stains.map(move),
    studios: c.studios.map((s) => ({ ...s, door: move(s.door) })),
    monsters: c.monsters.map(move),
    requests: c.requests.map((r) => ({ ...r, door: move(r.door) })),
    spawn: move(c.spawn),
  };
}

/** A town's layout on the land the wilderness gives it, where the wilderness put it. */
export function townLayout(e: Entrance, w: Pick<Wilderness, 'heightAt'>): CityLayout {
  const local = generateCity(e.cityId, e.seed, e.chunks, e.gate, (x, z) => w.heightAt(e.ox + x, e.oz + z));
  return placeCity(local, { x: e.ox, z: e.oz });
}

/** The yard surface on the ground at (x, z), or null on streets, under houses and outside. */
export function groundSurfaceAt(l: CityLayout, x: number, z: number): number | null {
  const ix = Math.floor((x - l.ox) / l.cell);
  const iz = Math.floor((z - l.oz) / l.cell);
  if (ix < 0 || iz < 0 || ix >= l.n || iz >= l.n) return null;
  const s = l.groundOf[iz * l.n + ix]!;
  return s >= 0 && villageGroundEdge(l, s, x, z) <= 0.5 ? s : null;
}
