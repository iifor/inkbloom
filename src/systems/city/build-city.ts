// A town as one static mesh and its colliders, where it stands in the world: its ground laid
// over the land's own triangles (yards carry their surfaces), streets as strips draped over it,
// country houses turned to face their street on stone plinths, and the low wall round it.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { BUILDINGS } from '@/content/templates';
import { type ColliderData, type Vec3Like, turnedBox } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { WATER_LEVEL } from '@/world/wilderness/generator';
import {
  GATE_HALF,
  ROAD_MAIN,
  ROAD_NONE,
  WET,
  groundAt,
  type Building,
  type CityLayout,
} from '@/world/city/layout';
import { appendTree, treeMatrix, treePalette } from '../wilderness/tree-geometry';
import { buildCountryHouse } from './country-house';

/** Where buildCity puts colliders: a PhysicsWorld, or a recorder in the city worker. */
export interface ColliderSink {
  addBox(group: string, min: Vec3Like, max: Vec3Like, data?: ColliderData): unknown;
}

/** Collider group a town's walls and houses go in, so they leave with it. */
export const cityGroup = (id: string): string => `city:${id}`;

/** How far each kind of paving floats over the ground, so crossings never flicker. */
const LIFT = { square: 0.13, 3: 0.11, 2: 0.1, 1: 0.09 } as const;
/** Street strips are cut at most this far apart along their length, to follow the land. */
const STRIP_STEP = 2;
const UP = { x: 0, y: 1, z: 0 };
/** Bridges: how high the deck stands over the water at the least, how much it arches over a
 * long span, how thick the deck is, and its railings. */
const BRIDGE = { clearance: 0.7, arch: 0.07, maxArch: 1.4, deck: 0.45, rail: 0.95 } as const;
/** Garden fences: height, spacing of posts, and half the path's gap at the gate. */
const FENCE = { height: 0.95, post: 1.1, gate: 1.3 } as const;
/** Steps down to the river beside a bridge: rise and tread of each. */
const STEP = { rise: 0.3, tread: 0.55 } as const;

/** A box turned about +y (its own +z along `angle`), in one colour. */
function turnedSolid(g: GeometryBuilder, at: Vec3Like, angle: number, half: Vec3Like, tint: number): void {
  const b = new GeometryBuilder();
  const all = { px: tint, nx: tint, py: tint, ny: tint, pz: tint, nz: tint };
  b.box({ x: -half.x, y: -half.y, z: -half.z }, { x: half.x, y: half.y, z: half.z }, all);
  g.append(b, new THREE.Matrix4().makeRotationY(angle).setPosition(at.x, at.y, at.z));
}

/** A quad of four corners in order round it, wound to face up whichever way they go round. */
function upQuad(
  g: GeometryBuilder,
  q: readonly [Vec3Like, Vec3Like, Vec3Like, Vec3Like],
  normals: readonly [Vec3Like, Vec3Like, Vec3Like, Vec3Like],
  tint: number,
): void {
  const [a, b, c, d] = q;
  const cross = (b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x);
  if (cross > 0) g.quadSmooth(a, d, c, b, [normals[0], normals[3], normals[2], normals[1]], tint);
  else g.quadSmooth(a, b, c, d, normals, tint);
}

/** One district's share of a town: drawn in full near by, and with its houses as shells (no
 * window frames, doors or flower boxes) from far off. Ground, streets and walls are in both. */
export interface CityTile {
  readonly full: GeometryBuilder;
  readonly far: GeometryBuilder;
}

/** A town's geometry, a tile per district, so the camera and the sun's shadow camera draw only
 * the tiles they see. Colliders go to `physics` once. */
