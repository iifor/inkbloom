// Footpaths across the wilderness: from spawn to the first town, between neighbouring towns
// (gate to gate), and from each ruin to its nearest town. A path is a pure function of the seed
// like everything else out here, so any chunk can ask which paths cross it, in any order.
//
// Each path leaves its gate straight, then wanders gently (a noise offset that dies away at both
// ends), steps around towns in the way, and crosses every river straight east–west over a plank
// bridge. Trees and grass keep off it; the chunk mesh lays it on the ground as a dirt ribbon.
import { TUNING } from '@/content/tuning';
import { townGates, type WorldGate } from '../city/gates';
import { hashAt } from '../math/hash';
import { Heap } from '../nav/path';
import { createNoise2D, fbm, smoothstep } from '../math/noise';
import { type Entrance, townDistance, WATER_LEVEL, type Wilderness } from './generator';
import { ruinInCell } from './ruins';
import { SPAWN_CENTER as SPAWN, SPAWN_STONE_RADIUS, spawnStoneDistance } from './spawn-circle';
import { createSettlementLinks } from './settlement-links';

/** A plank bridge carrying a path over a river: a deck along x from x0 to x1 at z. */
export interface Bridge {
  readonly x0: number;
  readonly x1: number;
  readonly z: number;
  /** Top of the deck. */
  readonly y: number;
  /** Half the deck's width. */
  readonly half: number;
}

