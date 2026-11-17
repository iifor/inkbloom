import * as THREE from 'three';
import { expect, it } from 'vitest';
import { makeWindMap } from '@/engine/render/wind-map';
import { GrassField } from '@/systems/wilderness/grass';
import { grassCoverAt } from '@/world/climate/calendar';
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
    root.traverseVisible((obj) => {
      if (obj.name !== 'grass-tufts') return;
      const mesh = obj as THREE.InstancedMesh;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const x = matrix.elements[12],
          z = matrix.elements[14];
        if (Math.abs(x + 2) > 0.95 || Math.abs(z + 3) > 0.95) continue;
        const key = `${x},${z}`;
        expect(plants.has(key)).toBe(false);
        plants.set(key, [...matrix.elements, mesh.instanceColor!.getX(i), mesh.instanceColor!.getZ(i)]);
      }
    });
    return plants;
  };
  const original = sample(12);
  expect(original.size).toBeGreaterThan(3);
  expect(new Set([...original.values()].map((plant) => plant.at(-1))).size).toBeGreaterThan(3);
  for (const distance of [7, 5.5, 2.3, 5, 10]) expect(sample(distance)).toEqual(original);
  expect(sample(-180).size).toBe(0);
  expect(sample(7)).toEqual(original);
  field.dispose();
  expect(root.children).toHaveLength(0);
});

it('carries gusts and crosswinds smoothly across the wind map seams', () => {
  const map = makeWindMap(42);
  const { data, width, height } = map.image;
  expect([map.wrapS, map.wrapT]).toEqual([THREE.RepeatWrapping, THREE.RepeatWrapping]);
  for (const channel of [0, 1]) {
    const at = (x: number, z: number) => data[(z * width + x) * 2 + channel]!;
    let seam = 0,
      distant = 0;
    for (let i = 0; i < width; i++) {
      seam += Math.abs(at(0, i) - at(width - 1, i)) + Math.abs(at(i, 0) - at(i, height - 1));
      distant += Math.abs(at(0, i) - at(width / 2, i)) + Math.abs(at(i, 0) - at(i, height / 2));
    }
    expect(distant).toBeGreaterThan(0);
    expect(seam).toBeLessThan(distant * 0.1);
  }
  map.dispose();
});

it('leaves the meadow bare all winter and brings back the same tufts in spring', () => {
  let samples = 0;
  const fieldRoot = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(65, 1.5, 0.1, 200);
  camera.position.set(0, 3, 0);
  const field = new GrassField(
    {
      ...createWilderness(42),
      heightAt: () => {
        samples++;
        return 1;
      },
      climate: () => ({ relief: 0, moisture: 0, water: 1, wildness: 0 }),
    },
    fieldRoot,
    camera,
  );
  const player = new THREE.Vector3();
  const tuftsAt = (phase: number) => {
    field.update(player, 1, grassCoverAt(phase));
    const positions = new Set<string>();
    fieldRoot.traverseVisible((obj) => {
      if (obj.name !== 'grass-tufts') return;
      const mesh = obj as THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const density = mesh.material.uniforms.uDensity!.value;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        if (mesh.instanceColor!.getY(i) >= density) continue;
        mesh.getMatrixAt(i, matrix);
        positions.add(`${matrix.elements[12]},${matrix.elements[14]}`);
      }
    });
    return positions;
  };
  expect(tuftsAt(0.875).size).toBe(0);
  expect(samples).toBe(0);
  const summer = tuftsAt(0.375);
  const autumn = tuftsAt(0.6875);
  expect(autumn.size).toBeGreaterThan(summer.size * 0.4);
  expect(autumn.size).toBeLessThan(summer.size * 0.6);
  const beforeWinter = samples;
  player.x = 180;
  for (const phase of [0.75, 0.875, 0.9999, 0]) {
    expect(tuftsAt(phase).size).toBe(0);
    const visible: string[] = [];
    fieldRoot.traverseVisible((obj) => {
      if (obj instanceof THREE.InstancedMesh) visible.push(obj.name);
    });
    expect(visible).toEqual([]);
  }
  expect(samples).toBe(beforeWinter);
  player.x = 0;
  expect(tuftsAt(0.0625)).toEqual(autumn);
  expect(tuftsAt(0.125)).toEqual(summer);
  field.dispose();
});