export function buildCity(city: CityLayout, physics: ColliderSink): CityTile[] {
  const group = cityGroup(city.id);
  const { n, cell, roads, groundOf, ox, oz, heights, chunks, water } = city;
  const tiles = Array.from({ length: chunks * chunks }, () => ({
    base: new GeometryBuilder(),
    full: new GeometryBuilder(),
    far: new GeometryBuilder(),
  }));
  const per = city.size / chunks;
  const side = (v: number): number => Math.min(chunks - 1, Math.max(0, Math.floor(v / per)));
  const tileAt = (x: number, z: number) => tiles[side(z - oz) * chunks + side(x - ox)]!;
  const corner = (kx: number, kz: number): number => heights[kz * (n + 1) + kx]!;
  const ground = (x: number, z: number): number => groundAt(city, x, z);
  const normalAt = (x: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(
      ground(x - 1, z) - ground(x + 1, z),
      2,
      ground(x, z - 1) - ground(x, z + 1),
    ).normalize();

  // ground: the land's own two triangles per cell, so it lies exactly over the terrain
  const kNormal = (kx: number, kz: number): THREE.Vector3 =>
    new THREE.Vector3(
      corner(Math.max(0, kx - 1), kz) - corner(Math.min(n, kx + 1), kz),
      2 * cell,
      corner(kx, Math.max(0, kz - 1)) - corner(kx, Math.min(n, kz + 1)),
    ).normalize();
  const grass = color('grass');
  const riverside = (ix: number, iz: number): boolean => {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = ix + dx;
        const z = iz + dz;
        if (x >= 0 && z >= 0 && x < n && z < n && water[z * n + x]) return true;
      }
    return false;
  };
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const surface = groundOf[iz * n + ix]!;
      // the river and its bare banks are left to the land underneath, which is painted with
      // the same sandy shallows as any river in the wild
      if (surface < 0 && riverside(ix, iz)) continue;
      const c = surface >= 0 ? city.surfaces[surface]!.color : grass;
      const P = (kx: number, kz: number): Vec3Like => ({
        x: ox + kx * cell,
        y: corner(kx, kz),
        z: oz + kz * cell,
      });
      // (x+1, z), (x, z), (x, z+1), (x+1, z+1): the diagonal runs (x+1, z)–(x, z+1)
      tileAt(ox + (ix + 0.5) * cell, oz + (iz + 0.5) * cell).base.quadSmooth(
        P(ix + 1, iz),
        P(ix, iz),
        P(ix, iz + 1),
        P(ix + 1, iz + 1),
        [kNormal(ix + 1, iz), kNormal(ix, iz), kNormal(ix, iz + 1), kNormal(ix + 1, iz + 1)],
        c,
        surface,
      );
    }

  // the square: a disc of flagstones
  const sq = city.square;
  const sqTile = tileAt(sq.x, sq.z).base;
  const rim = 28;
  for (let k = 0; k < rim; k++) {
    const a0 = (k / rim) * Math.PI * 2;
    const a1 = ((k + 1) / rim) * Math.PI * 2;
    const ring = (a: number, r: number): Vec3Like => {
      const x = sq.x + Math.cos(a) * r;
      const z = sq.z + Math.sin(a) * r;
      return { x, y: ground(x, z) + LIFT.square, z };
    };
    for (const [r0, r1] of [
      [0, sq.r / 2],
      [sq.r / 2, sq.r],
    ] as const) {
      upQuad(
        sqTile,
        [ring(a0, r0), ring(a0, r1), ring(a1, r1), ring(a1, r0)],
        [UP, UP, UP, UP],
        color('stone'),
      );
    }
  }

  // streets: strips draped over the ground, three points across so they follow its camber
  for (const st of city.streets) {
    if (st.points.length < 2) continue;
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k < st.points.length - 1; k++) {
      const a = st.points[k]!;
      const b = st.points[k + 1]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STRIP_STEP));
      for (let j = 0; j < steps; j++)
        pts.push({ x: a.x + ((b.x - a.x) * j) / steps, z: a.z + ((b.z - a.z) * j) / steps });
    }
    pts.push(st.points[st.points.length - 1]!);
    const lift = LIFT[st.cls];
    const tint = st.cls === ROAD_MAIN ? color('stone') : color('sand');
    // where the street meets the river it goes over on a bridge: rows over the water stand
    // on a deck arching from bank to bank instead of on the ground
    const deck = bridgeDeck(
      pts.map((p) => ground(p.x, p.z)),
      pts,
      lift,
    );
    const rows = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      return [-1, 0, 1].map((u) => {
        const x = p.x + nx * u * (st.width / 2);
        const z = p.z + nz * u * (st.width / 2);
        const y = deck[i] ?? ground(x, z) + lift;
        return { p: { x, y, z }, n: deck[i] === undefined ? normalAt(x, z) : UP };
      });
    });
    for (const span of spansOf(deck)) buildBridge(span, pts, deck, st.width, tileAt, group, physics);
    for (let i = 0; i < rows.length - 1; i++)
      for (let j = 0; j < 2; j++) {
        const a = rows[i]![j]!;
        const b = rows[i]![j + 1]!;
        const c = rows[i + 1]![j + 1]!;
        const d = rows[i + 1]![j]!;
        upQuad(tileAt(a.p.x, a.p.z).base, [a.p, b.p, c.p, d.p], [a.n, b.n, c.n, d.n], tint);
      }
  }

  for (const b of city.buildings) {
    const t = tileAt(b.x, b.z);
    buildHouse(t.full, t.far, city, b, group, physics);
  }

  // yard trees: the wilderness's own, full near by and simplified far off; trunks block
  for (const t of city.trees) {
    const tile = tileAt(t.x, t.z);
    const palette = treePalette(t);
    const m = treeMatrix(t);
    appendTree(tile.full, palette, m, false);
    appendTree(tile.far, palette, m, true);
    physics.addBox(
      group,
      { x: t.x - 0.3, y: t.y, z: t.z - 0.3 },
      { x: t.x + 0.3, y: t.y + t.height * 0.6, z: t.z + 0.3 },
    );
  }

  buildWell(tileAt(sq.x, sq.z).base, { x: sq.x, y: ground(sq.x, sq.z), z: sq.z }, group, physics);

  // a low dry-stone wall round the town, stepping with the land, open at the gates
  const wallColor = color('rock');
  const gateCells = new Set<number>();
  for (const gate of city.gates)
    for (let k = -GATE_HALF; k <= GATE_HALF; k++) {
      const along = gate.dir === 0 || gate.dir === 2;
      gateCells.add(along ? (gate.iz + k) * n + gate.ix : gate.iz * n + gate.ix + k);
    }
  const wall = (ix: number, iz: number): void => {
    // open at the gates, and where a river runs in or out
    if (gateCells.has(iz * n + ix) || roads[iz * n + ix] !== ROAD_NONE || water[iz * n + ix]) return;
    const c = [corner(ix, iz), corner(ix + 1, iz), corner(ix, iz + 1), corner(ix + 1, iz + 1)];
    const min = { x: ox + ix * cell, y: Math.min(...c) - 0.6, z: oz + iz * cell };
    const max = { x: ox + (ix + 1) * cell, y: Math.max(...c) + 1.4, z: oz + (iz + 1) * cell };
    tileAt(min.x + cell / 2, min.z + cell / 2).base.box(min, max, {
      px: wallColor,
      nx: wallColor,
      pz: wallColor,
      nz: wallColor,
      py: grass,
    });
    physics.addBox(group, min, max);
  };
  for (let i = 0; i < n; i++) {
    wall(i, 0);
    wall(i, n - 1);
    if (i > 0 && i < n - 1) {
      wall(0, i);
      wall(n - 1, i);
    }
  }
  const same = new THREE.Matrix4();
  return tiles.map(({ base, full, far }) => {
    full.append(base, same);
    far.append(base, same);
    return { full, far };
  });
}

