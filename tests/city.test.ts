import { describe, expect, it } from 'vitest';
import { generateCity, ROAD_NONE, type CityLayout } from '@/world/city/layout';

const SEEDS = [1, 2, 3, 99, 12345];

function roadReachable(city: CityLayout): Set<number> {
  const { n, roads } = city;
  const start = city.gates[0]!.iz * n + city.gates[0]!.ix;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % n;
    const z = (i - x) / n;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x2 = x + dx;
      const z2 = z + dz;
      if (x2 < 0 || z2 < 0 || x2 >= n || z2 >= n) continue;
      const j = z2 * n + x2;
      if (roads[j] !== ROAD_NONE && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen;
}

describe('city layout', () => {
  it('is deterministic for a seed', () => {
    const a = generateCity('c1_1', 77);
    const b = generateCity('c1_1', 77);
    expect(a.name).toBe(b.name);
    expect([...a.roads]).toEqual([...b.roads]);
    expect(a.buildings).toEqual(b.buildings);
    expect(a.surfaces).toEqual(b.surfaces);
  });

  it.each(SEEDS)('connects every road cell to the main gate (seed %i)', (seed) => {
    const city = generateCity('x', seed);
    const reach = roadReachable(city);
    let roadCells = 0;
    for (const r of city.roads) if (r !== ROAD_NONE) roadCells++;
    expect(reach.size).toBe(roadCells);
    for (const g of city.gates) expect(reach.has(g.iz * city.n + g.ix)).toBe(true);
  });

  it.each(SEEDS)('never puts buildings on roads or on each other (seed %i)', (seed) => {
    const city = generateCity('x', seed);
    const { n, cell } = city;
    const claimed = new Uint8Array(n * n);
    for (const b of city.buildings) {
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(b.z1).toBeGreaterThan(b.z0);
      for (let x = b.x0 / cell; x < b.x1 / cell; x++)
        for (let z = b.z0 / cell; z < b.z1 / cell; z++) {
          const i = z * n + x;
          expect(city.roads[i]).toBe(ROAD_NONE);
          expect(claimed[i]).toBe(0);
          claimed[i] = 1;
        }
    }
  });

  it.each(SEEDS)('fronts every door onto a road (seed %i)', (seed) => {
    const city = generateCity('x', seed);
    const { n, cell } = city;
    for (const b of city.buildings) {
      const x0 = b.x0 / cell;
      const z0 = b.z0 / cell;
      const x1 = b.x1 / cell - 1;
      const z1 = b.z1 / cell - 1;
      const probe: [number, number] =
        b.doorFace === 'px'
          ? [x1 + 1, z0]
          : b.doorFace === 'nx'
            ? [x0 - 1, z0]
            : b.doorFace === 'pz'
              ? [x0, z1 + 1]
              : [x0, z0 - 1];
      // some cell along the door face touches a road
      let touches = false;
      const len = b.doorFace === 'px' || b.doorFace === 'nx' ? z1 - z0 + 1 : x1 - x0 + 1;
      for (let k = 0; k < len && !touches; k++) {
        const [px, pz] =
          b.doorFace === 'px' || b.doorFace === 'nx' ? [probe[0], probe[1] + k] : [probe[0] + k, probe[1]];
        if (px >= 0 && pz >= 0 && px < n && pz < n && city.roads[pz * n + px] !== ROAD_NONE) touches = true;
      }
      expect(touches).toBe(true);
    }
  });

  it('produces a city worth painting', () => {
    const city = generateCity('x', 5);
    expect(city.buildings.length).toBeGreaterThan(80);
    expect(city.surfaces.length).toBe(
      city.buildings.length * 6 + city.blocks.filter((b) => b.ground >= 0).length,
    );
    expect(city.spawn.z).toBeLessThan(city.size);
  });
});

describe('city entry and doors', () => {
  it('always spawns the player on the main street, never in a building', () => {
    for (let s = 1; s <= 300; s++) {
      const city = generateCity('x', s * 7919);
      const ix = Math.floor(city.spawn.x / city.cell);
      const iz = Math.floor(city.spawn.z / city.cell);
      const i = iz * city.n + ix;
      expect(city.roads[i], `seed ${s * 7919}`).not.toBe(ROAD_NONE);
      expect(city.buildingOf[i], `seed ${s * 7919}`).toBe(0);
      // at least a few cells in from the gate so the gate prompt isn't on top of the spawn
      expect(city.size - city.spawn.z).toBeGreaterThan(city.cell * 3);
    }
  });

  it.each(SEEDS)('puts every door centre in front of a road cell (seed %i)', (seed) => {
    const city = generateCity('x', seed);
    const { n, cell } = city;
    for (const b of city.buildings) {
      const along = Math.floor(b.doorAt / cell);
      const [px, pz] =
        b.doorFace === 'px'
          ? [b.x1 / cell, along]
          : b.doorFace === 'nx'
            ? [b.x0 / cell - 1, along]
            : b.doorFace === 'pz'
              ? [along, b.z1 / cell]
              : [along, b.z0 / cell - 1];
      expect(city.roads[pz * n + px], `building ${b.id}`).not.toBe(ROAD_NONE);
      // and the door lies within the face
      const [lo, hi] = b.doorFace === 'px' || b.doorFace === 'nx' ? [b.z0, b.z1] : [b.x0, b.x1];
      expect(b.doorAt - 0.8).toBeGreaterThanOrEqual(lo);
      expect(b.doorAt + 0.8).toBeLessThanOrEqual(hi);
    }
  });
});
