import { expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { buildFarmstead } from '@/systems/wilderness/build-farmstead';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { farmsteadInChunk } from '@/world/wilderness/farmsteads';
import { createWilderness, townDistance, WATER_LEVEL } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';

it('streams an isolated farmstead with a clear yard, a solid fence and an open gate', () => {
  const w = createWilderness(4242);
  const old = createWilderness(w.seed, [], 3);
  const size = TUNING.world.chunkSize;
  let chunk;
  for (let cz = -3; cz <= 3 && !chunk; cz++)
    for (let cx = -3; cx <= 3 && !chunk; cx++) {
      if (!farmsteadInChunk(w, cx, cz, [])) continue;
      const candidate = generateWildChunk(w, cx, cz);
      if (candidate.farmstead) chunk = candidate;
    }
  expect(chunk).toBeDefined();
  const { cx, cz, x0, z0, trees, farmstead } = chunk!;
  const yard = farmstead!;
  expect(generateWildChunk(old, cx, cz).farmstead).toBeNull();
  expect(generateWildChunk(createWilderness(w.seed), cx, cz).farmstead).toEqual(yard);
  expect(yard.x - yard.hw).toBeGreaterThan(x0);
  expect(yard.x + yard.hw).toBeLessThan(x0 + size);
  expect(yard.z - yard.hd).toBeGreaterThan(z0);
  expect(yard.z + yard.hd).toBeLessThan(z0 + size);
  expect(yard.buildings.length).toBeGreaterThanOrEqual(1);
  expect(yard.buildings.length).toBeLessThanOrEqual(3);
  expect(trees.some((t) => Math.abs(t.x - yard.x) <= yard.hw && Math.abs(t.z - yard.z) <= yard.hd)).toBe(
    false,
  );
  for (let x = yard.x - yard.hw; x <= yard.x + yard.hw; x += 2)
    for (let z = yard.z - yard.hd; z <= yard.z + yard.hd; z += 2) {
      expect(w.heightAt(x, z)).toBeGreaterThan(WATER_LEVEL);
      expect(pathsOf(w).edgeDistance(x, z)).toBeGreaterThan(0);
    }

  const physics = new PhysicsWorld(8);
  const mesh = new GeometryBuilder();
  buildFarmstead(mesh, w, yard, (min, max, data) => physics.addBox('farmstead', min, max, data));
  const entry = yard.z + yard.front * yard.hd;
  const towards = { x: 0, y: 0, z: -yard.front };
  const from = (x: number) => ({ x, y: w.heightAt(x, entry) + 0.5, z: entry + yard.front });
  expect(physics.raycast(from(yard.x), towards, 2)).toBeNull();
  expect(physics.raycast(from(yard.x + 3), towards, 2)).not.toBeNull();
  expect(mesh.build().getAttribute('position').count).toBeGreaterThan(0);
  physics.removeGroup('farmstead');
  expect(physics.boxCount).toBe(0);
});

it('places more occupied homes around an infected village than at the same peaceful site', () => {
  const w = createWilderness(4242);
  const town = w.entranceInCell(0, 0)!;
  const homes = (peaceful: boolean) => {
    const residents: number[] = [];
    const size = TUNING.world.chunkSize;
    for (
      let cx = Math.floor((town.ox - 180) / size);
      cx <= Math.floor((town.ox + town.size + 180) / size);
      cx++
    )
      for (
        let cz = Math.floor((town.oz - 180) / size);
        cz <= Math.floor((town.oz + town.size + 180) / size);
        cz++
      ) {
        const farm = farmsteadInChunk(w, cx, cz, [], () => peaceful);
        if (!farm || townDistance(town, farm.x, farm.z) > 180) continue;
        for (const building of farm.buildings) {
          if (building.barn) expect(building.residents).toBe(0);
          else residents.push(building.residents);
        }
      }
    return residents;
  };
  const ordinary = homes(true),
    infected = homes(false);
  expect(ordinary.length).toBeGreaterThan(0);
  expect(infected.length).toBeGreaterThan(ordinary.length);
  expect(ordinary.every((n) => n === 1 || n === 2)).toBe(true);
  expect(infected.every((n) => n === 2 || n === 3)).toBe(true);
});
