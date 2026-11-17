// Step 4 of a town's layout: houses along both sides of every street, turned to face it, each
// on a level pad, clear of the paving, the river and each other. Shops gather round the square
// and barns sit out towards the fields; some cottages get a fenced front garden.
import { BUILDINGS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import type { Square } from './gates';
import { type Face, type Point, ROAD_NONE, type Site } from './site';
import { BUCKET, type StreetPlan, bucketKey } from './streets';

export interface Building {
  readonly id: number;
  /** Centre of the footprint, metres. */
  readonly x: number;
  readonly z: number;
  /** Half the width along the front, and half the depth. */
  readonly hw: number;
  readonly hd: number;
  /** The way the front faces: (sin angle, cos angle). In the house's own frame the front is
   * +z and the door is in the middle of it. */
  readonly angle: number;
  /** Height of its level pad: the floor. */
  readonly base: number;
  /** Lowest ground under its footprint: where its plinth starts. */
  readonly foot: number;
  /** Ground in front of the door. */
  readonly step: number;
  /** Eaves above the floor. */
  readonly height: number;
  readonly template: number;
  /** Depth of a fenced front garden before the door, metres; 0 for none. */
  readonly garden: number;
  /** Surface ids, by face in the house's own frame (pz is the front). */
  readonly walls: Readonly<Record<Face, number>>;
  readonly roof: number;
  readonly door: number;
}

/** The shallowest front garden worth a fence, metres. */
const GARDEN_MIN = 1.1;

type Rect = Pick<Building, 'x' | 'z' | 'angle' | 'hw' | 'hd'>;

/** Whether two turned rectangles overlap: no gap along any of their four edge directions. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  const corners = (r: Rect): Point[] => {
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => ({ x: r.x + c * u! * r.hw + s * v! * r.hd, z: r.z - s * u! * r.hw + c * v! * r.hd }));
  };
  const ca = corners(a);
  const cb = corners(b);
  for (const r of [a, b]) {
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    for (const [ax, az] of [
      [c, -s],
      [s, c],
    ] as const) {
      const span = (pts: Point[]): [number, number] => {
        const d = pts.map((p) => p.x * ax + p.z * az);
        return [Math.min(...d), Math.max(...d)];
      };
      const [a0, a1] = span(ca);
      const [b0, b1] = span(cb);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

/** Walk every street, a house's width and a gap at a time, and stand a house on each side
 * where one fits. `buildingOf` is building id + 1 per cell (0 = none). */
export function placeHouses(
  site: Site,
  plan: StreetPlan,
  square: Square,
): { buildings: Building[]; buildingOf: Uint16Array } {
  const cfg = TUNING.city;
  const H = cfg.houses;
  const { n, cell, size, rng, idx, inside, water, ground } = site;
  const { roads, streets, segments } = plan;
  const buildingOf = new Uint16Array(n * n);
  const buildings: Building[] = [];
  const pickTemplate = (centrality: number): number => {
    // shops gather round the square, barns sit out towards the fields
    const weight = (t: number): number => {
      const key = BUILDINGS[t]!.key;
      return (
        BUILDINGS[t]!.weight * (key === 'barn' ? 1.6 - centrality : key === 'shop' ? 0.4 + centrality : 1)
      );
    };
    const weights = BUILDINGS.map((_, t) => weight(t));
    let r = rng.next() * weights.reduce((a, b) => a + b, 0);
    for (let t = 0; t < BUILDINGS.length; t++) if ((r -= weights[t]!) <= 0) return t;
    return 0;
  };
  const range = (r: readonly number[]): number => r[0]! + (r[1]! - r[0]!) * rng.next();
  /** Cells whose centre lies within the turned rectangle grown by `margin` (-1 off the map). */
  const cellsUnder = (
    x: number,
    z: number,
    angle: number,
    hw: number,
    hd: number,
    margin: number,
  ): number[] => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const ex = Math.abs(c) * (hw + margin) + Math.abs(s) * (hd + margin);
    const ez = Math.abs(s) * (hw + margin) + Math.abs(c) * (hd + margin);
    const out: number[] = [];
    for (let iz = Math.floor((z - ez) / cell); iz <= Math.floor((z + ez) / cell); iz++)
      for (let ix = Math.floor((x - ex) / cell); ix <= Math.floor((x + ex) / cell); ix++) {
        const dx = (ix + 0.5) * cell - x;
        const dz = (iz + 0.5) * cell - z;
        // into the house's own frame
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) > hw + margin || Math.abs(lz) > hd + margin) continue;
        out.push(ix < 0 || iz < 0 || ix >= n || iz >= n ? -1 : idx(ix, iz));
      }
    return out;
  };
  /** Houses placed so far, by bucket of their centre. */
  const placed = new Map<number, Building[]>();
  /** Whether a turned rectangle keeps `gap` metres clear of every house placed so far. */
  const clearOfHouses = (
    x: number,
    z: number,
    angle: number,
    hw: number,
    hd: number,
    gap: number,
  ): boolean => {
    const reach = 2 * (Math.hypot(hw, hd) + 12);
    for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz++)
      for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx++)
        for (const o of placed.get(bucketKey(bx, bz)) ?? [])
          if (rectsOverlap({ x, z, angle, hw: hw + gap, hd: hd + gap }, o)) return false;
    return true;
  };
  /** Whether a turned rectangle keeps half a metre clear of every street's paving. */
  const clearOfStreets = (x: number, z: number, c: number, s: number, hw: number, hd: number): boolean => {
    const reach = Math.hypot(hw, hd) + cfg.square;
    const local = (p: Point): Point => ({
      x: (p.x - x) * c - (p.z - z) * s,
      z: (p.x - x) * s + (p.z - z) * c,
    });
    for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz++)
      for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx++)
        for (const seg of segments.get(bucketKey(bx, bz)) ?? []) {
          // the segment in the house's own frame, against the house grown by the paving's half
          const a = local(seg.a);
          const b = local(seg.b);
          const ex = hw + seg.half + 0.5;
          const ez = hd + seg.half + 0.5;
          const len = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
          for (let k = 0; k <= len; k++) {
            const px = a.x + ((b.x - a.x) * k) / len;
            const pz = a.z + ((b.z - a.z) * k) / len;
            if (Math.abs(px) < ex && Math.abs(pz) < ez) return false;
          }
        }
    return true;
  };
  /** A house beside the street at `p`, on the side `out` points to; returns its width or 0. */
  const tryHouse = (p: Point, out: Point, roadHalf: number): number => {
    const fromSq = Math.min(1, Math.hypot(p.x - square.x, p.z - square.z) / (size * 0.6));
    if (!rng.chance(H.density[0]! + (H.density[1]! - H.density[0]!) * fromSq)) return 0;
    const t = pickTemplate(1 - fromSq);
    const tpl = BUILDINGS[t]!;
    const scale = tpl.key === 'barn' ? 1.3 : tpl.key === 'shop' ? 1.1 : 1;
    const hw = (range(H.width) * scale) / 2;
    const hd = (range(H.depth) * scale) / 2;
    const setback = range(H.setback);
    const back = roadHalf + setback + hd;
    const x = p.x + out.x * back;
    const z = p.z + out.z * back;
    // the front looks back at the street
    const angle = Math.atan2(-out.x, -out.z);
    const under = cellsUnder(x, z, angle, hw, hd, 0.4);
    const blocked = (i: number): boolean =>
      i < 0 || !inside(i % n, Math.floor(i / n)) || roads[i] !== ROAD_NONE || buildingOf[i] !== 0;
    if (!under.length || under.some(blocked)) return 0;
    // keep a little room between neighbours, and off the river bank
    if (cellsUnder(x, z, angle, hw, hd, 1.6).some((i) => i >= 0 && (buildingOf[i] !== 0 || water[i] !== 0)))
      return 0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    if (!clearOfStreets(x, z, c, s, hw, hd) || !clearOfHouses(x, z, angle, hw, hd, 1.2)) return 0;
    /** A point in the house's own frame, in the town. */
    const at = (u: number, v: number): Point => ({ x: x + c * u + s * v, z: z - s * u + c * v });
    let lo = Infinity;
    let hi = -Infinity;
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 0],
    ] as const) {
      const q = at(u * hw, v * hd);
      const h = ground(q.x, q.z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > H.maxRise) return 0;
    // no corner out over the river either (the margin above only checks cells' middles)
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const q = at(u * (hw + 1), v * (hd + 1));
      const ix = Math.floor(q.x / cell);
      const iz = Math.floor(q.z / cell);
      if (ix < 0 || iz < 0 || ix >= n || iz >= n || water[idx(ix, iz)]) return 0;
    }
    const id = buildings.length;
    for (const i of under) buildingOf[i] = id + 1;
    const floors = rng.int(tpl.paintFloors.min, tpl.paintFloors.max);
    const paintHeight = floors * H.floorHeight;
    const chunk = site.chunkOf(x, z);
    const wall = rng.pick(tpl.walls);
    const side = (u: number, v: number, len: number): number => {
      const f = at(u, v);
      return site.addSurface('wall', chunk, wall, len * paintHeight, f.x, f.z);
    };
    const walls = {
      px: side(hw, 0, 2 * hd),
      nx: side(-hw, 0, 2 * hd),
      pz: side(0, hd, 2 * hw),
      nz: side(0, -hd, 2 * hw),
    };
    const roof = site.addSurface('roof', chunk, rng.pick(tpl.roofs), 4 * hw * hd, x, z);
    const front = at(0, hd);
    const door = site.addSurface('door', chunk, rng.pick(tpl.doors), 1.6 * 2.4, front.x, front.z);
    const stepAt = at(0, hd + 1.2);
    // a fenced front garden, filling the front yard up to just short of the street
    const depth = setback - 0.6;
    const plot = at(0, hd + depth / 2);
    const garden =
      depth >= GARDEN_MIN &&
      rng.chance(tpl.key === 'cottage' ? 0.6 : 0.3) &&
      clearOfStreets(plot.x, plot.z, c, s, hw + 0.5, depth / 2)
        ? depth
        : 0;
    const key = bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET));
    let near = placed.get(key);
    if (!near) placed.set(key, (near = []));
    buildings.push({
      id,
      x,
      z,
      hw,
      hd,
      angle,
      base: hi + 0.12,
      foot: lo,
      step: ground(stepAt.x, stepAt.z),
      height: tpl.eaves + (floors - tpl.paintFloors.min) * 0.35,
      template: t,
      garden,
      walls,
      roof,
      door,
    });
    near.push(buildings[id]!);
    return 2 * hw;
  };
  for (const st of streets) {
    if (st.points.length < 2) continue;
    for (const sideSign of [1, -1]) {
      // walk along the street, a house's width and a gap at a time
      let carry = 4 + rng.next() * 4;
      for (let k = 0; k < st.points.length - 1; k++) {
        const a = st.points[k]!;
        const b = st.points[k + 1]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 1e-6) continue;
        const tx = (b.x - a.x) / len;
        const tz = (b.z - a.z) / len;
        const out = { x: -tz * sideSign, z: tx * sideSign };
        let s = carry;
        while (s < len) {
          const width = tryHouse({ x: a.x + tx * s, z: a.z + tz * s }, out, st.width / 2);
          s += width ? width + range(H.gap) : 3;
        }
        carry = s - len;
      }
    }
  }
  return { buildings, buildingOf };
}
