import { describe, expect, it } from 'vitest';
import { BIOMES } from '@/content/biomes';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { TUNING } from '@/content/tuning';
import { ROAD_NONE, generateCity } from '@/world/city/layout';
import { studioOpen } from '@/world/city/features';
import { createWilderness } from '@/world/wilderness/generator';
import { sourceById, sourcesInChunk } from '@/world/wilderness/sources';
import { generateWildChunk } from '@/world/wilderness/chunk';

const SEED = 20261102;

describe('wilderness pigment sources', () => {
  it('are deterministic, unique and findable by id', () => {
    const w = createWilderness(SEED);
    const all = [];
    for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) all.push(...sourcesInChunk(w, cx, cz));
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    const again = createWilderness(SEED);
    for (const s of all.slice(0, 10)) expect(sourceById(again, s.id)).toEqual(s);
  });

  it('sit inside their chunk, on a matching biome, away from spawn', () => {
    const w = createWilderness(SEED);
    const size = TUNING.world.chunkSize;
    for (let cx = -3; cx <= 3; cx++)
      for (let cz = -3; cz <= 3; cz++)
        for (const s of sourcesInChunk(w, cx, cz)) {
          expect(Math.floor(s.x / size)).toBe(cx);
          expect(Math.floor(s.z / size)).toBe(cz);
          const def = PIGMENT_SOURCES[s.kind]!;
          expect(def.biomes as readonly string[]).toContain(BIOMES[w.biomeAt(s.x, s.z)]!.key);
          expect(def.colors as readonly number[]).toContain(s.color);
          expect(Math.hypot(s.x, s.z)).toBeGreaterThanOrEqual(12);
        }
  });

  it('keep trees off themselves', () => {
    const w = createWilderness(SEED);
    for (let cx = -2; cx <= 2; cx++) {
      const c = generateWildChunk(w, cx, 1);
      for (const s of c.sources)
        expect(c.trees.every((t) => Math.hypot(t.x - s.x, t.z - s.z) >= 4)).toBe(true);
    }
  });
});

describe('city ink stains and studios', () => {
  it.each([1, 2, 3, 99, 12345])('places stains on roads and studios at real doors (seed %i)', (seed) => {
    const city = generateCity('x', seed);
    const { n, cell } = city;
    const side = TUNING.city.chunks;
    const perChunk = new Array(side * side).fill(0);
    for (const s of city.stains) {
      expect(city.roads[Math.floor(s.z / cell) * n + Math.floor(s.x / cell)]).not.toBe(ROAD_NONE);
      perChunk[s.chunk]++;
    }
    for (const c of perChunk) expect(c).toBeLessThanOrEqual(TUNING.economy.stainsPerChunk);
    expect(city.stains.length).toBeGreaterThan(side * side * TUNING.economy.stainsPerChunk * 0.4);

    const chunks = new Set<number>();
    for (const st of city.studios) {
      expect(chunks.has(st.chunk)).toBe(false);
      chunks.add(st.chunk);
      const b = city.buildings[st.building]!;
      expect(city.surfaces[b.roof]!.chunk).toBe(st.chunk);
      // the door point is on open ground, not inside a building
      expect(city.buildingOf[Math.floor(st.door.z / cell) * n + Math.floor(st.door.x / cell)]).toBe(0);
    }
    expect(city.homeStudio).toBeGreaterThanOrEqual(0);
    const drained = new Uint8Array(city.surfaces.length);
    expect(studioOpen(city, drained, city.homeStudio)).toBe(true);
    const other = city.studios.findIndex((_, i) => i !== city.homeStudio);
    expect(studioOpen(city, drained, other)).toBe(false);
  });

  it('can refine enough from one city to make real progress', () => {
    const city = generateCity('x', 5);
    const ink = city.stains.length * TUNING.economy.inkPerStain;
    const generic = Math.floor(ink / TUNING.economy.inkPerGeneric);
    // design: a city's own ink should cover a good share of it, the rest comes from the wild
    expect(generic / city.surfaces.length).toBeGreaterThan(0.25);
  });
});
