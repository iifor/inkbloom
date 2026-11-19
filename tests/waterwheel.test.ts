import { expect, it } from 'vitest';
import { buildWaterwheel } from '@/systems/city/waterwheel';
import { generateCity, placeCity } from '@/world/city/layout';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { PhysicsWorld } from '@/engine/physics/world';

const city = generateCity('mill-test', 11, 3, 'nx', (x, z) =>
  Math.abs(x - 192) < 20 ? -3 : 2 + Math.sin(z / 80),
);

it('builds a grounded waterwheel assembly without changing saved town surfaces or placement', () => {
  expect(city.wheel).not.toBeNull();
  const before = JSON.stringify({ wheel: city.wheel, surfaces: city.surfaces, buildings: city.buildings });
  const mill = buildWaterwheel(city)!;
  expect(JSON.stringify({ wheel: city.wheel, surfaces: city.surfaces, buildings: city.buildings })).toBe(
    before,
  );
  mill.frame.computeBoundingBox();
  mill.rotor.computeBoundingBox();
  expect(mill.frame.boundingBox!.min.y + city.wheel!.y).toBeLessThan(WATER_LEVEL - 0.8);
  expect(mill.frame.boundingBox!.max.x).toBeGreaterThan(mill.rotor.boundingBox!.max.x);
  for (const geometry of [mill.rotor, mill.frame]) {
    for (const name of ['position', 'normal', 'aColor', 'aSurface']) {
      const values = geometry.getAttribute(name).array;
      expect(Array.from(values).every(Number.isFinite)).toBe(true);
    }
    expect(geometry.getIndex()!.count / 3).toBeLessThan(4000);
  }
  for (const b of mill.boxes) {
    expect(b.max.x).toBeGreaterThan(b.min.x);
    expect(b.max.y).toBeGreaterThan(b.min.y);
    expect(b.max.z).toBeGreaterThan(b.min.z);
  }
  const physics = new PhysicsWorld(8);
  for (const b of mill.boxes) physics.addBox('mill', b.min, b.max);
  expect(physics.boxCount).toBe(mill.boxes.length);
  physics.removeGroup('mill');
  expect(physics.boxCount).toBe(0);
  mill.rotor.dispose();
  mill.frame.dispose();
});

it('places colliders in world coordinates and keeps static and moving geometry separate', () => {
  const a = buildWaterwheel(city)!;
  const b = buildWaterwheel(placeCity(city, { x: -2400, z: 1700 }))!;
  expect(Array.from(a.frame.getAttribute('position').array)).toEqual(
    Array.from(b.frame.getAttribute('position').array),
  );
  expect(a.rotor).not.toBe(a.frame);
  for (let i = 0; i < a.boxes.length; i++) {
    expect(b.boxes[i]!.min.x - a.boxes[i]!.min.x).toBeCloseTo(-2400);
    expect(b.boxes[i]!.min.z - a.boxes[i]!.min.z).toBeCloseTo(1700);
  }
  for (const m of [a, b]) {
    m.rotor.dispose();
    m.frame.dispose();
  }
  expect(buildWaterwheel({ ...city, wheel: null })).toBeNull();
});
