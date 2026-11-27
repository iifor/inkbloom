import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { countrysideSites } from '@/world/wilderness/countryside';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { habitatAnimals } from '@/world/wilderness/ambient-life';

describe('countryside models', () => {
  const world = createWilderness(173);
  it('keeps fields reproducible and livestock inside the farm enclosure', () => {
    const chunk = generateWildChunk(world, -1, -1);
    const field = countrysideSites(world, chunk);
    expect(countrysideSites(world, chunk)).toEqual(field);
    expect(field.some((s) => s.model.startsWith('Corn_'))).toBe(true);
    expect(field.some((s) => s.model === 'windmill')).toBe(true);
    const animal = habitatAnimals(world, chunk).find((s) => s.kind === 'donkey')!;
    const farm = chunk.farmstead!;
    expect(Math.abs(animal.x - farm.x)).toBeLessThan(farm.hw - 1);
    expect(Math.abs(animal.z - farm.z)).toBeLessThan(farm.hd - 1);
  });
  it('places floating hulls over water and puts the waterwheel on the wet side of the bank', () => {
    const boat = countrysideSites(world, generateWildChunk(world, 1, 0)).find(
      (s) => s.model === 'sea_boat_sail_a',
    )!;
    expect(boat.y).toBeGreaterThan(world.heightAt(boat.x, boat.z));
    const mill = countrysideSites(world, generateWildChunk(world, 0, -2)).find(
      (s) => s.model === 'watermill',
    )!;
    const dx = Math.sin(mill.yaw),
      dz = Math.cos(mill.yaw);
    expect(world.heightAt(mill.x - 1.5 * dx, mill.z - 1.5 * dz)).toBeLessThan(WATER_LEVEL);
    expect(world.heightAt(mill.x + 1.8 * dx, mill.z + 1.8 * dz)).toBeGreaterThan(WATER_LEVEL);
  });
  it('ships the locomotion and feeding clips played by each animal', () => {
    for (const name of ['Fox', 'Cow', 'Horse', 'Donkey']) {
      const glb = readFileSync(`public/models/countryside/${name}.glb`);
      const data = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
      const names = data.animations.map((a: { name: string }) => a.name.split('|').pop());
      expect(names).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Gallop', 'Eating']));
    }
  });
});
