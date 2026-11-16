import * as THREE from 'three';
import { expect, it } from 'vitest';
import { GrassField } from '@/systems/wilderness/grass';
import { createWilderness } from '@/world/wilderness/generator';

it('keeps the same visible grass on an approach, a retreat and a revisit after streaming it out', () => {
  const land = {
    ...createWilderness(42),
    heightAt: () => 1,
    climate: () => ({ relief: 0, moisture: 0, water: 1, wildness: 0 }),
  };
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(65, 1.5, 0.1, 200);
  const field = new GrassField(land, root, camera);
  const player = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const sample = (distance: number) => {
    player.set(-2, 1, -3 + distance);
    camera.position.copy(player).y += 1.6;
    camera.lookAt(-2, 1, -3);
    field.update(player);
    const plants = new Map<string, number[]>();
    for (const obj of root.children) {
      if (!obj.visible || obj.name !== 'grass-tufts') continue;
      const mesh = obj as THREE.InstancedMesh;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const x = matrix.elements[12],
          z = matrix.elements[14];
        if (Math.abs(x + 2) > 0.95 || Math.abs(z + 3) > 0.95) continue;
        const key = `${x},${z}`;
        expect(plants.has(key)).toBe(false);
        plants.set(key, [...matrix.elements, mesh.instanceColor!.getX(i)]);
      }
    }
    return plants;
  };
  const original = sample(12);
  expect(original.size).toBeGreaterThan(3);
  for (const distance of [7, 5.5, 2.3, 5, 10]) expect(sample(distance)).toEqual(original);
  expect(sample(-180).size).toBe(0);
  expect(sample(7)).toEqual(original);
  field.dispose();
  expect(root.children).toHaveLength(0);
});
