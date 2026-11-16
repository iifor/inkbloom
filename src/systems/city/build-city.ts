// CityLayout -> geometry + colliders. Buildings are boxes whose faces carry surface ids, so
// both the shader (colour) and the brush raycast (which surface) read the same numbers.
import { color } from '@/content/palette';
import { BUILDINGS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import type { Decal, PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder, type BoxFace } from '@/engine/render/geometry-builder';
import { ROAD_NONE, type Building, type CityLayout } from '@/world/city/layout';

const DOOR_W = 1.6;
const DOOR_H = 2.4;
const WALL_H = 7;
const GROUP = 'city';
/** Templates that get a pitched roof; the rest keep a flat top. */
const PITCHED = new Set<string>(['house', 'shop']);

type V3 = { x: number; y: number; z: number };
type WallFace = 'px' | 'nx' | 'pz' | 'nz';
const WALL_FACES: readonly WallFace[] = ['px', 'nx', 'pz', 'nz'];

/** A flat polygon (3 or 4 points, any order around it) facing `outward`. */
function facing(g: GeometryBuilder, pts: V3[], outward: V3, colour: number, surface: number): void {
  const [a, b, c] = pts as [V3, V3, V3];
  const ux = b.x - a.x,
    uy = b.y - a.y,
    uz = b.z - a.z;
  const vx = c.x - a.x,
    vy = c.y - a.y,
    vz = c.z - a.z;
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  if (nx * outward.x + ny * outward.y + nz * outward.z < 0) {
    pts = [...pts].reverse();
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  const n = { x: nx / len, y: ny / len, z: nz / len };
  const d = pts[3] ?? pts[2]!;
  g.quad(pts[0]!, pts[1]!, pts[2]!, d, n, colour, surface);
}

/** A point on a wall face: `u` along the face, `y` up, `o` metres out from it. */
function onWall(b: Building, f: WallFace, u: number, y: number, o: number): V3 {
  if (f === 'px') return { x: b.x1 + o, y, z: u };
  if (f === 'nx') return { x: b.x0 - o, y, z: u };
  if (f === 'pz') return { x: u, y, z: b.z1 + o };
  return { x: u, y, z: b.z0 - o };
}

const span = (b: Building, f: WallFace): [number, number] =>
  f === 'px' || f === 'nx' ? [b.z0, b.z1] : [b.x0, b.x1];

/**
 * Windows on every floor (none over the door), each a cream frame with blue-grey glass. They
 * carry their wall's surface id, so they drain and come back with it. Drawing only: the
 * brush and colliders still see the plain wall.
 */
function addWindows(g: GeometryBuilder, b: Building, wallColour: (f: WallFace) => number): void {
  const fh = TUNING.city.lots.floorHeight;
  const floors = Math.max(1, Math.round(b.height / fh));
  const cream = color('cream');
  const glass = color('glass');
  for (const f of WALL_FACES) {
    const [u0, u1] = span(b, f);
    const cols = Math.floor((u1 - u0 - 1) / 2.6);
    if (cols < 1) continue;
    const step = (u1 - u0) / cols;
    const n = normalOf(f);
    const surface = b.walls[f];
    // a frame the same colour as a cream wall would vanish: use the wall's own colour, lighter
    const frame = wallColour(f) === cream ? color('brown') : cream;
    for (let k = 0; k < cols; k++) {
      const uc = u0 + step * (k + 0.5);
      for (let fl = 0; fl < floors; fl++) {
        const yc = fl * fh + 1.75;
        if (yc + 0.9 > b.height - 0.3) continue;
        if (fl === 0 && f === b.doorFace && Math.abs(uc - b.doorAt) < 2.2) continue;
        const rect = (hw: number, hh: number, o: number): V3[] => [
          onWall(b, f, uc - hw, yc - hh, o),
          onWall(b, f, uc + hw, yc - hh, o),
          onWall(b, f, uc + hw, yc + hh, o),
          onWall(b, f, uc - hw, yc + hh, o),
        ];
        facing(g, rect(0.62, 0.82, 0.025), n, frame, surface);
        facing(g, rect(0.5, 0.68, 0.045), n, glass, surface);
      }
    }
  }
}

/** A gable roof along the building's long side, in its roof's colour and surface. */
function addPitchedRoof(
  g: GeometryBuilder,
  b: Building,
  roofColour: number,
  wallColour: (f: WallFace) => number,
): void {
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const h = b.height;
  const rise = Math.min(3.4, Math.max(1.3, Math.min(w, d) * 0.42));
  const o = 0.4;
  const eave = h - 0.25;
  const alongX = w >= d;
  const up = h + rise;
  const roof = b.roof;
  if (alongX) {
    const zc = (b.z0 + b.z1) / 2;
    for (const side of [1, -1]) {
      const ze = side > 0 ? b.z1 + o : b.z0 - o;
      const pts = [
        { x: b.x0 - o, y: eave, z: ze },
        { x: b.x1 + o, y: eave, z: ze },
        { x: b.x1 + o, y: up, z: zc },
        { x: b.x0 - o, y: up, z: zc },
      ];
      facing(g, pts, { x: 0, y: 1, z: side }, roofColour, roof);
      // underside of the eaves, seen from the street
      facing(g, pts, { x: 0, y: -1, z: -side }, roofColour, roof);
    }
    for (const f of ['px', 'nx'] as const) {
      const x = f === 'px' ? b.x1 : b.x0;
      facing(
        g,
        [
          { x, y: h, z: b.z0 },
          { x, y: h, z: b.z1 },
          { x, y: up, z: zc },
        ],
        normalOf(f),
        wallColour(f),
        b.walls[f],
      );
    }
  } else {
    const xc = (b.x0 + b.x1) / 2;
    for (const side of [1, -1]) {
      const xe = side > 0 ? b.x1 + o : b.x0 - o;
      const pts = [
        { x: xe, y: eave, z: b.z0 - o },
        { x: xe, y: eave, z: b.z1 + o },
        { x: xc, y: up, z: b.z1 + o },
        { x: xc, y: up, z: b.z0 - o },
      ];
      facing(g, pts, { x: side, y: 1, z: 0 }, roofColour, roof);
      facing(g, pts, { x: -side, y: -1, z: 0 }, roofColour, roof);
    }
    for (const f of ['pz', 'nz'] as const) {
      const z = f === 'pz' ? b.z1 : b.z0;
      facing(
        g,
        [
          { x: b.x0, y: h, z },
          { x: b.x1, y: h, z },
          { x: xc, y: up, z },
        ],
        normalOf(f),
        wallColour(f),
        b.walls[f],
      );
    }
  }
}

export function buildCity(city: CityLayout, physics: PhysicsWorld): GeometryBuilder {
  const g = new GeometryBuilder();
  const { n, cell, size, roads, buildingOf, blockOf, blocks } = city;
  const stone = color('stone');
  const up = { x: 0, y: 1, z: 0 };

  // ground: one quad + collider per row run of the same kind (road, courtyard of block b, wall ring)
  for (let iz = 0; iz < n; iz++) {
    let start = 0;
    const kindAt = (ix: number): number => {
      const i = iz * n + ix;
      if (roads[i] !== ROAD_NONE) return -2;
      if (buildingOf[i] !== 0) return -3;
      const b = blockOf[i]!;
      return b === 0 ? -1 : b - 1; // -1 = city edge ring
    };
    for (let ix = 1; ix <= n; ix++) {
      const k = kindAt(ix - 1);
      if (ix < n && kindAt(ix) === k) continue;
      const x0 = start * cell;
      const x1 = ix * cell;
      const z0 = iz * cell;
      const z1 = (iz + 1) * cell;
      start = ix;
      if (k === -3) {
        physics.addBox(GROUP, { x: x0, y: -1, z: z0 }, { x: x1, y: 0, z: z1 });
        continue;
      }
      const surface = k >= 0 ? blocks[k]!.ground : -1;
      const c = k >= 0 ? (surface >= 0 ? city.surfaces[surface]!.color : stone) : stone;
      g.quad(
        { x: x0, y: 0, z: z1 },
        { x: x1, y: 0, z: z1 },
        { x: x1, y: 0, z: z0 },
        { x: x0, y: 0, z: z0 },
        up,
        c,
        surface,
      );
      physics.addBox(
        GROUP,
        { x: x0, y: -1, z: z0 },
        { x: x1, y: 0, z: z1 },
        surface >= 0 ? { faces: { py: surface } } : {},
      );
    }
  }

  // buildings
  for (const b of city.buildings) {
    const s = city.surfaces;
    const colors: Partial<Record<BoxFace, number>> = {
      px: s[b.walls.px]!.color,
      nx: s[b.walls.nx]!.color,
      pz: s[b.walls.pz]!.color,
      nz: s[b.walls.nz]!.color,
      py: s[b.roof]!.color,
    };
    const faces = { px: b.walls.px, nx: b.walls.nx, pz: b.walls.pz, nz: b.walls.nz, py: b.roof };
    g.box({ x: b.x0, y: 0, z: b.z0 }, { x: b.x1, y: b.height, z: b.z1 }, colors, faces);
    const wallColour = (f: WallFace): number => colors[f]!;
    addWindows(g, b, wallColour);
    if (PITCHED.has(BUILDINGS[b.template]?.key ?? '')) addPitchedRoof(g, b, colors.py!, wallColour);
    const door = doorRect(b.doorFace, b.x0, b.z0, b.x1, b.z1, b.doorAt);
    const dc = s[b.door]!.color;
    const o = 0.04;
    const n = normalOf(b.doorFace);
    const ox = n.x * o;
    const oz = n.z * o;
    const { min, max } = door;
    if (b.doorFace === 'px' || b.doorFace === 'nx') {
      const [za, zb] = b.doorFace === 'px' ? [max.z, min.z] : [min.z, max.z];
      g.quad(
        { x: min.x + ox, y: 0, z: za },
        { x: min.x + ox, y: 0, z: zb },
        { x: min.x + ox, y: DOOR_H, z: zb },
        { x: min.x + ox, y: DOOR_H, z: za },
        n,
        dc,
        b.door,
      );
    } else {
      const [xa, xb] = b.doorFace === 'pz' ? [min.x, max.x] : [max.x, min.x];
      g.quad(
        { x: xa, y: 0, z: min.z + oz },
        { x: xb, y: 0, z: min.z + oz },
        { x: xb, y: DOOR_H, z: min.z + oz },
        { x: xa, y: DOOR_H, z: min.z + oz },
        n,
        dc,
        b.door,
      );
    }
    const decal: Decal = { face: b.doorFace, min, max, surface: b.door };
    physics.addBox(
      GROUP,
      { x: b.x0, y: 0, z: b.z0 },
      { x: b.x1, y: b.height, z: b.z1 },
      { faces, decals: [decal] },
    );
  }

  // city wall around the edge, open at the gates
  const wallColor = color('charcoal');
  const gateCells = new Set<number>();
  const gw = TUNING.city.roads.mainWidth + 2;
  for (const gate of city.gates)
    for (let k = -gw; k <= gw; k++) {
      const along = gate.dir === 0 || gate.dir === 2;
      gateCells.add(along ? (gate.iz + k) * n + gate.ix : gate.iz * n + gate.ix + k);
    }
  const wall = (ix: number, iz: number): void => {
    if (gateCells.has(iz * n + ix)) return;
    const min = { x: ix * cell, y: 0, z: iz * cell };
    const max = { x: (ix + 1) * cell, y: WALL_H, z: (iz + 1) * cell };
    g.box(min, max, { px: wallColor, nx: wallColor, pz: wallColor, nz: wallColor, py: wallColor });
    physics.addBox(GROUP, min, max);
  };
  for (let i = 0; i < n; i++) {
    wall(i, 0);
    wall(i, n - 1);
    if (i > 0 && i < n - 1) {
      wall(0, i);
      wall(n - 1, i);
    }
  }
  // a floor under everything so nothing falls through seams
  physics.addBox(GROUP, { x: -20, y: -3, z: -20 }, { x: size + 20, y: -1, z: size + 20 });
  return g;
}

function normalOf(face: BoxFace): { x: number; y: number; z: number } {
  return {
    x: face === 'px' ? 1 : face === 'nx' ? -1 : 0,
    y: face === 'py' ? 1 : face === 'ny' ? -1 : 0,
    z: face === 'pz' ? 1 : face === 'nz' ? -1 : 0,
  };
}

function doorRect(
  face: 'px' | 'nx' | 'pz' | 'nz',
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  /** Door centre along the face: z for px/nx, x for pz/nz. */
  at: number,
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
  const cx = at;
  const cz = at;
  const h = DOOR_W / 2;
  switch (face) {
    case 'px':
      return { min: { x: x1, y: 0, z: cz - h }, max: { x: x1, y: DOOR_H, z: cz + h } };
    case 'nx':
      return { min: { x: x0, y: 0, z: cz - h }, max: { x: x0, y: DOOR_H, z: cz + h } };
    case 'pz':
      return { min: { x: cx - h, y: 0, z: z1 }, max: { x: cx + h, y: DOOR_H, z: z1 } };
    case 'nz':
      return { min: { x: cx - h, y: 0, z: z0 }, max: { x: cx + h, y: DOOR_H, z: z0 } };
  }
}
