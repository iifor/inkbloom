import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { WildTrees } from '@/systems/wilderness/wild-trees';
import { type Tree, generateWildChunk, greatTreeIn } from '@/world/wilderness/chunk';
import { townLayout } from '@/world/city/layout';
import { WATER_LEVEL, createWilderness } from '@/world/wilderness/generator';

it('switches each tree once across each detail band, including after a teleport and unload', () => {
  const chunk = generateWildChunk(createWilderness(42), 0, 0);
  const tree = { x: 0, y: 0, z: 0, height: 4.2, crown: 1.6, color: color('canopy') };
  const root = new THREE.Group();
  const trees = new WildTrees(root);
  const pos = new THREE.Vector3();
  const release = trees.add({ ...chunk, trees: [tree, { ...tree, x: 200 }] }, pos);
  const count = (name: string) =>
    root.children
      .filter((m) => m.name === name && m.visible)
      .reduce((sum, m) => sum + (m as THREE.InstancedMesh).count, 0);
  // near (leaf sprays), far, remote (beyond 120 m, give or take 6)
  const check = (x: number, near: number, remote: number) => {
    trees.update(pos.set(x, 0, 0));
    expect(count('tree-sprays')).toBe(near);
    expect(count('remote-trees')).toBe(remote);
    expect(count('distant-trees')).toBe(2 - near - remote);
  };
  check(0, 1, 1);
  check(35, 1, 1);
  check(45, 0, 1);
  check(35, 0, 1);
  check(29, 1, 1);
  check(78, 0, 1);
  check(90, 0, 0);
  check(130, 0, 1);
  check(118, 0, 1);
  check(110, 0, 0);
  check(200, 1, 1);
  release();
  expect(root.children).toHaveLength(0);
  trees.dispose();
});

it('keeps the triangle order of loose faces and indexed templates in a merged mesh', () => {
  const g = new GeometryBuilder();
  const plane = new THREE.PlaneGeometry();
  const matrix = new THREE.Matrix4();
  g.mesh(plane, matrix, 1);
  g.meshSmooth(plane, matrix, 2);
  g.mesh(plane, matrix, 3);
  const combined = g.build();
  const index = combined.getIndex()!;
  const palette = combined.getAttribute('aColor');
  expect(index.count).toBe(18);
  expect(palette.count).toBe(16);
  expect(Array.from(index.array, (i) => palette.getX(i))).toEqual([1, 2, 3].flatMap((c) => Array(6).fill(c)));
  combined.dispose();
  plane.dispose();
});

describe('great trees', () => {
  const w = createWilderness(4242);
  const found: { cx: number; cz: number; t: Tree }[] = [];
  for (let cx = -8; cx <= 8; cx++)
    for (let cz = -8; cz <= 8; cz++) {
      const t = greatTreeIn(w, cx, cz);
      if (t) found.push({ cx, cz, t });
    }

  it('stand now and then, alone, on gentle dry open ground', () => {
    // a few in every stretch of country (towns take half the land), not a forest of them
    expect(found.length).toBeGreaterThan(289 * 0.05);
    expect(found.length).toBeLessThan(289 * 0.2);
    for (const { cx, cz, t } of found) {
      expect(t.kind).toBe('great');
      expect(t.height).toBeGreaterThan(15);
      expect(w.townAt(t.x, t.z, 30)).toBeNull();
      expect(w.heightAt(t.x, t.z)).toBeGreaterThan(WATER_LEVEL + 1.2);
      // the chunk gives it room: no other tree under its spread
      const chunk = generateWildChunk(w, cx, cz);
      expect(chunk.trees.filter((o) => o.kind === 'great')).toHaveLength(1);
      for (const o of chunk.trees)
        if (o.kind !== 'great') expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThanOrEqual(14);
    }
  });

  it('stands in a town too, near its square', () => {
    const e = w.entranceInCell(1, 1)!;
    const city = townLayout(e, w);
    const great = city.trees.filter((t) => t.kind === 'great');
    expect(great).toHaveLength(1);
    expect(Math.hypot(great[0]!.x - city.square.x, great[0]!.z - city.square.z)).toBeLessThan(120);
  });
});
