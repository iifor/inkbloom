import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { FISH_SPECIES } from '@/content/fish';
import { fishHabitat, fishSpeciesAt } from '@/world/wilderness/fish';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WildFish, shoalsInChunk } from '@/systems/wilderness/fish';
import { fishShape } from '@/systems/wilderness/fish-shape';
import { makeFishAtlas } from '@/systems/wilderness/fish-paint';

const world = {
  ...createWilderness(42),
  heightAt: () => WATER_LEVEL - 3,
  riverAt: () => ({ x: 10000, half: 12 }),
};
const chunk = { hasWater: true, n: 32, cell: 4, x0: 0, z0: 0 } as WildChunk;

it('keeps species stable across loads and gives shallows, channels and lakes different populations', () => {
  const shallow = { ...world, heightAt: () => WATER_LEVEL - 1.2 };
  const river = { ...world, riverAt: () => ({ x: 64, half: 12 }) };
  expect(fishHabitat(shallow, 64, 0)).toBe('shallows');
  expect(fishHabitat(river, 64, 0)).toBe('river');
  expect(fishHabitat(world, 64, 0)).toBe('lake');
  const count = (w: typeof world) => {
    const counts = new Map<string, number>();
    for (let z = 0; z < 1000; z += 4)
      for (let x = 56; x <= 72; x += 8) {
        const key = fishSpeciesAt(w, x, z).key;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        expect(fishSpeciesAt({ ...w }, x, z).key).toBe(key);
      }
    return counts;
  };
  const a = count(shallow),
    b = count(river),
    c = count(world);
  expect([...c.keys()].sort()).toEqual(FISH_SPECIES.map((s) => s.key).sort());
  expect(a.get('trout')).toBeUndefined();
  expect(a.get('minnow')!).toBeGreaterThan(c.get('minnow')! * 2);
  expect(b.get('trout')!).toBeGreaterThan(c.get('trout')! * 2);
  expect(c.get('koi')!).toBeLessThan(c.get('carp')! / 2);
});

it('has distinct body proportions and painted skins within the existing geometry budget', () => {
  const silhouettes = [];
  for (const species of FISH_SPECIES) {
    const shape = fishShape(species);
    shape.computeBoundingBox();
    const size = shape.boundingBox!.getSize(new THREE.Vector3());
    silhouettes.push([size.x * species.length, size.y, size.z].map((n) => n.toFixed(2)).join(','));
    expect(shape.getAttribute('position').count).toBeLessThan(300);
    expect([...shape.getAttribute('normal').array].every(Number.isFinite)).toBe(true);
    shape.dispose();
  }
  expect(new Set(silhouettes).size).toBe(FISH_SPECIES.length);
  const atlas = makeFishAtlas(),
    data = atlas.image.data as Uint8Array;
  const colours = FISH_SPECIES.map((_, i) => {
    const at = (128 * atlas.image.width + i * 256 + 128) * 4;
    return [...data.subarray(at, at + 3)].join(',');
  });
  expect(new Set(colours).size).toBe(FISH_SPECIES.length);
  expect(atlas.generateMipmaps).toBe(true);
  atlas.dispose();
});

it('batches by species, preserves total population and bed clearance, and releases streamed fish', () => {
  const root = new THREE.Group(),
    fish = new WildFish(root, () => {}),
    shoals = shoalsInChunk(chunk, world);
  const release = fish.add(chunk, world);
  const meshes = root.children as THREE.InstancedMesh[];
  expect(meshes.length).toBe(new Set(shoals.map((s) => s.species.key)).size);
  expect(meshes.reduce((sum, m) => sum + m.count, 0)).toBe(shoals.length * 4);
  expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
  const matrix = new THREE.Matrix4(),
    pos = new THREE.Vector3();
  for (let i = 0; i < 180; i++) {
    fish.update(i / 60, new THREE.Vector3(50, WATER_LEVEL, 50), 1 / 60);
    if (i % 30) continue;
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox();
      const stroke = mesh.geometry.boundingBox!.clone();
      stroke.min.z -= 0.17;
      stroke.max.z += 0.17;
      stroke.min.y -= 0.026;
      stroke.max.y += 0.026;
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, matrix);
        pos.setFromMatrixPosition(matrix);
        expect(pos.y).toBeLessThan(WATER_LEVEL - 0.2);
        expect(pos.y).toBeGreaterThan(world.heightAt() + 0.28);
        expect(mesh.boundingBox!.containsBox(stroke.clone().applyMatrix4(matrix))).toBe(true);
      }
    }
  }
  const keys = meshes.map((m) => m.userData.species);
  const released = meshes.map((m) => vi.spyOn(m, 'dispose'));
  release();
  release();
  expect(root.children).toHaveLength(0);
  for (const dispose of released) expect(dispose).toHaveBeenCalledTimes(1);
  fish.add(chunk, world);
  expect(root.children.map((m) => m.userData.species)).toEqual(keys);
  fish.dispose();
  expect(root.children).toHaveLength(0);
});
