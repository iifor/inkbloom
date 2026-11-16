import * as THREE from 'three';
import { expect, it } from 'vitest';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { WildTrees } from '@/systems/wilderness/wild-trees';
import { generateWildChunk } from '@/world/wilderness/chunk';
import { createWilderness } from '@/world/wilderness/generator';

it('switches each tree once across the detail band, including after a teleport and unload', () => {
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
  const check = (x: number, near: number) => {
    trees.update(pos.set(x, 0, 0));
    expect(count('tree-sprays')).toBe(near);
    expect(count('distant-trees')).toBe(2 - near);
  };
  check(0, 1);
  check(35, 1);
  check(45, 0);
  check(35, 0);
  check(29, 1);
  check(200, 1);
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