/** A country house built in its own frame (front +z, floor at 0), then turned and set on its
 * pad, with a stone plinth down to the ground and steps up to the door where it needs them. */
function buildHouse(
  g: GeometryBuilder,
  shell: GeometryBuilder,
  city: CityLayout,
  b: Building,
  group: string,
  physics: ColliderSink,
): void {
  const h = new GeometryBuilder();
  const stone = color('rock');
  const { hw, hd } = b;
  const inset = 0.25;
  const down = b.foot - b.base - 0.4;
  const boxes: { min: Vec3Like; max: Vec3Like; data: ColliderData; slice: number }[] = [];
  const house = {
    x0: -hw,
    x1: hw,
    z0: -hd,
    z1: hd,
    base: 0,
    height: b.height,
    front: 'pz',
    doorAt: 0,
    style: BUILDINGS[b.template]!.key,
    plaster: city.surfaces[b.walls.px]!.color,
    tile: city.surfaces[b.roof]!.color,
    doorColor: city.surfaces[b.door]!.color,
    surfaces: b,
  } as const;
  // the walls reach down through the plinth, so nothing walks in under a house on a slope
  buildCountryHouse(h, house, (min, max, data) =>
    boxes.push({ min: { ...min, y: min.y <= 0 ? down : min.y }, max, data, slice: min.y <= 0 ? 0.8 : 1.6 }),
  );
  const far = new GeometryBuilder();
  buildCountryHouse(far, house, () => {}, false);
  const all = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c });
  for (const k of [h, far])
    k.box({ x: -hw - inset, y: down, z: -hd - inset }, { x: hw + inset, y: 0.03, z: hd + inset }, all(stone));
  // steps down from the door to the street
  const rise = b.base - b.step;
  const flights = rise > 0.35 ? Math.ceil(rise / 0.3) : 0;
  for (let k = 0; k < flights; k++) {
    const top = -k * (rise / flights);
    const min = { x: -1.1, y: down, z: hd + inset };
    const max = { x: 1.1, y: top, z: hd + inset + 0.42 * (k + 1) };
    for (const k of [h, far]) k.box(min, max, all(stone));
    boxes.push({ min, max, data: {}, slice: 0.8 });
  }
  if (b.garden > 0) fenceGarden(h, b, boxes);
  const turn = new THREE.Matrix4().makeRotationY(b.angle).setPosition(b.x, b.base, b.z);
  g.append(h, turn);
  shell.append(far, turn);
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  for (const box of boxes) {
    // the box's own middle, carried into the town
    const mx = (box.min.x + box.max.x) / 2;
    const mz = (box.min.z + box.max.z) / 2;
    const decals = box.data.decals?.map((d) => ({
      ...d,
      min: { x: d.min.x - mx, y: d.min.y, z: d.min.z - mz },
      max: { x: d.max.x - mx, y: d.max.y, z: d.max.z - mz },
    }));
    turnedBox(
      {
        x: b.x + c * mx + s * mz,
        y: b.base,
        z: b.z - s * mx + c * mz,
        angle: b.angle,
        hx: (box.max.x - box.min.x) / 2,
        hz: (box.max.z - box.min.z) / 2,
        ...(box.data.faces ? { faces: box.data.faces } : {}),
        ...(decals ? { decals } : {}),
      },
      b.base + box.min.y,
      b.base + box.max.y,
      (min, max, data) => physics.addBox(group, min, max, data),
      box.slice,
    );
  }
}

