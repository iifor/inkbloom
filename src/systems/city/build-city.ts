// Merge village lanes, country houses and boundary walls into a single static mesh.
import { color } from '@/content/palette';
import { BUILDINGS } from '@/content/templates';
import { TUNING } from '@/content/tuning';
import type { ColliderData, Vec3Like } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { ROAD_NONE, type CityLayout } from '@/world/city/layout';
import { buildCountryHouse } from './country-house';

const GROUP = 'city';
/** Where buildCity puts colliders: a PhysicsWorld, or a recorder in the city worker. */
export interface ColliderSink {
  addBox(group: string, min: Vec3Like, max: Vec3Like, data?: ColliderData): unknown;
}

export function buildCity(city: CityLayout, physics: ColliderSink): GeometryBuilder {
  const g = new GeometryBuilder();
  const { n, cell, size, roads, buildingOf, blockOf, blocks } = city;
  const stone = color('rock');
  const earth = color('sand');
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
      const surface = k >= 0 ? blocks[k]!.ground : -1;
      const c = k >= 0 ? (surface >= 0 ? city.surfaces[surface]!.color : stone) : earth;
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

  for (const b of city.buildings) {
    // Leave a strip of earth between neighbouring houses. The doorway stays on
    // its road frontage, where residents, studios and old saves expect it.
    const inset = 0.95;
    buildCountryHouse(
      g,
      {
        x0: b.x0 + (b.doorFace === 'nx' ? 0 : inset),
        x1: b.x1 - (b.doorFace === 'px' ? 0 : inset),
        z0: b.z0 + (b.doorFace === 'nz' ? 0 : inset),
        z1: b.z1 - (b.doorFace === 'pz' ? 0 : inset),
        base: 0,
        height: b.height,
        front: b.doorFace,
        doorAt: b.doorAt,
        style: BUILDINGS[b.template]!.key,
        plaster: city.surfaces[b.walls.px]!.color,
        tile: city.surfaces[b.roof]!.color,
        doorColor: city.surfaces[b.door]!.color,
        surfaces: b,
      },
      (min, max, data) => physics.addBox(GROUP, min, max, data),
    );
  }

  // city wall around the edge, open at the gates
  const wallColor = color('rock');
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
    const max = { x: (ix + 1) * cell, y: 1.65, z: (iz + 1) * cell };
    g.box(min, max, { px: wallColor, nx: wallColor, pz: wallColor, nz: wallColor, py: color('grass') });
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
