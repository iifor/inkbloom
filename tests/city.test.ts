import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld, makeBody } from '@/engine/physics/world';
import { buildCity } from '@/systems/city/build-city';
import { doorFront } from '@/world/city/features';
import {
  ROAD_MAIN,
  ROAD_NONE,
  generateCity,
  groundAt,
  groundSurfaceAt,
  placeCity,
  rectsOverlap,
  townLayout,
  type CityLayout,
} from '@/world/city/layout';
import { cityNav } from '@/world/nav/grids';
import { findPath } from '@/world/nav/path';
import { cityStates, createWorldState } from '@/world/state';
import { createWilderness, townDistance } from '@/world/wilderness/generator';

const SEEDS = [1, 2, 3, 99, 12345];
/** Rolling land to lay towns out on: a long ridge and a valley across the town. */
const hills = (x: number, z: number): number => 6 * Math.sin(x / 70) + 4 * Math.cos(z / 55 + x / 140);

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

/** The cell a point is in. */
const cellOf = (city: CityLayout, x: number, z: number): number =>
  Math.floor((z - city.oz) / city.cell) * city.n + Math.floor((x - city.ox) / city.cell);

describe('town layout', () => {
  it('is deterministic for a seed and the land', () => {
    const a = generateCity('c1_1', 77, 3, 'pz', hills);
    const b = generateCity('c1_1', 77, 3, 'pz', hills);
    expect(a.name).toBe(b.name);
    expect([...a.roads]).toEqual([...b.roads]);
    expect(a.buildings).toEqual(b.buildings);
    expect(a.surfaces).toEqual(b.surfaces);
  });

  it.each(SEEDS)('connects every street to the main gate (seed %i)', (seed) => {
    const city = generateCity('x', seed, 3, 'pz', hills);
    const reach = roadReachable(city);
    let roadCells = 0;
    for (const r of city.roads) if (r !== ROAD_NONE) roadCells++;
    expect(reach.size).toBe(roadCells);
    for (const g of city.gates) expect(reach.has(g.iz * city.n + g.ix)).toBe(true);
  });

  it.each(SEEDS)('never puts a house on a street or on another house (seed %i)', (seed) => {
    const city = generateCity('x', seed, 3, 'pz', hills);
    for (const b of city.buildings) {
      for (const o of city.buildings)
        if (o.id < b.id) expect(rectsOverlap(b, o), `houses ${b.id} and ${o.id}`).toBe(false);
      // no street's paving reaches into the house
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      for (const st of city.streets)
        for (const p of st.points) {
          const lx = (p.x - b.x) * c - (p.z - b.z) * s;
          const lz = (p.x - b.x) * s + (p.z - b.z) * c;
          const inside = Math.abs(lx) < b.hw + st.width / 2 && Math.abs(lz) < b.hd + st.width / 2;
          expect(inside, `house ${b.id}`).toBe(false);
        }
    }
  });

  it.each(SEEDS)('turns every door to face a street just outside it (seed %i)', (seed) => {
    const city = generateCity('x', seed, 3, 'pz', hills);
    const reach = TUNING.city.houses.setback[1] + 4;
    for (const b of city.buildings) {
      let onStreet = false;
      for (let out = 0; out <= reach && !onStreet; out += 0.5) {
        const p = doorFront(b, out);
        onStreet = city.roads[cellOf(city, p.x, p.z)] !== ROAD_NONE;
      }
      expect(onStreet, `house ${b.id}`).toBe(true);
    }
  });

  it('lets the streets bend round the hills instead of climbing straight over them', () => {
    const city = generateCity('x', 7, 5, 'pz', hills);
    const { n } = city;
    // streets keep to gentler ground than the town as a whole
    let all = 0;
    let onRoads = 0;
    let roads = 0;
    for (let iz = 1; iz < n - 1; iz++)
      for (let ix = 1; ix < n - 1; ix++) {
        const x = (ix + 0.5) * city.cell;
        const z = (iz + 0.5) * city.cell;
        const s = Math.hypot(hills(x + 1, z) - hills(x - 1, z), hills(x, z + 1) - hills(x, z - 1)) / 2;
        all += s;
        if (city.roads[iz * n + ix] !== ROAD_NONE) {
          onRoads += s;
          roads++;
        }
      }
    expect(onRoads / roads).toBeLessThan((0.95 * all) / ((n - 2) * (n - 2)));
    // and they are curves, not straight lines
    const main = city.streets.filter((st) => st.cls === ROAD_MAIN && st.points.length > 2);
    const bend = Math.max(
      ...main.map((st) => {
        const a = st.points[0]!;
        const b = st.points[st.points.length - 1]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        return Math.max(
          ...st.points.map((p) => Math.abs((p.x - a.x) * (b.z - a.z) - (p.z - a.z) * (b.x - a.x)) / len),
        );
      }),
    );
    expect(bend).toBeGreaterThan(6);
    // so houses face every which way, not just the four compass points
    const quarter = Math.PI / 2;
    const turned = city.buildings.filter((b) => {
      const off = Math.abs(((b.angle % quarter) + quarter) % quarter);
      return off > 0.1 && off < quarter - 0.1;
    });
    expect(turned.length).toBeGreaterThan(city.buildings.length / 4);
  });

  it('sets every house on a level pad above the ground under it', () => {
    const city = generateCity('x', 3, 3, 'pz', hills);
    for (const b of city.buildings) {
      expect(b.base - b.foot).toBeLessThanOrEqual(TUNING.city.houses.maxRise + 0.13);
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      for (const [u, v] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const)
        expect(b.base).toBeGreaterThanOrEqual(
          groundAt(city, b.x + c * u * b.hw + s * v * b.hd, b.z - s * u * b.hw + c * v * b.hd) - 0.01,
        );
    }
  });

  it('produces a town worth painting, with yards to paint as well as houses', () => {
    const city = generateCity('x', 5, 5, 'pz', hills);
    expect(city.buildings.length).toBeGreaterThan(300);
    const yards = city.surfaces.filter((s) => s.kind === 'ground');
    expect(city.surfaces.length).toBe(city.buildings.length * 6 + yards.length);
    expect(yards.length).toBeGreaterThan(100);
    // every district has houses, a studio and something to paint
    for (let c = 0; c < city.chunks * city.chunks; c++)
      expect(city.buildings.filter((b) => city.surfaces[b.roof]!.chunk === c).length).toBeGreaterThan(5);
    expect(city.studios).toHaveLength(city.chunks * city.chunks);
    // a yard is found where it lies
    const y = yards[0]!;
    const cells = [...city.groundOf.keys()].filter((i) => city.groundOf[i] === city.surfaces.indexOf(y));
    const i = cells[0]!;
    expect(
      groundSurfaceAt(city, ((i % city.n) + 0.5) * city.cell, (Math.floor(i / city.n) + 0.5) * city.cell),
    ).toBe(city.surfaces.indexOf(y));
  });

  it('spawns the player on the main street, never in a house', () => {
    for (let s = 1; s <= 40; s++) {
      const city = generateCity('x', s * 7919, 2, 'pz', hills);
      const i = cellOf(city, city.spawn.x, city.spawn.z);
      expect(city.roads[i], `seed ${s * 7919}`).not.toBe(ROAD_NONE);
      expect(city.buildingOf[i], `seed ${s * 7919}`).toBe(0);
      // a few metres in from the gate
      expect(city.size - city.spawn.z).toBeGreaterThan(city.cell * 2);
    }
  });
});

