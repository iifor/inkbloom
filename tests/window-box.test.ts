import * as THREE from 'three';
import { expect, it } from 'vitest';
import { color } from '@/content/palette';
import { makeBody, PhysicsWorld, surfaceAt } from '@/engine/physics/world';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { buildCountryHouse } from '@/systems/city/country-house';
import { buildCity } from '@/systems/city/build-city';
import { generateCity } from '@/world/city/layout';

it('retains flower box collision flags when the city rotates houses into place', () => {
  let planters = 0;
  buildCity(generateCity('window-boxes', 42, 1), {
    addBox(_group, min, max, data) {
      if (!data?.noAutoStep) return;
      planters++;
      expect(max.y - min.y).toBeCloseTo(1.105 - 0.83);
      expect(data.faces?.pz).toBeGreaterThanOrEqual(0);
    },
  });
  expect(planters).toBeGreaterThan(0);
});

it.each([1, -1] as const)('keeps the player and camera outside flower boxes facing %i', (front) => {
  const physics = new PhysicsWorld(8);
  physics.ground = () => 0;
  const grass = color('grass');
  buildCountryHouse(
    new GeometryBuilder(),
    {
      x0: -4,
      x1: 4,
      z0: -3,
      z1: 3,
      base: 0,
      height: 3.3,
      front: front === 1 ? 'pz' : 'nz',
      doorAt: 0,
      style: 'cottage',
      plaster: grass,
      tile: grass,
      doorColor: grass,
      surfaces: { walls: { px: 10, nx: 11, pz: 12, nz: 13 }, roof: 14, door: 15 },
    },
    (min, max, data) => physics.addBox('house', min, max, data),
  );

  const body = makeBody(new THREE.Vector3(2, 0, front * 5), 0.35, 1.8);
  for (let i = 0; i < 60; i++) {
    body.vel.set(0, -0.5, front * -6);
    physics.moveBody(body, 1 / 60);
  }
  expect(body.pos.z * front).toBeCloseTo(3.43 + body.halfW, 3);
  // A raised approach can put the rim within ordinary stair-stepping height.
  physics.ground = () => 0.7;
  body.pos.set(2, 0.7, front * 5);
  for (let i = 0; i < 60; i++) {
    body.vel.set(0, -0.5, front * -6);
    physics.moveBody(body, 1 / 60);
  }
  expect(body.pos.y).toBeCloseTo(0.7);
  expect(body.pos.z * front).toBeCloseTo(3.43 + body.halfW, 3);
  const from = { x: 2, y: 1.05, z: front * 5 };
  const hit = physics.raycast(from, { x: 0, y: 0, z: -front })!;
  expect(hit.point.z * front).toBeCloseTo(3.43);
  expect(surfaceAt(hit)).toBe(front === 1 ? 12 : 13);
});
