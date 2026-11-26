import { describe, expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { habitatAnimals, lifeInChunk, lifeGround } from '@/world/wilderness/ambient-life';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { pathsOf } from '@/world/wilderness/paths';
import { springLevel } from '@/world/wilderness/landmarks';

describe('wilderness life', () => {
  it('anchors farm animals, bees and frogs to the scenery generated for their chunk', () => {
    const w = createWilderness(173);
    const farmChunk = generateWildChunk(w, -1, -1);
    const farm = farmChunk.farmstead!;
    const sites = habitatAnimals(w, farmChunk);
    const gate = farm.z + farm.front * farm.hd;
    const cat = sites.find((s) => s.kind === 'cat')!;
    expect(cat.count).toBe(1);
    expect(cat.z).toBe(gate);
    expect(Math.abs(cat.x - farm.x)).toBeCloseTo(1.55);
    const dog = sites.find((s) => s.kind === 'dog')!;
    expect((dog.z - gate) * farm.front).toBeGreaterThan(0);
    expect(Math.abs(dog.x - farm.x)).toBeGreaterThan(1.55);
    const chick = sites.find((s) => s.kind === 'chick')!;
    expect(chick.count).toBeGreaterThanOrEqual(2);
    expect((gate - chick.z) * farm.front).toBeGreaterThan(0);
    const chunk = generateWildChunk(w, 0, 0);
    const wild = habitatAnimals(w, chunk);
    const flower = chunk.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'flowers')!;
    expect(wild.find((s) => s.kind === 'bee')).toMatchObject({ x: flower.x, z: flower.z });
    const frog = wild.find((s) => s.kind === 'frog')!;
    const crab = wild.find((s) => s.kind === 'crab')!;
    const shell = chunk.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'shells')!;
    expect(Math.hypot(crab.x - shell.x, crab.z - shell.z)).toBeLessThan(20);
    expect(w.heightAt(crab.x, crab.z)).toBeLessThanOrEqual(WATER_LEVEL + 0.9);
    const forest = generateWildChunk(w, -1, 0);
    const bat = habitatAnimals(w, forest).find((s) => s.kind === 'bat')!;
    expect(forest.trees.every((t) => Math.hypot(t.x - bat.x, t.z - bat.z) >= t.crown + 3.3)).toBe(true);
    expect(w.heightAt(frog.x, frog.z)).toBeGreaterThan(WATER_LEVEL);
    expect(
      [
        [chunk.cell, 0],
        [-chunk.cell, 0],
        [0, chunk.cell],
        [0, -chunk.cell],
      ].some(([dx, dz]) => w.heightAt(frog.x + dx!, frog.z + dz!) < WATER_LEVEL),
    ).toBe(true);
    expect(habitatAnimals(w, chunk)).toEqual(wild);
    expect(
      habitatAnimals(w, {
        ...chunk,
        farmstead: null,
        sources: [],
        trees: [],
        groundProps: [],
        hasWater: false,
      }),
    ).toEqual([]);
  });
  it('anchors foraging birds and aerial wildlife to their generated landmarks', () => {
    const w = createWilderness(173);
    const forest = generateWildChunk(w, 0, 0);
    const berries = forest.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'berries')!;
    const bird = habitatAnimals(w, forest).find((s) => s.kind === 'berrybird')!;
    expect(Math.hypot(bird.x - berries.x, bird.z - berries.z)).toBeCloseTo(2.4);
    const pool = generateWildChunk(w, 2, -3);
    const spring = pool.springs[0]!;
    expect(habitatAnimals(w, pool).find((s) => s.kind === 'springSpirit')).toMatchObject({
      x: spring.x,
      z: spring.z,
      flightY: springLevel(spring, w) + 0.95,
    });
    const hill = generateWildChunk(w, 2, -1);
    const lookout = hill.lookouts[0]!;
    expect(habitatAnimals(w, hill).find((s) => s.kind === 'ridgeDragon')).toMatchObject({
      x: lookout.x,
      z: lookout.z,
      flightY: w.heightAt(lookout.x, lookout.z) + 4.8,
    });
    expect(
      habitatAnimals(w, { ...hill, springs: [], lookouts: [], sources: [] }).some(
        (s) => s.kind === 'ridgeDragon' || s.kind === 'springSpirit' || s.kind === 'berrybird',
      ),
    ).toBe(false);
  });
  it('places pandas by bamboo, mushroom sprites beside wood and penguins on a dry bank', () => {
    const w = createWilderness(173);
    const grove = generateWildChunk(w, 1, 3);
    const panda = habitatAnimals(w, grove).find((s) => s.kind === 'panda')!;
    expect(grove.trees.some((t) => t.kind === 'bamboo' && Math.hypot(panda.x - t.x, panda.z - t.z) < 5)).toBe(
      true,
    );
    expect(lifeGround(w, panda.x, panda.z, 2)).toBe(true);
    const wood = generateWildChunk(w, 0, 0);
    const sprite = habitatAnimals(w, wood).find((s) => s.kind === 'mushroom')!;
    expect(
      wood.groundProps.some(
        (p) =>
          (p.kind === 'windfall' || p.kind === 'stump') &&
          Math.abs(Math.hypot(p.x - sprite.x, p.z - sprite.z) - 1.5) < 0.001,
      ),
    ).toBe(true);
    const river = generateWildChunk(w, 1, 1);
    const sites = habitatAnimals(w, river);
    const penguins = sites.find((s) => s.kind === 'penguin')!;
    const bank = sites.find((s) => s.kind === 'frog')!;
    expect(Math.hypot(penguins.x - bank.x, penguins.z - bank.z)).toBe(river.cell);
    expect(lifeGround(w, penguins.x, penguins.z, 1)).toBe(true);
  });
  it('binds the remaining wildlife to existing landmarks, shelters and source ids', () => {
    const w = createWilderness(173);
    function home(cx: number, cz: number, kind: string) {
      const chunk = generateWildChunk(w, cx, cz);
      const site = habitatAnimals(w, chunk).find((s) => s.kind === kind)!;
      expect(site, kind).toBeDefined();
      return { chunk, site };
    }
    const mouse = home(-1, -1, 'fieldMouse');
    expect(Math.abs(mouse.site.shelter!.z - mouse.chunk.farmstead!.z)).toBeCloseTo(
      mouse.chunk.farmstead!.hd + 1.6,
    );
    const snake = home(1, 0, 'grassSnake');
    expect(snake.chunk.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'reeds')).toMatchObject(
      snake.site.shelter!,
    );
    const ore = home(2, -1, 'oreSpirit');
    expect(ore.chunk.sources.find((s) => s.id === ore.site.landmarkId)).toMatchObject({
      x: ore.site.x,
      z: ore.site.z,
    });
    const elder = home(0, 1, 'elderSpirit');
    expect(
      elder.chunk.trees.some(
        (t) => t.kind === 'great' && Math.hypot(t.x - elder.site.x, t.z - elder.site.z) < t.crown,
      ),
    ).toBe(true);
    const spider = home(0, 0, 'silkSpider');
    expect(spider.chunk.groundProps.find((p) => p.kind === 'stump')).toMatchObject(spider.site.shelter!);
    const ghost = home(2, 0, 'ruinGhost');
    expect(ghost.site.landmarkId).toBe(ghost.chunk.ruins[0]!.id);
  });
  it('populates varied dry habitats and roadside outings reproducibly', () => {
    const w = createWilderness(4242);
    const kinds = new Set<string>();
    let people = 0,
      animals = 0;
    for (let x = -5; x <= 5; x++)
      for (let z = -5; z <= 5; z++) {
        const sites = lifeInChunk(w, x, z);
        expect(lifeInChunk(w, x, z)).toEqual(sites);
        expect(sites.length).toBeLessThanOrEqual(2);
        for (const s of sites) {
          kinds.add(s.kind);
          expect(lifeGround(w, s.x, s.z, s.person ? 7 : 5)).toBe(true);
          expect(w.heightAt(s.x, s.z)).toBeGreaterThan(WATER_LEVEL + 0.9);
          expect(w.townAt(s.x, s.z, 18)).toBeNull();
          expect(Math.floor(s.x / 128)).toBe(x);
          expect(Math.floor(s.z / 128)).toBe(z);
          if (s.person) {
            people++;
            expect(pathsOf(w).edgeDistance(s.x, s.z)).toBeLessThan(8);
          } else animals++;
        }
      }
    expect(people).toBeGreaterThan(8);
    expect(animals).toBeGreaterThan(30);
    expect([...kinds].sort()).toEqual(['bird', 'boar', 'gatherer', 'rabbit', 'ranger', 'walker']);
    expect(lifeInChunk(createWilderness(4242), 2, -3)).toEqual(lifeInChunk(w, 2, -3));
  });
});