describe('a town standing in the world', () => {
  const at = { x: 1236, z: -876 };

  it('moves every position with it', () => {
    const local = generateCity('x', 99, 3, 'pz', hills);
    const placed = placeCity(local, at);
    expect([placed.ox, placed.oz]).toEqual([at.x, at.z]);
    expect(placed.spawn.x - local.spawn.x).toBeCloseTo(at.x);
    expect(placed.surfaces[7]!.z - local.surfaces[7]!.z).toBeCloseTo(at.z);
    expect(placed.stains[0]!.x - local.stains[0]!.x).toBeCloseTo(at.x);
    expect(placed.requests[0]!.door.z - local.requests[0]!.door.z).toBeCloseTo(at.z);
    expect(placed.streets[1]!.points[2]!.x - local.streets[1]!.points[2]!.x).toBeCloseTo(at.x);
    for (const b of placed.buildings) {
      expect(b.x - local.buildings[b.id]!.x).toBeCloseTo(at.x);
      expect(b.base).toBe(local.buildings[b.id]!.base);
    }
    // the land stays put: it was always the land's own height
    expect(groundAt(placed, placed.spawn.x, placed.spawn.z)).toBeCloseTo(
      groundAt(local, local.spawn.x, local.spawn.z),
    );
  });

  it('keeps saved progress when it moves', () => {
    const local = generateCity('x', 99, 2);
    const placed = placeCity(local, at);
    const state = createWorldState('t', 1);
    const before = cityStates(state, 'x', local);
    before.stains[3] = 1;
    before.defeated[0] = 1;
    const after = cityStates(state, 'x', placed);
    expect(after.reset).toBe(false);
    expect(after.stains[3]).toBe(1);
    expect(after.defeated[0]).toBe(1);
  });

  it.each(['pz', 'nz', 'px', 'nx'] as const)('opens its main gate in the %s wall, facing in', (wall) => {
    for (const seed of SEEDS) {
      const city = generateCity('x', seed, 2, wall, hills);
      const g = city.gates[0]!;
      const edge = { pz: g.iz === city.n - 1, nz: g.iz === 0, px: g.ix === city.n - 1, nx: g.ix === 0 }[wall];
      expect(edge).toBe(true);
      // the player starts on the main street looking up it, into the town
      const fx = -Math.sin(city.spawn.yaw);
      const fz = -Math.cos(city.spawn.yaw);
      expect(fx * [1, 0, -1, 0][g.dir]! + fz * [0, 1, 0, -1][g.dir]!).toBeGreaterThan(0.3);
    }
  });

  it('finds paths through its streets in world coordinates', () => {
    const city = placeCity(generateCity('x', 99, 3, 'pz', hills), at);
    const nav = cityNav(city);
    const to = city.stains[city.stains.length - 1]!;
    const path = findPath(nav, city.spawn, to, 20000);
    expect(path).not.toBeNull();
    for (const p of path!) {
      const ix = Math.floor((p.x - city.ox) / city.cell);
      const iz = Math.floor((p.z - city.oz) / city.cell);
      expect(nav.walkable(ix, iz)).toBe(true);
    }
  });

  it('lies on the land: the town and the wilderness agree on the ground everywhere', () => {
    const w = createWilderness(4242);
    const e = w.entranceInCell(1, 1)!;
    const city = townLayout(e, w);
    for (let k = 0; k < 200; k++) {
      const x = e.ox + ((k * 37.3) % e.size);
      const z = e.oz + ((k * 91.7) % e.size);
      expect(groundAt(city, x, z)).toBeCloseTo(w.heightAt(x, z), 4);
    }
  });
});

