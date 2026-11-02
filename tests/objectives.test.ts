import { describe, expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { generateCity } from '@/world/city/layout';
import { bearing, objective, type Situation } from '@/world/objectives';
import { createWilderness } from '@/world/wilderness/generator';

const base: Situation = {
  scene: 'wild',
  generic: 30,
  ink: 0,
  inkPerGeneric: 2,
  visitedCity: false,
  restoredCities: 0,
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
