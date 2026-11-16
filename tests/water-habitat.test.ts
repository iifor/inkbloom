import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';
import { sourcesInChunk, sourceById } from '@/world/wilderness/sources';
import { WildFish, shoalsInChunk } from '@/systems/wilderness/fish';
import { buildChunkGeometry } from '@/systems/wilderness/build-chunk';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';

it('interpolates the sandy riverbed across terrain vertices and adjoining chunk edges', () => {
  const world = createWilderness(42);
  // A dry riverbed crossing both chunks, with a gradual sand-to-meadow transition along z.
  const w = {
    ...world,
    climate: (_x: number, z: number) => ({
      wildness: 1,
      relief: 0,
      moisture: 0,
      water: z / 1400,
    }),
  };
  const edge = (cx: number) => {
    const chunk = generateWildChunk(w, cx, 0);
    const mesh = buildChunkGeometry({ ...chunk, trees: [] }, w).build();
    const pos = mesh.getAttribute('position'),
      soil = mesh.getAttribute('aColor');
    const samples = new Map<number, number>();
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) !== chunk.n * chunk.cell) continue;
      const z = pos.getZ(i),
        code = soil.getX(i);
      if (samples.has(z)) expect(code).toBe(samples.get(z));
      samples.set(z, code);
    }
    mesh.dispose();
    return samples;
  };
  const west = edge(0);
  expect(west).toEqual(edge(1));
  expect(west.get(0)).toBe(-1);
  expect(west.get(128)).toBe(-2);
  expect(new Set(west.values()).size).toBeGreaterThan(20);
});

it('scatters fish in water on approach, leaves wakes, and regroups after the player leaves', () => {
  const w = createWilderness(42),
    chunk = generateWildChunk(w, 1, -1),
    shoal = shoalsInChunk(chunk, w)[0]!;
  const root = new THREE.Group();
  let wakes = 0,
    t = 0;
  const fish = new WildFish(root, () => {
      wakes++;
    }),
    unload = fish.add(chunk, w);
  const player = new THREE.Vector3(shoal.x + 25, WATER_LEVEL, shoal.z);
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) fish.update((t += 1 / 60), player, 1 / 60);
  };
  const matrix = new THREE.Matrix4(),
    mesh = root.children[0] as THREE.InstancedMesh;
  // The chunk bound is fixed while the fish flee; include the outer tail sweep
  // when checking that frustum culling cannot make a fish vanish at the edge.
  mesh.geometry.computeBoundingBox();
  const strokeBounds = mesh.geometry.boundingBox!.clone();
  strokeBounds.min.z -= 0.17;
  strokeBounds.max.z += 0.17;
  const positions = () =>
    Array.from({ length: 4 }, (_, i) => {
      mesh.getMatrixAt(i, matrix);
      expect(mesh.boundingBox!.containsBox(strokeBounds.clone().applyMatrix4(matrix))).toBe(true);
      return new THREE.Vector3().setFromMatrixPosition(matrix);
    });
  const spread = (p: THREE.Vector3[]) =>
    p[0]!.distanceTo(p[1]!) + p[0]!.distanceTo(p[2]!) + p[0]!.distanceTo(p[3]!);
  advance(60);
  const calm = spread(positions());
  player.x = shoal.x + 0.5;
  advance(90);
  expect(spread(positions())).toBeGreaterThan(calm + 3);
  expect(wakes).toBeGreaterThan(0);
  for (const p of positions()) {
    expect(p.y).toBeLessThan(WATER_LEVEL);
    expect(w.heightAt(p.x, p.z)).toBeLessThan(p.y);
  }
  player.x += 30;
  advance(600);
  for (const p of positions()) expect(Math.hypot(p.x - shoal.x, p.z - shoal.z)).toBeLessThan(2.6);
  unload();
  expect(root.children).toHaveLength(0);
  fish.dispose();
});

it('provides a broad lake and a shallow puddle near the wilderness spawn', () => {
  for (const seed of [1, 42, 20261102, -12]) {
    const w = createWilderness(seed);
    expect(WATER_LEVEL - w.heightAt(36, 89)).toBeGreaterThan(0.15);
    expect(WATER_LEVEL - w.heightAt(36, 89)).toBeLessThan(0.7);
    let deep = 0;
    for (let x = 30; x < 280; x += 5) if (w.heightAt(x, -102) < WATER_LEVEL - 1.2) deep += 5;
    expect(deep).toBeGreaterThan(150);
  }
});

it('places harvestable scallops in the starter shallows with a stable source id', () => {
  for (const seed of [1, 42, 20261102, -12]) {
    const w = createWilderness(seed);
    const shell = sourcesInChunk(w, 0, 0).find((s) => PIGMENT_SOURCES[s.kind]?.key === 'shells');
    expect(shell).toBeDefined();
    const depth = WATER_LEVEL - w.heightAt(shell!.x, shell!.z);
    expect(depth).toBeGreaterThanOrEqual(0);
    expect(depth).toBeLessThanOrEqual(0.55);
    expect(sourceById(w, shell!.id)).toEqual(shell);
  }
});
