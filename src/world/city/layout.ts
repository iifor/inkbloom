// City skeleton generator. Runs once per city, fully deterministic from the city seed, so the
// skeleton is never saved: only per-surface state is. Steps:
//   1. roads grow on a raster from the gates, turning at right angles (AABB physics friendly)
//   2. non-road cells flood-fill into blocks
//   3. buildings are packed into lots along each block's road frontage
//   4. leftover block cells become a paintable courtyard surface per block
import { CITY_PREFIX, CITY_SUFFIX } from '@/content/names';
import { BUILDINGS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import { color } from '@/content/palette';
import { Rng } from '../math/rng';
import type { SurfaceInfo, SurfaceKind } from '../paint/surfaces';

export const ROAD_NONE = 0;
export const ROAD_ALLEY = 1;
export const ROAD_SIDE = 2;
export const ROAD_MAIN = 3;
type RoadClass = typeof ROAD_ALLEY | typeof ROAD_SIDE | typeof ROAD_MAIN;

/** Directions: 0 +x, 1 +z, 2 -x, 3 -z. */
const DX = [1, 0, -1, 0] as const;
const DZ = [0, 1, 0, -1] as const;

export type Face = 'px' | 'nx' | 'pz' | 'nz';
const FACE_OF_DIR: readonly Face[] = ['px', 'pz', 'nx', 'nz'];

export interface Gate {
  /** Cell on the city edge. */
  readonly ix: number;
  readonly iz: number;
  /** Direction pointing into the city. */
  readonly dir: number;
  readonly main: boolean;
}

export interface Building {
  readonly id: number;
  /** Metres, city-local. */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  readonly height: number;
  readonly template: number;
  readonly doorFace: Face;
  /** Door centre in metres along the door face (z for px/nx faces, x for pz/nz). Always in
   * front of a road cell. */
  readonly doorAt: number;
  /** Surface ids. */
  readonly walls: Readonly<Record<Face, number>>;
  readonly roof: number;
  readonly door: number;
}

export interface Block {
  readonly id: number;
  readonly cells: number;
  /** Courtyard surface id, or -1 when the block is fully built. */
  readonly ground: number;
}

export interface CityLayout {
  readonly id: string;
  readonly seed: number;
  readonly name: string;
  /** Cells per side. */
  readonly n: number;
  readonly cell: number;
  /** Metres per side. */
  readonly size: number;
  /** Road class per cell, row-major [iz * n + ix]. */
  readonly roads: Uint8Array;
  /** Block id + 1 per cell (0 = road or wall). */
  readonly blockOf: Uint16Array;
  /** Building id + 1 per cell (0 = none). */
  readonly buildingOf: Uint16Array;
  readonly gates: readonly Gate[];
  readonly blocks: readonly Block[];
  readonly buildings: readonly Building[];
  readonly surfaces: readonly SurfaceInfo[];
  /** Where a player entering through the main gate appears. */
  readonly spawn: { readonly x: number; readonly z: number; readonly yaw: number };
}

export function generateCity(id: string, seed: number): CityLayout {
  const cfg = TUNING.city;
  const cell = cfg.cell;
  const n = Math.round((cfg.chunks * TUNING.world.chunkSize) / cell);
  const rng = new Rng(seed);
  const idx = (ix: number, iz: number): number => iz * n + ix;
  const inside = (ix: number, iz: number): boolean => ix >= 1 && iz >= 1 && ix < n - 1 && iz < n - 1;

  // ---- 1. roads -------------------------------------------------------------------------
  const roads = new Uint8Array(n * n);
  const owner = new Int32Array(n * n).fill(-1);
  const gates: Gate[] = [];
  const mid = Math.floor(n / 2);
  const jitter = (): number => rng.int(-Math.floor(n / 8), Math.floor(n / 8));
  gates.push({ ix: mid + jitter(), iz: n - 1, dir: 3, main: true });
  if (rng.chance(0.7)) gates.push({ ix: 0, iz: mid + jitter(), dir: 0, main: false });
  if (rng.chance(0.7)) gates.push({ ix: n - 1, iz: mid + jitter(), dir: 2, main: false });
  if (rng.chance(0.5)) gates.push({ ix: mid + jitter(), iz: 0, dir: 1, main: false });

  interface Agent {
    id: number;
    x: number;
    z: number;
    dir: number;
    cls: RoadClass;
    length: number;
    sinceTurn: number;
    sinceBranch: number;
    alive: boolean;
  }
  const widthOf = (cls: RoadClass): number =>
    cls === ROAD_MAIN ? cfg.roads.mainWidth : cls === ROAD_SIDE ? cfg.roads.sideWidth : cfg.roads.alleyWidth;
  const keyOf = (cls: RoadClass): 'main' | 'side' | 'alley' =>
    cls === ROAD_MAIN ? 'main' : cls === ROAD_SIDE ? 'side' : 'alley';
  let nextId = 0;
  const agents: Agent[] = [];
  const spawnAgent = (x: number, z: number, dir: number, cls: RoadClass): void => {
    agents.push({ id: nextId++, x, z, dir, cls, length: 0, sinceTurn: 0, sinceBranch: 0, alive: true });
  };
  for (const g of gates) spawnAgent(g.ix, g.iz, g.dir, ROAD_MAIN);

  const paint = (a: Agent): void => {
    const w = widthOf(a.cls);
    const px = DZ[a.dir]!; // perpendicular
    const pz = -DX[a.dir]!;
    const lo = -Math.floor((w - 1) / 2);
    for (let k = lo; k < lo + w; k++) {
      const x = a.x + px * k;
      const z = a.z + pz * k;
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const i = idx(x, z);
      if (roads[i]! < a.cls) roads[i] = a.cls;
      if (owner[i] === -1) owner[i] = a.id;
    }
  };
  const hitsOther = (a: Agent, x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= n || z >= n) return false;
    const i = idx(x, z);
    return roads[i]! !== ROAD_NONE && owner[i] !== a.id;
  };

  const centre = n / 2;
  for (let round = 0; round < n * 8; round++) {
    let any = false;
    for (const a of agents) {
      if (!a.alive) continue;
      any = true;
      paint(a);
      const max = cfg.roads.maxLength[keyOf(a.cls)];
      const nx = a.x + DX[a.dir]!;
      const nz = a.z + DZ[a.dir]!;
      const reach = Math.ceil(widthOf(a.cls) / 2) + 1;
      let joined = false;
      for (let r = 1; r <= reach && !joined; r++)
        if (hitsOther(a, a.x + DX[a.dir]! * r, a.z + DZ[a.dir]! * r)) joined = true;
      if (a.length > 2 && joined) {
        // walk into the other road so the junction is solid, then stop
        for (let r = 1; r <= reach; r++) {
          const x = a.x + DX[a.dir]! * r;
          const z = a.z + DZ[a.dir]! * r;
          if (x < 0 || z < 0 || x >= n || z >= n || roads[idx(x, z)]! !== ROAD_NONE) break;
          paint({ ...a, x, z });
        }
        a.alive = false;
        continue;
      }
      if (!inside(nx, nz) && a.length > 1) {
        a.alive = false;
        continue;
      }
      if (a.length >= max) {
        a.alive = false;
        continue;
      }
      a.x = nx;
      a.z = nz;
      a.length++;
      a.sinceTurn++;
      a.sinceBranch++;
      const key = keyOf(a.cls);
      // main roads run straight from their gate for a while so the entry street is clear
      const straight = a.cls === ROAD_MAIN ? cfg.roads.mainStraight : 3;
      if (
        a.sinceTurn >= cfg.roads.minSegment &&
        a.length > straight &&
        rng.chance(cfg.roads.turnChance[key])
      ) {
        const left = (a.dir + 3) % 4;
        const right = (a.dir + 1) % 4;
        // main roads lean towards the centre so the city has a heart
        const towards = (d: number): number =>
          Math.abs(a.x + DX[d]! * 10 - centre) + Math.abs(a.z + DZ[d]! * 10 - centre);
        if (a.cls === ROAD_MAIN && rng.chance(0.75)) a.dir = towards(left) < towards(right) ? left : right;
        else a.dir = rng.chance(0.5) ? left : right;
        a.sinceTurn = 0;
      }
      if (a.sinceBranch >= cfg.roads.minSegment * 2 && rng.chance(cfg.roads.branchChance[key])) {
        const child: RoadClass = a.cls === ROAD_MAIN ? ROAD_SIDE : ROAD_ALLEY;
        const side = rng.chance(0.5) ? 1 : 3;
        const dir = (a.dir + side) % 4;
        const off = Math.ceil(widthOf(a.cls) / 2);
        spawnAgent(a.x + DX[dir]! * off, a.z + DZ[dir]! * off, dir, child);
        a.sinceBranch = 0;
      }
    }
    if (!any) break;
  }

  // Every road piece must connect to the main gate. Carve L-shaped side roads to join strays.
  const component = (): Int32Array => {
    const comp = new Int32Array(n * n).fill(-1);
    let c = 0;
    for (let i = 0; i < n * n; i++) {
      if (roads[i] === ROAD_NONE || comp[i] !== -1) continue;
      const stack = [i];
      comp[i] = c;
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % n;
        const z = (j - x) / n;
        for (let d = 0; d < 4; d++) {
          const x2 = x + DX[d]!;
          const z2 = z + DZ[d]!;
          if (x2 < 0 || z2 < 0 || x2 >= n || z2 >= n) continue;
          const k = idx(x2, z2);
          if (roads[k] !== ROAD_NONE && comp[k] === -1) {
            comp[k] = c;
            stack.push(k);
          }
        }
      }
      c++;
    }
    return comp;
  };
  for (let pass = 0; pass < 16; pass++) {
    const comp = component();
    const mainGate = gates[0]!;
    const home = comp[idx(mainGate.ix, mainGate.iz)]!;
    let stray = -1;
    for (let i = 0; i < n * n; i++)
      if (comp[i]! >= 0 && comp[i] !== home) {
        stray = i;
        break;
      }
    if (stray < 0) break;
    const sx = stray % n;
    const sz = (stray - sx) / n;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n * n; i++) {
      if (comp[i] !== home) continue;
      const x = i % n;
      const z = (i - x) / n;
      const d = Math.abs(x - sx) + Math.abs(z - sz);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const tx = best % n;
    const tz = (best - tx) / n;
    const w = cfg.roads.sideWidth;
    const carve = (x: number, z: number): void => {
      for (let k = 0; k < w; k++)
        for (let m = 0; m < w; m++) {
          const xx = x + k;
          const zz = z + m;
          if (inside(xx, zz) || (xx === x && zz === z)) {
            const i = idx(Math.min(n - 1, xx), Math.min(n - 1, zz));
            if (roads[i] === ROAD_NONE) roads[i] = ROAD_SIDE;
          }
        }
    };
    for (let x = Math.min(sx, tx); x <= Math.max(sx, tx); x++) carve(x, sz);
    for (let z = Math.min(sz, tz); z <= Math.max(sz, tz); z++) carve(tx, z);
  }

  // ---- 2. blocks ------------------------------------------------------------------------
  const blockOf = new Uint16Array(n * n);
  const blockCells: number[][] = [];
  for (let iz = 1; iz < n - 1; iz++)
    for (let ix = 1; ix < n - 1; ix++) {
      const i = idx(ix, iz);
      if (roads[i] !== ROAD_NONE || blockOf[i] !== 0) continue;
      const id = blockCells.length;
      const cells: number[] = [];
      const stack = [i];
      blockOf[i] = id + 1;
      while (stack.length) {
        const j = stack.pop()!;
        cells.push(j);
        const x = j % n;
        const z = (j - x) / n;
        for (let d = 0; d < 4; d++) {
          const x2 = x + DX[d]!;
          const z2 = z + DZ[d]!;
          if (!inside(x2, z2)) continue;
          const k = idx(x2, z2);
          if (roads[k] === ROAD_NONE && blockOf[k] === 0) {
            blockOf[k] = id + 1;
            stack.push(k);
          }
        }
      }
      cells.sort((a, b) => a - b);
      blockCells.push(cells);
    }

  // ---- 3. buildings ---------------------------------------------------------------------
  const surfaces: SurfaceInfo[] = [];
  const chunkCells = TUNING.world.chunkSize / cell;
  const chunkOf = (x: number, z: number): number =>
    Math.min(cfg.chunks - 1, Math.floor(z / chunkCells)) * cfg.chunks +
    Math.min(cfg.chunks - 1, Math.floor(x / chunkCells));
  const addSurface = (kind: SurfaceKind, chunk: number, c: number, area: number): number => {
    surfaces.push({ kind, chunk, color: c, area });
    return surfaces.length - 1;
  };
  const buildingOf = new Uint16Array(n * n);
  const buildings: Building[] = [];
  const totalWeight = BUILDINGS.reduce((s, b) => s + b.weight, 0);
  const pickTemplate = (centrality: number): number => {
    // towers cluster near the centre: boost the last template's weight by centrality
    let r = rng.next() * (totalWeight + centrality * 6);
    for (let t = 0; t < BUILDINGS.length; t++) {
      r -= BUILDINGS[t]!.weight + (t === BUILDINGS.length - 1 ? centrality * 6 : 0);
      if (r <= 0) return t;
    }
    return BUILDINGS.length - 1;
  };
  const free = (x: number, z: number, block: number): boolean =>
    inside(x, z) && blockOf[idx(x, z)] === block && buildingOf[idx(x, z)] === 0;

  for (let b = 0; b < blockCells.length; b++) {
    const block = b + 1;
    for (const i of blockCells[b]!) {
      if (buildingOf[i] !== 0) continue;
      const x = i % n;
      const z = (i - x) / n;
      // the road this cell fronts onto; buildings grow away from it
      let roadDir = -1;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d]!;
        const z2 = z + DZ[d]!;
        if (x2 >= 0 && z2 >= 0 && x2 < n && z2 < n && roads[idx(x2, z2)] !== ROAD_NONE) {
          roadDir = d;
          break;
        }
      }
      if (roadDir < 0) continue;
      const back = (roadDir + 2) % 4;
      const along = (roadDir + 1) % 4;
      let placed = false;
      const wantW = rng.int(cfg.lots.minSize, cfg.lots.maxSize);
      const wantD = rng.int(cfg.lots.minSize, cfg.lots.maxSize);
      for (let w = wantW; w >= cfg.lots.minSize && !placed; w--)
        for (let dpt = wantD; dpt >= cfg.lots.minSize && !placed; dpt--) {
          let ok = true;
          const cells: number[] = [];
          for (let a = 0; a < w && ok; a++)
            for (let k = 0; k < dpt && ok; k++) {
              const cx = x + DX[along]! * a + DX[back]! * k;
              const cz = z + DZ[along]! * a + DZ[back]! * k;
              if (!free(cx, cz, block)) ok = false;
              else cells.push(idx(cx, cz));
            }
          if (!ok) continue;
          placed = true;
          let minX = n;
          let minZ = n;
          let maxX = 0;
          let maxZ = 0;
          for (const c of cells) {
            const cx = c % n;
            const cz = (c - cx) / n;
            minX = Math.min(minX, cx);
            minZ = Math.min(minZ, cz);
            maxX = Math.max(maxX, cx);
            maxZ = Math.max(maxZ, cz);
          }
          const id = buildings.length;
          for (const c of cells) buildingOf[c] = id + 1;
          const x0 = minX * cell;
          const z0 = minZ * cell;
          const x1 = (maxX + 1) * cell;
          const z1 = (maxZ + 1) * cell;
          const centrality =
            1 -
            Math.min(1, Math.hypot((x0 + x1) / 2 / cell - centre, (z0 + z1) / 2 / cell - centre) / (n / 2));
          const t = pickTemplate(centrality);
          const tpl = BUILDINGS[t]!;
          const floors = rng.int(tpl.floors.min, tpl.floors.max);
          const height = floors * cfg.lots.floorHeight;
          const chunk = chunkOf((minX + maxX) / 2, (minZ + maxZ) / 2);
          const wall = rng.pick(tpl.walls);
          const sx = x1 - x0;
          const sz = z1 - z0;
          const walls = {
            px: addSurface('wall', chunk, wall, sz * height),
            nx: addSurface('wall', chunk, wall, sz * height),
            pz: addSurface('wall', chunk, wall, sx * height),
            nz: addSurface('wall', chunk, wall, sx * height),
          };
          const roof = addSurface('roof', chunk, rng.pick(tpl.roofs), sx * sz);
          const door = addSurface('door', chunk, rng.pick(tpl.doors), 1.6 * 2.4);
          // the door goes in the middle of the front-row run that actually touches the road
          const alongX = DX[along] !== 0;
          let lo = Infinity;
          let hi = -Infinity;
          for (let a = 0; a < w; a++) {
            const fx = x + DX[along]! * a;
            const fz = z + DZ[along]! * a;
            const rx = fx + DX[roadDir]!;
            const rz = fz + DZ[roadDir]!;
            if (rx < 0 || rz < 0 || rx >= n || rz >= n || roads[idx(rx, rz)] === ROAD_NONE) break;
            const coord = alongX ? fx : fz;
            lo = Math.min(lo, coord);
            hi = Math.max(hi, coord);
          }
          const doorAt = ((lo + hi + 1) / 2) * cell;
          buildings.push({
            id,
            x0,
            z0,
            x1,
            z1,
            height,
            template: t,
            doorFace: FACE_OF_DIR[roadDir]!,
            doorAt,
            walls,
            roof,
            door,
          });
        }
    }
  }

  // ---- 4. courtyards --------------------------------------------------------------------
  const blocks: Block[] = blockCells.map((cells, b) => {
    const open = cells.filter((i) => buildingOf[i] === 0);
    if (open.length === 0) return { id: b, cells: cells.length, ground: -1 };
    const first = open[0]!;
    const fx = first % n;
    const ground = addSurface(
      'ground',
      chunkOf(fx, (first - fx) / n),
      rng.pick([color('grass'), color('sand'), color('green')]),
      open.length * cell * cell,
    );
    return { id: b, cells: cells.length, ground };
  });

  // Spawn on the main street a few cells in from the gate; never past the last road cell.
  const main = gates[0]!;
  let spawnDepth = 0;
  for (let d = 1; d <= cfg.roads.mainWidth + 3; d++) {
    const sx = main.ix + DX[main.dir]! * d;
    const sz = main.iz + DZ[main.dir]! * d;
    if (sx < 0 || sz < 0 || sx >= n || sz >= n || roads[idx(sx, sz)] === ROAD_NONE) break;
    spawnDepth = d;
  }
  const name = rng.pick(CITY_PREFIX) + rng.pick(CITY_SUFFIX);
  return {
    id,
    seed,
    name,
    n,
    cell,
    size: n * cell,
    roads,
    blockOf,
    buildingOf,
    gates,
    blocks,
    buildings,
    surfaces,
    spawn: {
      x: (main.ix + 0.5 + DX[main.dir]! * spawnDepth) * cell,
      z: (main.iz + 0.5 + DZ[main.dir]! * spawnDepth) * cell,
      yaw: 0,
    },
  };
}
