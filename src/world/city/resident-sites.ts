import { cityNav } from '../nav/grids';
import type { Waypoint } from '../nav/path';
import { type Wilderness, WATER_LEVEL } from '../wilderness/generator';
import type { WildChunk } from '../wilderness/chunk';
import type { Farmstead } from '../wilderness/farmsteads';
import { propFootprint } from '../wilderness/ground-props';
import { pathsOf } from '../wilderness/paths';
import { doorFront } from './features';
import { groundAt, ROAD_MAIN, type CityLayout } from './layout';
import type { ActivitySite, Neighbourhood } from './resident-routine';
import { travelAltar } from './travel-altar';

function walkingGrid(
  ox: number,
  oz: number,
  size: number,
  cell: number,
  land: (x: number, z: number) => boolean,
) {
  const n = Math.ceil(size / cell);
  const cells = new Uint8Array(n * n); // 0 untested, 1 clear, 2 obstructed
  const grid = {
    ox,
    oz,
    cell,
    walkable(ix: number, iz: number) {
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) return false;
      const index = iz * n + ix;
      if (!cells[index]) cells[index] = land(ox + (ix + 0.5) * cell, oz + (iz + 0.5) * cell) ? 1 : 2;
      return cells[index] === 1;
    },
  };
  function block(x: number, z: number, hw: number, hd: number, angle = 0) {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      r = Math.hypot(hw, hd) + 1;
    for (
      let iz = Math.max(0, Math.floor((z - r - oz) / cell));
      iz <= Math.min(n - 1, Math.floor((z + r - oz) / cell));
      iz++
    )
      for (
        let ix = Math.max(0, Math.floor((x - r - ox) / cell));
        ix <= Math.min(n - 1, Math.floor((x + r - ox) / cell));
        ix++
      ) {
        const dx = ox + (ix + 0.5) * cell - x,
          dz = oz + (iz + 0.5) * cell - z;
        if (Math.abs(dx * c - dz * s) <= hw + 0.45 && Math.abs(dx * s + dz * c) <= hd + 0.45)
          cells[iz * n + ix] = 2;
      }
  }
  return { grid, block };
}

export function villageActivities(l: CityLayout): Neighbourhood {
  const base = cityNav(l);
  const ground = (x: number, z: number) => groundAt(l, x, z);
  const { grid, block } = walkingGrid(l.ox, l.oz, l.size, 2, (x, z) => {
    const ix = Math.floor((x - l.ox) / l.cell),
      iz = Math.floor((z - l.oz) / l.cell);
    return (base.walkable(ix, iz) || !!l.buildingOf[iz * l.n + ix]) && ground(x, z) > WATER_LEVEL + 0.2;
  });
  for (const b of l.buildings) {
    block(b.x, b.z, b.hw, b.hd, b.angle);
    if (!b.garden) continue;
    // Leave the opening in the front fence clear.
    const edge = doorFront(b, b.garden / 2);
    const wide = b.hw + 0.4;
    for (const sign of [-1, 1]) {
      const dx = sign * Math.cos(b.angle),
        dz = -sign * Math.sin(b.angle);
      block(edge.x + dx * wide, edge.z + dz * wide, 0.18, b.garden / 2, b.angle);
      const front = doorFront(b, b.garden),
        offset = (wide + 1.3) / 2;
      block(front.x + dx * offset, front.z + dz * offset, (wide - 1.3) / 2, 0.18, b.angle);
    }
  }
  const timber = l.trees.map((t) => {
    block(t.x, t.z, 0.65, 0.65);
    return { x: t.x + 2, z: t.z, facing: -Math.PI / 2 };
  });
  block(l.square.x, l.square.z, 1.5, 1.5);
  const square = { x: l.square.x + 3.5, z: l.square.z };
  const homes = l.buildings.map((b) => doorFront(b, b.garden + 2));
  const gates = l.gates.map((g) => ({ x: l.ox + (g.ix + 0.5) * l.cell, z: l.oz + (g.iz + 0.5) * l.cell }));
  const streets = l.streets.flatMap((s) => s.points.filter((_, i) => i % 8 === 0));
  const studios: ActivitySite[] = l.studios.map((s) =>
    doorFront(l.buildings[s.building]!, 2 + l.buildings[s.building]!.garden),
  );
  const altar = travelAltar(l);
  if (altar) {
    block(altar.x, altar.z, 2, 2);
    studios.push({ x: altar.x + 3.5, z: altar.z, facing: -Math.PI / 2 });
  }
  return {
    grid,
    ground,
    streets,
    sites: {
      guard: [
        ...gates,
        ...l.streets
          .filter((s) => s.cls === ROAD_MAIN)
          .map((s) => s.points[Math.floor(s.points.length / 2)]!),
      ],
      woodcutter: timber,
      mage: studios,
      villager: [square, ...homes],
    },
  };
}

export function farmActivities(w: Wilderness, chunk: WildChunk, farm: Farmstead): Neighbourhood {
  const size = chunk.n * chunk.cell;
  const ground = (x: number, z: number) => w.heightAt(x, z);
  const { grid, block } = walkingGrid(
    chunk.x0,
    chunk.z0,
    size,
    1,
    (x, z) => ground(x, z) > WATER_LEVEL + 0.4 && !w.townAt(x, z, 2),
  );
  for (const b of farm.buildings) block(b.x, b.z, b.hw + 0.2, b.hd + 0.2);
  for (const s of [-1, 1]) {
    block(farm.x + s * farm.hw, farm.z, 0.2, farm.hd);
    block(farm.x + (s * (farm.hw + 1.55)) / 2, farm.z + farm.front * farm.hd, (farm.hw - 1.55) / 2, 0.2);
  }
  block(farm.x, farm.z - farm.front * farm.hd, farm.hw, 0.2);
  for (const r of chunk.ruins) block(r.x, r.z, 8, 8);
  for (const t of chunk.trees) block(t.x, t.z, 0.55, 0.55);
  for (const prop of chunk.groundProps) {
    const foot = propFootprint(prop);
    if (foot) block(prop.x, prop.z, foot.hw, foot.hd, prop.yaw);
  }
  for (const s of chunk.springs) block(s.x, s.z, s.r, s.r);
  for (const l of chunk.lookouts) block(l.x, l.z, 3, 3);
  const gate = { x: farm.x, z: farm.z + farm.front * (farm.hd + 2) };
  const streets: Waypoint[] = [gate];
  for (const trail of pathsOf(w).trailsNear(chunk.x0, chunk.z0, chunk.x0 + size, chunk.z0 + size))
    for (let i = 0; i < trail.pts.length; i += 8) {
      const x = trail.pts[i]!,
        z = trail.pts[i + 1]!;
      if (x >= chunk.x0 && x < chunk.x0 + size && z >= chunk.z0 && z < chunk.z0 + size)
        streets.push({ x, z });
    }
  return {
    grid,
    ground,
    streets,
    sites: {
      guard: streets,
      woodcutter: chunk.trees.map((t) => ({ x: t.x + 1.8, z: t.z, facing: -Math.PI / 2 })),
      mage: chunk.sources.map((s) => ({ x: s.x + 1.8, z: s.z, facing: -Math.PI / 2 })),
      villager: [
        ...farm.buildings.map((b) => ({ x: b.x + 2, z: b.z + farm.front * (b.hd + 1.5) })),
        ...streets,
      ],
    },
  };
}