export interface Trail {
  readonly id: string;
  /** Metres across. */
  readonly width: number;
  /** The centre line, x and z interleaved, a point every few metres. */
  readonly pts: readonly number[];
  readonly bridges: readonly Bridge[];
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface PathNetwork {
  /** Prewarm route searches one at a time before streaming terrain samples. */
  prepare(x0: number, z0: number, x1: number, z1: number): Generator<void, readonly Trail[], void>;
  /** Paths whose bounds overlap the box. */
  trailsNear(x0: number, z0: number, x1: number, z1: number): readonly Trail[];
  /** Metres from (x, z) to the edge of the nearest path: negative on it, Infinity far off. */
  edgeDistance(x: number, z: number): number;
  /** The bridge whose deck is over (x, z), if any. */
  bridgeAt(x: number, z: number): Bridge | null;
  /** Cut the uphill bank and fill the downhill shoulder at a terrain mesh corner. */
  groundAt(x: number, z: number, natural: number): number;
}

const ROAD = 2.6;
const TRACK = 1.8;
/** Paths keep this far (metres) outside towns they pass. */
const TOWN_ROOM = 22;
/** Metres a path runs straight out of a gate before it starts to wander. */
const GATE_RUN = 16;
/** The route search: grid step and how far either side of the straight line it may stray. */
const GRID = 16;
const CORRIDOR = 260;
/** Deep water is crossed only along every second row of the search grid (which every path
 * shares), so paths that cross a river near each other come to the same spot and one bridge
 * serves them all, instead of each building its own a few strides from the last. */
const CROSSING_ROWS = 2;
/** Water deeper than this (metres) cannot be waded: a path crosses it by bridge. */
const DEEP = 0.45;
/** The longest bridge a path will have, metres. */
const MAX_BRIDGE = 70;
/** How far along each bank to look for a dry connection to the bridge. */
const APPROACH_POINTS = 28;

type Pt = { x: number; z: number };
/** Bucket size for the distance lookups, metres. */
const BUCKET = 64;
// A bench wider than the visible footpath leaves room for its 4 m terrain triangles.
const BENCH = TUNING.world.cellSize;
const SHOULDER = 9;
export const MAX_EARTHWORK = 3.5;

const S = TUNING.structures;
const SIZE = TUNING.world.chunkSize;
const CITY_SPAN = S.cityGrid * SIZE;
const RUIN_SPAN = S.ruinGrid * SIZE;

const networks = new WeakMap<Wilderness, PathNetwork>();

/** The path network of a wilderness (built lazily, cached). */
export function pathsOf(w: Wilderness): PathNetwork {
  let net = networks.get(w);
  if (!net) networks.set(w, (net = createNetwork({ ...w, heightAt: w.terrainHeightAt })));
  return net;
}

/** The town grid cell holding world coordinate `v`. */
const cityCell = (v: number): number => Math.floor((v / SIZE + Math.floor(S.cityGrid / 2)) / S.cityGrid);

function createNetwork(w: Wilderness): PathNetwork {
  const linksOf = createSettlementLinks(w);
  const trails = new Map<string, Trail | null>();
  const gates = new Map<string, WorldGate[]>();
  const buckets = new Map<number, number[]>();
  const bridgesBy = new Map<number, Bridge[]>();
  const bedsBy = new Map<number, number[]>();
  const wobble = createNoise2D(hashAt(w.seed, 'trail-wobble'));

  const gatesOf = (e: Entrance): WorldGate[] => {
    let g = gates.get(e.cityId);
    if (!g) gates.set(e.cityId, (g = townGates(e, w)));
    return g;
  };
  /** The gate of a town that best faces a point. */
  const gateToward = (e: Entrance, x: number, z: number): WorldGate => {
    let best = gatesOf(e)[0]!;
    let score = -Infinity;
    for (const g of gatesOf(e)) {
      const dx = x - g.x;
      const dz = z - g.z;
      const s = (g.outX * dx + g.outZ * dz) / (Math.hypot(dx, dz) || 1);
      if (s > score) {
        score = s;
        best = g;
      }
    }
    return best;
  };

  /** Water too deep to wade (a river's channel, a lake): a path needs a bridge over it. */
  const deep = (x: number, z: number): boolean => w.heightAt(x, z) < WATER_LEVEL - DEEP;
  /** Ground at or under the water line: a ford, or a bridge's banks. */
  const wet = (x: number, z: number): boolean => w.heightAt(x, z) < WATER_LEVEL + 0.15;

  /**
   * The cheapest way from a to b over a 16 m grid, like a path walked into being: gentle ground
   * is cheap, climbs cost more, a slow noise makes some ground a little easier so the way wanders,
   * towns are kept out of (except right outside a gate it starts or ends at), shallow water is
   * waded at a price (a ford), and deep water is crossed only straight east–west and at a
   * heavy price, so the way goes round lakes and over rivers at a bridge.
   */
  const route = (a: Pt, b: Pt, gateA: boolean, gateB: boolean): Pt[] | null => {
    // (on the one grid every path searches, so two paths can come to the same crossing)
    const x0 = Math.floor((Math.min(a.x, b.x) - CORRIDOR) / GRID) * GRID;
    const z0 = Math.floor((Math.min(a.z, b.z) - CORRIDOR) / GRID) * GRID;
    const nx = Math.ceil((Math.max(a.x, b.x) + CORRIDOR - x0) / GRID) + 1;
    const nz = Math.ceil((Math.max(a.z, b.z) + CORRIDOR - z0) / GRID) + 1;
    const n = nx * nz;
    const px = (i: number): number => x0 + (i % nx) * GRID;
    const pz = (i: number): number => z0 + Math.floor(i / nx) * GRID;
    const heights = new Float32Array(n).fill(Number.NaN);
    const relief = new Float32Array(n).fill(Number.NaN);
    /** 0 not looked at, 1 open, 2 inside a town's room. */
    const state = new Uint8Array(n);
    const height = (i: number): number => {
      if (Number.isNaN(heights[i]!)) heights[i] = w.heightAt(px(i), pz(i));
      return heights[i]!;
    };
    const steepness = (i: number): number => {
      if (Number.isNaN(relief[i])) {
        // Reuse the route grid's samples instead of four new terrain queries per node.
        const ix = i % nx,
          iz = Math.floor(i / nx);
        const left = ix ? i - 1 : i,
          right = ix + 1 < nx ? i + 1 : i;
        const north = iz ? i - nx : i,
          south = iz + 1 < nz ? i + nx : i;
        relief[i] = Math.hypot(
          (height(right) - height(left)) / ((right - left) * GRID),
          (height(south) - height(north)) / (((south - north) / nx) * GRID),
        );
      }
      return relief[i]!;
    };
    const open = (i: number): boolean => {
      if (!state[i]) {
        const x = px(i);
        const z = pz(i);
        // a gate's own way out starts inside the room kept round its town
        const nearEnd =
          (gateA && Math.hypot(x - a.x, z - a.z) < 30) || (gateB && Math.hypot(x - b.x, z - b.z) < 30);
        const town = !nearEnd && w.entrancesNear(x, z, 1).some((e) => townDistance(e, x, z) < TOWN_ROOM);
        state[i] = town ? 2 : 1;
      }
      return state[i] === 1;
    };
    const at = (x: number, z: number): number =>
      Math.min(nz - 1, Math.max(0, Math.round((z - z0) / GRID))) * nx +
      Math.min(nx - 1, Math.max(0, Math.round((x - x0) / GRID)));
    const start = at(a.x, a.z);
    const goal = at(b.x, b.z);
    const cost = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const heap = new Heap();
    cost[start] = 0;
    heap.push(start, 0);
    const ford = WATER_LEVEL;
    const channel = WATER_LEVEL - DEEP;
    let pops = 0;
    while (heap.size && pops++ < n * 2) {
      const i = heap.pop();
      if (i === goal) break;
      const ix = i % nx;
      const iz = Math.floor(i / nx);
      const hi = height(i);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
          const j = jz * nx + jx;
          if (!open(j)) continue;
          const hj = height(j);
          // (a stream narrower than the grid lies between two dry points: look between them too)
          const between =
            hi < channel || hj < channel ? 0 : w.heightAt((px(i) + px(j)) / 2, (pz(i) + pz(j)) / 2);
          const inDeep = hi < channel || hj < channel || between < channel;
          const inWater = hi < ford || hj < ford;
          // over deep water only straight east–west, so a bridge can carry it
          if (inDeep && (dz || Math.round(pz(i) / GRID) % CROSSING_ROWS !== 0)) continue;
          const run = GRID * (dx && dz ? Math.SQRT2 : 1);
          const slope = Math.abs(hj - hi) / run;
          const ease = 1 + 0.4 * (fbm(wobble, px(j) / 220, pz(j) / 220, 2) + 1);
          // Contour walking can have zero ascent but still cling to a cliff. Price the
          // bank's steepness too: a shallow cut/fill bench is preferable to a tall embankment.
          const bank = inWater || inDeep ? 0 : Math.max(0, Math.max(steepness(i), steepness(j)) - 0.18);
          const c =
            cost[i]! +
            run * ease * (1 + 45 * slope * slope + 24 * bank * bank) * (inDeep ? 40 : inWater ? 3 : 1);
          if (c >= cost[j]!) continue;
          cost[j] = c;
          from[j] = i;
          heap.push(j, c + Math.hypot(px(j) - b.x, pz(j) - b.z));
        }
    }
    // no way through (water and towns all round): no path, rather than one through a town
    if (from[goal] === -1 && goal !== start) return null;
    const out: Pt[] = [];
    for (let i = goal; i !== -1 && i !== start; i = from[i]!) out.push({ x: px(i), z: pz(i) });
    out.reverse();
    // the exact ends, not the grid points nearest them (nor a grid point right beside an end,
    // which would put a kink in the way there)
    out.pop();
    const clear = (p: Pt, e: Pt): boolean => Math.hypot(p.x - e.x, p.z - e.z) > GRID * 1.25;
    return [a, ...out.filter((p) => clear(p, a) && clear(p, b)), b];
  };

