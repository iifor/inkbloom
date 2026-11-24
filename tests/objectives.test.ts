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
  holdsWeapon: false,
};

describe('objectives', () => {
  it('sends a new player into the first town', () => {
    const o = objective(base);
    expect(o.text).toContain('走进');
    expect(o.target).toEqual(base.nextCity);
  });

  it('in a city: paint, then refine, then soak up stains, then go home', () => {
    expect(objective({ ...base, scene: 'city', city }).text).toContain('有色街区 1/4');
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

describe('peaceful village objectives', () => {
  it('points back to exploration even when the player has no pigment', () => {
    const safe = { ...city, peaceful: true, coloredBlocks: 4, stain: null };
    const quiet = objective({ ...base, scene: 'city', city: safe, generic: 0 });
    expect(quiet.text).toContain('安然无恙');
    expect(quiet.target).toEqual(safe.gate);
  });
});

describe('combat objectives', () => {
  it('sends the player at a guarded block with the rifle', () => {
    const guarded = { ...city, guards: 3, nearestGuard: { x: 5, z: 5 } };
    // the how-to is a lesson the HUD shows the first time or two
    const unarmed = objective({ ...base, scene: 'city', city: guarded });
    expect(unarmed.text).toContain('3 只墨怪');
    expect(unarmed.teach?.text).toContain('按 2');
    const armed = objective({ ...base, scene: 'city', city: { ...guarded, holdsWeapon: true } });
    expect(armed.teach?.text).toContain('左键攻击');
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
    expect([1, 2, 3, 4, 5]).toContain(other.chunks);
  });
});

describe('strongholds', () => {
  it.each([1, 2, 3, 5])('places infected villagers on streets in proportion to houses (size %i)', (side) => {
    const c = generateCity('x', 42, side);
    expect(c.monsters.length).toBeGreaterThanOrEqual(c.buildings.length);
    expect(c.monsters.length).toBeLessThanOrEqual(c.buildings.length * 1.5);
    const spawnChunk =
      Math.floor(c.spawn.z / (c.size / side)) * side + Math.floor(c.spawn.x / (c.size / side));
    for (const m of c.monsters) {
      expect(c.roads[Math.floor(m.z / c.cell) * c.n + Math.floor(m.x / c.cell)]).not.toBe(0);
      if (side > 1) expect(m.chunk).not.toBe(spawnChunk);
      else expect(Math.hypot(m.x - c.spawn.x, m.z - c.spawn.z)).toBeGreaterThan(12);
    }
  });
});