/**
 * Deck heights for the stretch of a street over water, by row: undefined where the street is
 * on the ground. A bridge runs from the last dry row before the water to the first after it,
 * level with the banks, at least `clearance` over the water, arching a little over a long span.
 */
function bridgeDeck(
  grounds: readonly number[],
  pts: readonly { x: number; z: number }[],
  lift: number,
): (number | undefined)[] {
  const deck: (number | undefined)[] = grounds.map(() => undefined);
  for (let i = 0; i < grounds.length; i++) {
    if (grounds[i]! >= WET) continue;
    let j = i;
    while (j + 1 < grounds.length && grounds[j + 1]! < WET) j++;
    // the dry rows either side carry the bridge's ends
    const a = Math.max(0, i - 1);
    const b = Math.min(grounds.length - 1, j + 1);
    const ya = grounds[a]! + lift;
    const yb = grounds[b]! + lift;
    let length = 0;
    for (let k = a; k < b; k++) length += Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.z - pts[k]!.z);
    const arch = Math.min(BRIDGE.maxArch, length * BRIDGE.arch);
    let walked = 0;
    for (let k = a; k <= b; k++) {
      if (k > a) walked += Math.hypot(pts[k]!.x - pts[k - 1]!.x, pts[k]!.z - pts[k - 1]!.z);
      const t = length > 0 ? walked / length : 0;
      const level = ya + (yb - ya) * t;
      deck[k] = Math.max(level, WATER_LEVEL + BRIDGE.clearance) + arch * Math.sin(Math.PI * t);
    }
    i = j;
  }
  return deck;
}

