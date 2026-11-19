import { expect, it } from 'vitest';
import { createWilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';
import * as THREE from 'three';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { buildTerrainSteps } from '@/systems/wilderness/build-chunk';
import { generateWildChunk } from '@/world/wilderness/chunk';

it('cuts the uphill bank and fills the downhill side of sloping footpaths', () => {
  const w = createWilderness(4242),
    net = pathsOf(w);
  let count = 0,
    before = 0,
    after = 0,
    cut = 0,
    fill = 0;
  for (const trail of net.trailsNear(-1500, -1500, 1500, 1500)) {
    const p = trail.pts;
    for (let i = 40; i + 42 < p.length; i += 10) {
      const x = p[i]!,
        z = p[i + 1]!,
        dx = p[i + 2]! - x,
        dz = p[i + 3]! - z;
      const length = Math.hypot(dx, dz);
      if (length < 0.01 || w.townAt(x, z, 24) || w.terrainHeightAt(x, z) < WATER_LEVEL + 2) continue;
      if (trail.bridges.some((b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), z - b.z) < 30)) continue;
      const sx = -dz / length,
        sz = dx / length,
        half = trail.width / 2;
      const a = w.terrainHeightAt(x - sx * half, z - sz * half);
      const b = w.terrainHeightAt(x + sx * half, z + sz * half);
      const old = Math.abs(b - a) / trail.width;
      if (old < 0.2) continue;
      const ca = w.heightAt(x - sx * half, z - sz * half);
      const cb = w.heightAt(x + sx * half, z + sz * half);
      const now = Math.abs(cb - ca) / trail.width;
      before += old;
      after += now;
      count++;
      cut += Math.max(0, a - ca, b - cb);
      fill += Math.max(0, ca - a, cb - b);
    }
  }
  expect(count).toBeGreaterThan(10);
  expect(after / before).toBeLessThan(0.6);
  expect(cut).toBeGreaterThan(1);
  expect(fill).toBeGreaterThan(1);
});

it.each([1, 2] as const)(
  'uses the same rendered and physical roadbed in terrain generation %i',
  (version) => {
    // Regression location of the original steep-bank report, on the saved generation.
    const w = createWilderness(4242, [], version);
    const builder = new GeometryBuilder();
    for (const _ of buildTerrainSteps(generateWildChunk(w, -12, -5), w, builder)) void _;
    const geometry = builder.build(),
      material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld();
    const ray = new THREE.Raycaster(),
      colors = geometry.getAttribute('aColor');
    let changed = 0;
    try {
      for (let x = -1478.5; x < -1464; x += 1.7)
        for (let z = -601.5; z < -585; z += 1.9) {
          ray.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
          const ground = ray.intersectObject(mesh).find((hit) => hit.face && colors.getX(hit.face.a) < 0);
          expect(ground).toBeDefined();
          expect(ground!.point.y).toBeCloseTo(w.heightAt(x, z), 4);
          if (Math.abs(w.heightAt(x, z) - w.terrainHeightAt(x, z)) > 0.1) changed++;
        }
      if (version === 1) expect(changed).toBeGreaterThan(20);
    } finally {
      geometry.dispose();
      material.dispose();
    }
  },
);
