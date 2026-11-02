import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { generateCity } from '@/world/city/layout';
import { bearing, objective, type Situation } from '@/world/objectives';
import { createWilderness } from '@/world/wilderness/generator';
import { nextDestination } from '@/world/travel';

const base: Situation = {
  scene: 'wild',
  generic: 30,
  ink: 0,
  inkPerGeneric: 2,
  visitedCity: false,
  restoredCities: 0,
  drop: null,
  nextCity: { x: 300, z: 200, name: '青湾' },
};
const city = {
  name: '青湾',
  completed: false,
  coloredBlocks: 1,
  blocks: 4,
  gate: { x: 0, z: 0 },
  studio: { x: 10, z: 10 },
  stain: { x: 20, z: 20 },
  guards: 0,
  nearestGuard: null,
  holdsRifle: false,
};

describe('objectives', () => {
  it('sends a new player to the first tower', () => {
    const o = objective(base);
    expect(o.text).toContain('塔楼');
    expect(o.target).toEqual(base.nextCity);
  });

  it('in a city: paint, then refine, then soak up stains, then go home', () => {
    expect(objective({ ...base, scene: 'city', city }).text).toContain('有色街区 1 / 4');
    expect(objective({ ...base, scene: 'city', city, generic: 0, ink: 5 }).target).toEqual(city.studio);
    expect(objective({ ...base, scene: 'city', city, generic: 0, ink: 1 }).target).toEqual(city.stain);
    expect(objective({ ...base, scene: 'city', city, generic: 0, ink: 1 }).text).toContain('墨渍');
    expect(
      objective({ ...base, scene: 'city', city: { ...city, stain: null }, generic: 0, ink: 0 }).text,
    ).toContain('野外');
  });

  it('after a restored city, points at the next one', () => {
    expect(objective({ ...base, scene: 'city', city: { ...city, completed: true } }).target).toEqual(
      city.gate,
    );
    const o = objective({ ...base, visitedCity: true, restoredCities: 1 });
    expect(o.text).toContain('下一座城');
  });

  it('sends a player with nothing to paint with to the wilderness sources', () => {
    expect(objective({ ...base, visitedCity: true, generic: 0, ink: 0 }).text).toContain('采颜料');
  });

  it('turns target directions into arrows relative to the facing', () => {
    // yaw 0 faces -z
    expect(bearing({ x: 0, z: 0 }, 0, { x: 0, z: -50 })).toEqual({ arrow: '↑', metres: 50 });
    expect(bearing({ x: 0, z: 0 }, 0, { x: -50, z: 0 }).arrow).toBe('←');
    expect(bearing({ x: 0, z: 0 }, 0, { x: 50, z: 0 }).arrow).toBe('→');
    expect(bearing({ x: 0, z: 0 }, 0, { x: 0, z: 50 }).arrow).toBe('↓');
    expect(bearing({ x: 0, z: 0 }, Math.PI / 2, { x: -50, z: 0 }).arrow).toBe('↑');
  });
});

describe('combat objectives', () => {
  it('sends the player at a guarded block with the rifle', () => {
    const guarded = { ...city, guards: 3, nearestGuard: { x: 5, z: 5 } };
    expect(objective({ ...base, scene: 'city', city: guarded }).text).toContain('按 2 换步枪');
    const armed = objective({ ...base, scene: 'city', city: { ...guarded, holdsRifle: true } });
    expect(armed.text).toContain('开枪');
    expect(armed.target).toEqual({ x: 5, z: 5 });
  });

  it('points back at dropped ink before anything else', () => {
    const o = objective({
      ...base,
      scene: 'city',
      city: { ...city, guards: 2 },
      drop: { x: 9, z: 9, ink: 12 },
    });
    expect(o.text).toContain('12 墨');
    expect(o.target).toEqual({ x: 9, z: 9, ink: 12 });
  });
});

describe('travel', () => {
  it('rings through restored cities and needs at least two', () => {
    expect(nextDestination(['a'], 'a')).toBeNull();
    expect(nextDestination(['a', 'b'], 'x')).toBeNull();
    expect(nextDestination(['c', 'a', 'b'], 'a')).toBe('b');
    expect(nextDestination(['c', 'a', 'b'], 'c')).toBe('a');
  });
});

describe('the first city', () => {
  it('is small, so it can be finished in one sitting', () => {
    const w = createWilderness(20261102);
    const e = w.entranceInCell(0, 0)!;
    expect(e.chunks).toBe(TUNING.city.firstCityChunks);
    const first = generateCity(e.cityId, e.seed, e.chunks);
    expect(first.chunks).toBe(TUNING.city.firstCityChunks);
    expect(first.size).toBe(TUNING.city.firstCityChunks * TUNING.world.chunkSize);
    expect(first.studios.length).toBeLessThanOrEqual(first.chunks * first.chunks);
    expect(first.surfaces.every((s) => s.chunk < first.chunks * first.chunks)).toBe(true);
    const other = w.entrancesNear(3000, -2000, 1)[0]!;
    expect(other.chunks).toBe(TUNING.city.chunks);
  });
});

describe('strongholds', () => {
  it.each([1, 2, 3, 99])('stand on roads, in sized groups, never in the gate block (seed %i)', (seed) => {
    const c = generateCity('x', seed);
    const side = c.chunks;
    const spawnChunk =
      Math.floor(c.spawn.z / (c.size / side)) * side + Math.floor(c.spawn.x / (c.size / side));
    const [lo, hi] = TUNING.combat.stronghold.other;
    const perBlock = new Map<number, number>();
    for (const m of c.monsters) {
      expect(c.roads[Math.floor(m.z / c.cell) * c.n + Math.floor(m.x / c.cell)]).not.toBe(0);
      expect(m.chunk).not.toBe(spawnChunk);
      perBlock.set(m.chunk, (perBlock.get(m.chunk) ?? 0) + 1);
    }
    for (const n of perBlock.values()) {
      expect(n).toBeGreaterThanOrEqual(lo);
      expect(n).toBeLessThanOrEqual(hi);
    }
  });

  it('are lighter in the first city', () => {
    const w = createWilderness(20261102);
    const e = w.entranceInCell(0, 0)!;
    const c = generateCity(e.cityId, e.seed, e.chunks);
    const [, hi] = TUNING.combat.stronghold.first;
    expect(c.monsters.length).toBeGreaterThan(0);
    expect(c.monsters.length).toBeLessThanOrEqual(hi * (c.chunks * c.chunks - 1));
  });
});