/** The row ranges [first, last] of each bridge in a street's deck heights. */
function spansOf(deck: readonly (number | undefined)[]): [number, number][] {
  const spans: [number, number][] = [];
  for (let i = 0; i < deck.length; i++) {
    if (deck[i] === undefined) continue;
    let j = i;
    while (j + 1 < deck.length && deck[j + 1] !== undefined) j++;
    spans.push([i, j]);
    i = j;
  }
  return spans;
}

/**
 * A bridge's sides, railings and colliders, a segment at a time along the street (its deck is
 * the street's own strip, lifted), and steps down to the water beside its first end.
 */
function buildBridge(
  [first, last]: [number, number],
  pts: readonly { x: number; z: number }[],
  deck: readonly (number | undefined)[],
  width: number,
  tileAt: (x: number, z: number) => { base: GeometryBuilder },
  group: string,
  physics: ColliderSink,
): void {
  const stone = color('rock');
  const wood = color('bark');
  const half = width / 2;
  const add = (min: Vec3Like, max: Vec3Like, data: ColliderData) => physics.addBox(group, min, max, data);
  for (let k = first; k < last; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-3) continue;
    const angle = Math.atan2(b.x - a.x, b.z - a.z);
    const ya = deck[k]!;
    const yb = deck[k + 1]!;
    const top = Math.max(ya, yb);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const g = tileAt(mid.x, mid.z).base;
    // the deck's body under the paving: its stone sides show from the river
    turnedSolid(
      g,
      { x: mid.x, y: (ya + yb) / 2 - BRIDGE.deck / 2 - 0.02, z: mid.z },
      angle,
      { x: half + 0.15, y: BRIDGE.deck / 2, z: len / 2 + 0.05 },
      stone,
    );
    turnedBox(
      { x: mid.x, y: 0, z: mid.z, angle, hx: half, hz: len / 2 + 0.05 },
      Math.min(ya, yb) - BRIDGE.deck,
      top,
      add,
      0.8,
    );
    // railings on both sides: a post per segment and a rail along the top
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (const side of [-1, 1]) {
      const ex = c * side * (half + 0.08);
      const ez = -s * side * (half + 0.08);
      turnedSolid(
        g,
        { x: a.x + ex, y: ya + BRIDGE.rail / 2, z: a.z + ez },
        angle,
        { x: 0.08, y: BRIDGE.rail / 2, z: 0.08 },
        wood,
      );
      turnedSolid(
        g,
        { x: mid.x + ex, y: (ya + yb) / 2 + BRIDGE.rail - 0.05, z: mid.z + ez },
        angle,
        { x: 0.06, y: 0.05, z: len / 2 + 0.04 },
        wood,
      );
      turnedBox(
        { x: mid.x + ex, y: 0, z: mid.z + ez, angle, hx: 0.08, hz: len / 2 },
        Math.min(ya, yb),
        top + BRIDGE.rail,
        add,
        0.8,
      );
    }
  }
  // steps down to the water beside the bridge's first end, along the bank
  const a = pts[first]!;
  const b = pts[Math.min(last, first + 1)]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-3 || last - first < 3) return;
  const angle = Math.atan2(b.x - a.x, b.z - a.z);
  const fx = (b.x - a.x) / len;
  const fz = (b.z - a.z) / len;
  const sideX = Math.cos(angle) * (half + 1.6);
  const sideZ = -Math.sin(angle) * (half + 1.6);
  let y = deck[first]! - STEP.rise;
  for (let k = 0; k < 10 && y > WATER_LEVEL - 0.25; k++, y -= STEP.rise) {
    const at = { x: a.x + sideX + fx * STEP.tread * (k + 0.5), z: a.z + sideZ + fz * STEP.tread * (k + 0.5) };
    const bottom = WATER_LEVEL - 1.2;
    turnedSolid(
      tileAt(at.x, at.z).base,
      { x: at.x, y: (y + bottom) / 2, z: at.z },
      angle,
      { x: 0.8, y: (y - bottom) / 2, z: STEP.tread / 2 },
      stone,
    );
    turnedBox({ x: at.x, y: 0, z: at.z, angle, hx: 0.8, hz: STEP.tread / 2 }, bottom, y, add, 0.8);
  }
}