describe('walking into a town', () => {
  it('goes from the hills through the main gate and up the main street', () => {
    const w = createWilderness(4242);
    const e = w.entranceInCell(0, 0)!;
    const city = townLayout(e, w);
    const physics = new PhysicsWorld(8);
    physics.ground = (x, z) => w.heightAt(x, z);
    buildCity(city, physics);
    const main = city.streets.find((s) => s.cls === ROAD_MAIN && s.points.length > 2)!;
    const g = city.gates[0]!;
    const out = { x: -[1, 0, -1, 0][g.dir]!, z: -[0, 1, 0, -1][g.dir]! };
    const first = main.points[0]!;
    const start = new THREE.Vector3(first.x + out.x * 15, 0, first.z + out.z * 15);
    start.y = w.heightAt(start.x, start.z) + 0.05;
    const body = makeBody(start, 0.35, 1.8, 0.55);
    // follow the street's middle, a point at a time
    let next = 0;
    for (let t = 0; t < 60 && next < main.points.length; t += 1 / 60) {
      const p = main.points[next]!;
      const dx = p.x - body.pos.x;
      const dz = p.z - body.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        next++;
        continue;
      }
      body.vel.x = (dx / d) * 5;
      body.vel.z = (dz / d) * 5;
      body.vel.y -= 22 / 60;
      physics.moveBody(body, 1 / 60);
      // feet on the ground the whole way: never sunk, never up on anything
      expect(Math.abs(body.pos.y - w.heightAt(body.pos.x, body.pos.z))).toBeLessThan(0.3);
    }
    expect(townDistance(e, body.pos.x, body.pos.z)).toBe(0);
    expect(Math.hypot(body.pos.x - city.square.x, body.pos.z - city.square.z)).toBeLessThan(
      city.square.r + 4,
    );
  });
});
