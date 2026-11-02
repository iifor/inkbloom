// CityLayout -> geometry + colliders. Buildings are boxes whose faces carry surface ids, so
// both the shader (colour) and the brush raycast (which surface) read the same numbers.
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import type { Decal, PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder, type BoxFace } from '@/engine/render/geometry-builder';
import { ROAD_NONE, type CityLayout } from '@/world/city/layout';

const DOOR_W = 1.6;
const DOOR_H = 2.4;
const WALL_H = 7;
const GROUP = 'city';

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
