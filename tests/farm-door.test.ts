import * as THREE from 'three';
import { expect, it } from 'vitest';
import { makeBody } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Interactable } from '@/game/types';
import { buildFarmstead } from '@/systems/wilderness/build-farmstead';
import { mountFarmDoor } from '@/systems/wilderness/farm-door';
import { headless } from './support/headless';

it.each([1, -1] as const)('walks up to, opens and crosses a raised farm door facing %s', (front) => {
  const h = headless();
  const { ctx, physics } = h;
  physics.ground = () => 0;
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  const doorItems: Interactable[] = [];
  Object.assign(ctx, {
    interactions: {
      add: (it: Interactable) => {
        doorItems.push(it);
        return () => doorItems.splice(doorItems.indexOf(it), 1);
      },
    },
  });
  const unload: (() => void)[] = [];
  buildFarmstead(
    new GeometryBuilder(),
    { heightAt: () => 0 },
    {
      x: 0,
      z: 0,
      hw: 9,
      hd: 10,
      front,
      stoneWall: false,
      seed: 12,
      buildings: [
        { x: 0, z: 0, hw: 4, hd: 3, foot: -0.1, base: 0.82, height: 3.5, barn: false, residents: 2 },
      ],
    },
    (min, max, data) => physics.addBox('farm', min, max, data),
    (door) => unload.push(mountFarmDoor(ctx, root, mat, physics, 'door', door)),
  );
  const body = makeBody(new THREE.Vector3(0, 0.02, 5.8 * front), 0.35, 1.8, 0.55);
  const walk = (dir: number, frames: number) => {
    for (let i = 0; i < frames; i++) {
      body.vel.set(0, -0.5, dir * front * 3);
      physics.moveBody(body, 1 / 60);
    }
    h.place(body.pos.x, body.pos.y, body.pos.z);
  };
  const door = doorItems[0]!;
  walk(-1, 90);
  expect(body.pos.y).toBeCloseTo(0.82);
  expect(body.pos.z * front).toBeGreaterThan(3.35);
  expect(door.label()).toBe('开门');
  door.activate();
  expect(door.label()).toBe('关门');
  walk(-1, 36);
  expect(body.pos.y).toBeCloseTo(0.82);
  expect(body.pos.z * front).toBeLessThan(2.3);
  walk(1, 65);
  expect(body.pos.z * front).toBeGreaterThan(4);
  h.place(0, 0.8, front * 3.75);
  door.activate();
  expect(door.label()).toBe('开门');
  h.place(0, 0.82, front * 2.42);
  door.activate();
  expect(door.label()).toBe('关门');
  unload[0]!();
  expect(doorItems).toHaveLength(0);
  expect(root.children).toHaveLength(0);
  mat.dispose();
});
