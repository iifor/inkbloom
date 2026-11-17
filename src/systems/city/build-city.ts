// A town as one static mesh and its colliders, where it stands in the world: its ground laid
// over the land's own triangles (yards carry their surfaces), streets as strips draped over it,
// country houses turned to face their street on stone plinths, and the low wall round it.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { BUILDINGS } from '@/content/templates';
import { type ColliderData, type Vec3Like, turnedBox } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import {
  GATE_HALF,
  ROAD_MAIN,
  ROAD_NONE,
  groundAt,
  type Building,
  type CityLayout,
} from '@/world/city/layout';
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
  const { n, cell, roads, groundOf, ox, oz, heights, chunks } = city;
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
  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const surface = groundOf[iz * n + ix]!;
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
    const rows = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len;
      const nz = (b.x - a.x) / len;
      return [-1, 0, 1].map((u) => {
        const x = p.x + nx * u * (st.width / 2);
        const z = p.z + nz * u * (st.width / 2);
        return { p: { x, y: ground(x, z) + lift, z }, n: normalAt(x, z) };
      });
    });
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

  // a low dry-stone wall round the town, stepping with the land, open at the gates
  const wallColor = color('rock');
  const gateCells = new Set<number>();
  for (const gate of city.gates)
    for (let k = -GATE_HALF; k <= GATE_HALF; k++) {
      const along = gate.dir === 0 || gate.dir === 2;
      gateCells.add(along ? (gate.iz + k) * n + gate.ix : gate.iz * n + gate.ix + k);
    }
  const wall = (ix: number, iz: number): void => {
    if (gateCells.has(iz * n + ix) || roads[iz * n + ix] !== ROAD_NONE) return;
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