  /** Chaikin corner cutting, ends kept. */
  const smooth = (pts: { x: number; z: number }[]): { x: number; z: number }[] => {
    const out = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(pts[pts.length - 1]!);
    return out;
  };

  /**
   * A path from `from` to `to`. A gate end leaves straight out of its gate; a plain end (a
   * ruin, spawn) is reached directly.
   */
  const build = (
    id: string,
    width: number,
    from: { x: number; z: number; outX?: number; outZ?: number },
    to: { x: number; z: number; outX?: number; outZ?: number },
  ): Trail | null => {
    const lead = (p: typeof from): { x: number; z: number }[] =>
      p.outX === undefined
        ? [{ x: p.x, z: p.z }]
        : [
            { x: p.x + p.outX * 3, z: p.z + p.outZ! * 3 },
            { x: p.x + p.outX * GATE_RUN, z: p.z + p.outZ! * GATE_RUN },
          ];
    const head = lead(from);
    const tail = lead(to).reverse();
    const a = head[head.length - 1]!;
    const b = tail[0]!;
    const way = route(a, b, from.outX !== undefined, to.outX !== undefined);
    if (!way) return null;
    const curve = smooth(smooth([...head.slice(0, -1), ...way, ...tail.slice(1)]));
    // a point every 2.5 m or closer, so the ribbon hugs the ground and no dip into deep water
    // between points goes unnoticed
    const pts: Pt[] = [];
    const segment = (out: Pt[], p: Pt, q: Pt): void => {
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      if (length < 1e-6) return;
      const n = Math.ceil(length / 2.5);
      for (let j = 0; j < n; j++)
        out.push({ x: p.x + ((q.x - p.x) * j) / n, z: p.z + ((q.z - p.z) * j) / n });
    };
    for (let i = 0; i < curve.length - 1; i++) segment(pts, curve[i]!, curve[i + 1]!);
    pts.push(curve[curve.length - 1]!);

    // each stretch over deep water runs straight east–west on a bridge from bank to bank, easing
    // back into its way beyond; shallow water is a ford, waded
    const bridges: Bridge[] = [];
    const joined: Pt[] = [];
    let next = 0;
    const dryLink = (a: Pt, b: Pt): boolean => {
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
      for (let k = 0; k <= n; k++)
        if (w.heightAt(a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n) < WATER_LEVEL + 0.05)
          return false;
      return true;
    };
    for (let i = 0; i < pts.length; i++) {
      if (!deep(pts[i]!.x, pts[i]!.z)) continue;
      let j = i;
      while (j + 1 < pts.length && wet(pts[j + 1]!.x, pts[j + 1]!.z)) j++;
      while (i > next && wet(pts[i - 1]!.x, pts[i - 1]!.z)) i--;
      const run = pts.slice(i, j + 1);
      const deepest = run.reduce((m, p) => (w.heightAt(p.x, p.z) < w.heightAt(m.x, m.z) ? p : m));
      // (on the crossing row the search took, exactly: every path over it then has the same deck)
      const row = Math.round(deepest.z / (GRID * CROSSING_ROWS)) * GRID * CROSSING_ROWS;
      const z = Math.abs(row - deepest.z) < GRID / 2 ? row : deepest.z;
      // the deck runs along this line from bank to bank: walk out from the deepest water each way
      // till the ground is dry (the path's own points may wade along a bank instead)
      const center = Math.round(deepest.x * 2) / 2;
      let lo = center;
      let hi = center;
      while (wet(lo, z) && deepest.x - lo < MAX_BRIDGE) lo -= 0.5;
      while (wet(hi, z) && hi - deepest.x < MAX_BRIDGE) hi += 0.5;
      lo -= 2;
      hi += 2;
      // a long bridge over a lake would look built for a town, not a footpath: no path instead
      if (hi - lo > MAX_BRIDGE) return null;
      const y = Math.max(w.heightAt(lo, z), w.heightAt(hi, z), WATER_LEVEL + 0.6) + 0.15;
      // the deck is level: on the lower bank it runs on until the ground comes up to meet it,
      // rather than ending in the air
      for (let k = 0; k < 30 && w.heightAt(lo, z) < y - 0.12; k++) lo -= 0.5;
      for (let k = 0; k < 30 && w.heightAt(hi, z) < y - 0.12; k++) hi += 0.5;
      if (hi - lo > MAX_BRIDGE + 6) return null;

      // Use the finished deck ends as actual trail vertices, after extending the deck to meet
      // the banks. Sampling the approaches keeps the dirt on land up to the first plank.
      const east = pts[j]!.x > pts[i]!.x;
      const entry = { x: east ? lo : hi, z };
      const exit = { x: east ? hi : lo, z };
      const sign = east ? 1 : -1;
      const approach = (end: Pt, from: number, dir: -1 | 1, side: number) => {
        const bank = { x: end.x + side * 1.5, z };
        if (!dryLink(end, bank)) return null;
        for (let k = from; k >= next && k < pts.length && Math.abs(k - from) < APPROACH_POINTS; k += dir) {
          const p = pts[k]!;
          if ((p.x - bank.x) * side >= 0 && dryLink(p, bank)) return { k, points: [bank] };
          // A road that follows the bank may need to turn back after clearing the rail.
          if (Math.abs(p.z - z) > width + 1.5) {
            const corner = { x: bank.x, z: z + Math.sign(p.z - z) * (width + 1.5) };
            if (dryLink(bank, corner) && dryLink(corner, p)) return { k, points: [bank, corner] };
          }
          if (dir === 1 && deep(p.x, p.z)) break;
        }
        return null;
      };
      const before = approach(entry, i - 1, -1, -sign);
      const after = approach(exit, j + 1, 1, sign);
      if (!before || !after) return null;
      if ([lo, hi].some((x) => Math.abs(w.heightAt(x, z) - y) > TUNING.player.stepHeight - 0.1)) return null;
      joined.push(...pts.slice(next, before.k));
      const crossing = [
        pts[before.k]!,
        ...before.points.reverse(),
        entry,
        exit,
        ...after.points,
        pts[after.k]!,
      ];
      for (let k = 0; k + 1 < crossing.length; k++) segment(joined, crossing[k]!, crossing[k + 1]!);
      bridges.push({ x0: lo, x1: hi, z, y, half: width / 2 + 0.4 });
      next = after.k;
      i = next - 1;
    }
    joined.push(...pts.slice(next));
    const dense = joined.flatMap((p) => [p.x, p.z]);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < dense.length; i += 2) {
      minX = Math.min(minX, dense[i]!);
      maxX = Math.max(maxX, dense[i]!);
      minZ = Math.min(minZ, dense[i + 1]!);
      maxZ = Math.max(maxZ, dense[i + 1]!);
    }
    return { id, width, pts: dense, bridges, minX, maxX, minZ, maxZ };
  };

  const trail = (id: string, make: () => Trail | null): Trail | null => {
    if (!trails.has(id)) trails.set(id, make());
    return trails.get(id)!;
  };

  /** The road from town cell (gx, gz) to the next cell east (dx 1) or south (dz 1). */
  const road = (gx: number, gz: number, dx: number, dz: number): Trail | null =>
    trail(`t${gx}_${gz}${dx ? 'e' : 's'}`, () => {
      const a = w.entranceInCell(gx, gz);
      const b = w.entranceInCell(gx + dx, gz + dz);
      if (!a || !b) return null;
      return build(`t${gx}_${gz}${dx ? 'e' : 's'}`, ROAD, gateToward(a, b.x, b.z), gateToward(b, a.x, a.z));
    });

  /** The track from a ruin to its nearest town. */
  const ruinTrack = (rx: number, rz: number): Trail | null =>
    trail(`r${rx}_${rz}`, () => {
      const r = ruinInCell(w, rx, rz);
      if (!r) return null;
      const towns = w.entrancesNear(r.x, r.z, 1);
      if (!towns.length) return null;
      const town = towns.reduce((m, e) =>
        Math.hypot(e.x - r.x, e.z - r.z) < Math.hypot(m.x - r.x, m.z - r.z) ? e : m,
      );
      // stop at the ruin's edge, not in the middle of its stones
      const g = gateToward(town, r.x, r.z);
      const d = Math.hypot(g.x - r.x, g.z - r.z) || 1;
      return build(`r${rx}_${rz}`, TRACK, g, {
        x: r.x + ((g.x - r.x) / d) * 9,
        z: r.z + ((g.z - r.z) / d) * 9,
      });
    });

  /** From spawn to the first town, over the first river. */
  const firstPath = (): Trail | null =>
    trail('spawn', () => {
      const [cx, cz] = S.firstCityChunk;
      const town = w.entrancesNear((cx + 0.5) * SIZE, (cz + 0.5) * SIZE, 0)[0];
      if (!town) return null;
      const road = build('spawn', ROAD, { x: SPAWN + 6, z: SPAWN }, gateToward(town, SPAWN, SPAWN));
      if (!road) return null;
      // Run the dirt a little under the paving so its tapered end is hidden.
      const join = SPAWN + SPAWN_STONE_RADIUS - 0.8;
      return { ...road, pts: [join, SPAWN, ...road.pts], minX: Math.min(join, road.minX) };
    });

  function* prepare(x0: number, z0: number, x1: number, z1: number): Generator<void, Trail[], void> {
    const out: Trail[] = [];
    const add = (t: Trail | null): void => {
      if (t && t.maxX >= x0 && t.minX <= x1 && t.maxZ >= z0 && t.minZ <= z1) out.push(t);
    };
    if (w.terrainVersion >= 5) {
      const seen = new Set<string>();
      // A link spans at most two cells; allow another for the routing corridor.
      for (let gx = cityCell(x0) - 3; gx <= cityCell(x1) + 3; gx++)
        for (let gz = cityCell(z0) - 3; gz <= cityCell(z1) + 3; gz++) {
          const town = w.entranceInCell(gx, gz);
          if (town)
            for (const { id, a, b } of linksOf(town)) {
              if (seen.has(id)) continue;
              seen.add(id);
              // Do not run A* for roads which cannot possibly enter this query.
              const pad = Math.max(a.size, b.size) / 2 + CORRIDOR + GRID + GATE_RUN + TOWN_ROOM;
              if (
                Math.max(a.x, b.x) + pad < x0 ||
                Math.min(a.x, b.x) - pad > x1 ||
                Math.max(a.z, b.z) + pad < z0 ||
                Math.min(a.z, b.z) - pad > z1
              )
                continue;
              add(trail(id, () => build(id, ROAD, gateToward(a, b.x, b.z), gateToward(b, a.x, a.z))));
              yield;
            }
          yield;
        }
    } else
      for (let gx = cityCell(x0) - 1; gx <= cityCell(x1) + 1; gx++)
        for (let gz = cityCell(z0) - 1; gz <= cityCell(z1) + 1; gz++) {
          add(road(gx, gz, 1, 0));
          yield;
          add(road(gx, gz, 0, 1));
          yield;
        }
    // a ruin's track can reach most of a town cell from it
    for (
      let rx = Math.floor((x0 - CITY_SPAN) / RUIN_SPAN);
      rx <= Math.floor((x1 + CITY_SPAN) / RUIN_SPAN);
      rx++
    )
      for (
        let rz = Math.floor((z0 - CITY_SPAN) / RUIN_SPAN);
        rz <= Math.floor((z1 + CITY_SPAN) / RUIN_SPAN);
        rz++
      ) {
        add(ruinTrack(rx, rz));
        yield;
      }
    if (x0 < CITY_SPAN && z0 < CITY_SPAN && x1 > -CITY_SPAN && z1 > -CITY_SPAN) add(firstPath());
    return out;
  }
  const trailsNear = (x0: number, z0: number, x1: number, z1: number): Trail[] => {
    const steps = prepare(x0, z0, x1, z1);
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
  };

  /** Segments (ax, az, bx, bz, half width) near a bucket, and the bridges over it. */
  const bucket = (bx: number, bz: number): number[] => {
    const key = (bx + 32768) * 65536 + (bz + 32768);
    let segs = buckets.get(key);
    if (segs) return segs;
    if (buckets.size > 4096) {
      buckets.clear();
      bridgesBy.clear();
      bedsBy.clear();
    }
    segs = [];
    const bridges: Bridge[] = [];
    const beds: number[] = [];
    const x0 = bx * BUCKET;
    const z0 = bz * BUCKET;
    const pad = Math.max(ROAD + BENCH + SHOULDER, 24);
    for (const t of trailsNear(x0 - pad, z0 - pad, x0 + BUCKET + pad, z0 + BUCKET + pad)) {
      const p = t.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i]!;
        const az = p[i + 1]!;
        const qx = p[i + 2]!;
        const qz = p[i + 3]!;
        if (Math.max(ax, qx) < x0 - pad || Math.min(ax, qx) > x0 + BUCKET + pad) continue;
        if (Math.max(az, qz) < z0 - pad || Math.min(az, qz) > z0 + BUCKET + pad) continue;
        segs.push(ax, az, qx, qz, t.width / 2);
        const ha = w.heightAt(ax, az),
          hb = w.heightAt(qx, qz);
        // Leave water crossings and their approaches untouched. Fade out excavation
        // at trail ends so existing town gates and ruin foundations remain connected.
        if (
          Math.min(ha, hb) > WATER_LEVEL + 0.5 &&
          !t.bridges.some(
            (b) =>
              Math.max(ax, qx) >= b.x0 - 8 &&
              Math.min(ax, qx) <= b.x1 + 8 &&
              Math.min(Math.abs(az - b.z), Math.abs(qz - b.z)) < b.half + 8,
          )
        ) {
          const fade = (x: number, z: number) =>
            smoothstep(
              0,
              18,
              Math.min(
                Math.hypot(x - p[0]!, z - p[1]!),
                Math.hypot(x - p[p.length - 2]!, z - p[p.length - 1]!),
              ),
            );
          beds.push(ax, az, qx, qz, t.width / 2 + BENCH, ha, hb, fade(ax, az), fade(qx, qz));
        }
      }
      bridges.push(...t.bridges);
    }
    buckets.set(key, segs);
    bridgesBy.set(key, bridges);
    bedsBy.set(key, beds);
    return segs;
  };

  return {
    prepare,
    trailsNear,
    groundAt(x, z, natural) {
      const bx = Math.floor(x / BUCKET),
        bz = Math.floor(z / BUCKET);
      bucket(bx, bz);
      const beds = bedsBy.get((bx + 32768) * 65536 + bz + 32768)!;
      // A neighbouring trail must not fill or excavate another trail's bridge landing.
      // Keep a full terrain-cell margin; interpolate() also reads corners beside the deck.
      let landing = 1;
      for (const b of bridgesBy.get((bx + 32768) * 65536 + bz + 32768) ?? []) {
        const d = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(Math.abs(z - b.z) - b.half, 0));
        landing = Math.min(landing, smoothstep(6, 18, d));
      }
      if (!landing) return natural;
      let total = 0,
        sum = 0,
        strength = 0;
      for (let i = 0; i < beds.length; i += 9) {
        const ax = beds[i]!,
          az = beds[i + 1]!,
          dx = beds[i + 2]! - ax,
          dz = beds[i + 3]! - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        const half = beds[i + 4]!;
        const fade = beds[i + 7]! * (1 - t) + beds[i + 8]! * t;
        const influence = (1 - smoothstep(half, half + SHOULDER, d)) * fade;
        if (influence <= 0) continue;
        const h = beds[i + 5]! * (1 - t) + beds[i + 6]! * t;
        // Nearby short segments form one continuous bench, also at bends/junctions.
        const weight = influence / (0.05 + d * d);
        sum += Math.max(-MAX_EARTHWORK, Math.min(MAX_EARTHWORK, h - natural)) * weight;
        total += weight;
        strength = Math.max(strength, influence);
      }
      return total ? natural + (sum / total) * strength * landing : natural;
    },
    edgeDistance(x, z) {
      const s = bucket(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
      let best = spawnStoneDistance(x, z);
      for (let i = 0; i < s.length; i += 5) {
        const ax = s[i]!;
        const az = s[i + 1]!;
        const dx = s[i + 2]! - ax;
        const dz = s[i + 3]! - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - s[i + 4]!;
        if (d < best) best = d;
      }
      return best;
    },
    bridgeAt(x, z) {
      const bx = Math.floor(x / BUCKET);
      const bz = Math.floor(z / BUCKET);
      bucket(bx, bz);
      const key = (bx + 32768) * 65536 + (bz + 32768);
      for (const b of bridgesBy.get(key) ?? [])
        if (x >= b.x0 && x <= b.x1 && Math.abs(z - b.z) <= b.half) return b;
      return null;
    },
  };
}