/** A white picket fence round a house's front garden, in the house's own frame (front +z,
 * floor at 0), standing on the ground before the door, open at the path. */
function fenceGarden(
  h: GeometryBuilder,
  b: Building,
  boxes: { min: Vec3Like; max: Vec3Like; data: ColliderData; slice: number }[],
): void {
  const paint = color('limewash');
  const all = { px: paint, nx: paint, pz: paint, nz: paint, py: paint };
  const foot = b.step - b.base;
  const bottom = foot - 0.4;
  const top = foot + FENCE.height;
  const wide = b.hw + 0.4;
  const front = b.hd + b.garden;
  /** A straight run from (x0, z0) to (x1, z1): posts, two rails, one collider. */
  const run = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const posts = Math.max(1, Math.round(len / FENCE.post));
    for (let k = 0; k <= posts; k++) {
      const x = x0 + ((x1 - x0) * k) / posts;
      const z = z0 + ((z1 - z0) * k) / posts;
      h.box({ x: x - 0.05, y: bottom, z: z - 0.05 }, { x: x + 0.05, y: top, z: z + 0.05 }, all);
    }
    const lo = { x: Math.min(x0, x1) - 0.03, z: Math.min(z0, z1) - 0.03 };
    const hi = { x: Math.max(x0, x1) + 0.03, z: Math.max(z0, z1) + 0.03 };
    for (const y of [foot + 0.35, top - 0.15])
      h.box({ x: lo.x, y: y - 0.04, z: lo.z }, { x: hi.x, y: y + 0.04, z: hi.z }, all);
    boxes.push({
      min: { x: lo.x, y: bottom, z: lo.z },
      max: { x: hi.x, y: top, z: hi.z },
      data: {},
      slice: 0.8,
    });
  };
  run(-wide, front, -FENCE.gate, front);
  run(FENCE.gate, front, wide, front);
  for (const x of [-wide, wide]) run(x, b.hd - 0.4, x, front);
}

/** A stone well in the middle of the square, with its little roof. */
function buildWell(g: GeometryBuilder, at: Vec3Like, group: string, physics: ColliderSink): void {
  const stone = color('rock');
  const wood = color('bark');
  const tile = color('clayTile');
  const m = new THREE.Matrix4();
  const ring = new THREE.CylinderGeometry(1.1, 1.2, 0.9, 14, 1, true);
  g.mesh(ring, m.makeTranslation(at.x, at.y + 0.45, at.z), stone);
  ring.dispose();
  const lip = new THREE.TorusGeometry(1.12, 0.14, 4, 14).rotateX(Math.PI / 2);
  g.mesh(lip, m.makeTranslation(at.x, at.y + 0.9, at.z), stone);
  lip.dispose();
  const all = (c: number) => ({ px: c, nx: c, pz: c, nz: c, py: c });
  g.box(
    { x: at.x - 1, y: at.y + 0.35, z: at.z - 1 },
    { x: at.x + 1, y: at.y + 0.4, z: at.z + 1 },
    all(color('water')),
  );
  for (const x of [-1.25, 1.25])
    g.box(
      { x: at.x + x - 0.09, y: at.y, z: at.z - 0.09 },
      { x: at.x + x + 0.09, y: at.y + 2.5, z: at.z + 0.09 },
      all(wood),
    );
  g.box(
    { x: at.x - 1.3, y: at.y + 2.15, z: at.z - 0.06 },
    { x: at.x + 1.3, y: at.y + 2.27, z: at.z + 0.06 },
    all(wood),
  );
  // a pitched roof of two slabs over the windlass
  const slab = new THREE.BoxGeometry(3, 0.08, 1.15);
  for (const side of [-1, 1])
    g.mesh(slab, m.makeRotationX(side * 0.55).setPosition(at.x, at.y + 2.75, at.z + side * 0.48), tile);
  slab.dispose();
  physics.addBox(
    group,
    { x: at.x - 1.25, y: at.y - 0.5, z: at.z - 1.25 },
    { x: at.x + 1.25, y: at.y + 0.95, z: at.z + 1.25 },
  );
}
