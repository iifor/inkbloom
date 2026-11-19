import * as THREE from 'three';
import { afterEach, expect, it } from 'vitest';
import { FlagCloth, WindFlags, type FlagSpec } from '@/engine/render/wind-flags';
import { shared } from '@/engine/render/ink-material';
import { makeWindMap, sampleWindMap } from '@/engine/render/wind-map';
import { lookoutFlag } from '@/systems/wilderness/build-landmarks';
import { createWilderness } from '@/world/wilderness/generator';
import { lookoutInCell } from '@/world/wilderness/landmarks';

const spec: FlagSpec = { x: 0, y: 4, z: 0, width: 0.9, height: 0.5, color: 2, phase: 1.2 };
const oldWind = shared.uWind.value.clone();
const oldTime = shared.uTime.value;
const oldDrift = shared.uWindDrift.value.clone();
afterEach(() => {
  shared.uWind.value.copy(oldWind);
  shared.uWindDrift.value.copy(oldDrift);
  shared.uTime.value = oldTime;
});

function setup() {
  const material = new THREE.MeshBasicMaterial();
  const map = makeWindMap(123);
  const flag = new FlagCloth(spec, material);
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      shared.uTime.value += 1 / 60;
      flag.update(1 / 60, map);
    }
  };
  const positions = () => Array.from(flag.mesh.geometry.getAttribute('position').array);
  const tip = () => {
    const pos = flag.mesh.geometry.getAttribute('position');
    return new THREE.Vector3().fromBufferAttribute(pos, 16);
  };
  return {
    flag,
    step,
    positions,
    tip,
    dispose: () => {
      flag.dispose();
      map.dispose();
      material.dispose();
    },
  };
}

it('hangs down in still air and does not keep fluttering as time passes', () => {
  shared.uWind.value.set(0, 0);
  const f = setup();
  f.step(0.1);
  expect(f.tip().y).toBeLessThan(-spec.width * 0.8);
  expect(Math.hypot(f.tip().x, f.tip().z)).toBeLessThan(spec.width * 0.3);
  const before = f.positions();
  f.step(3);
  expect(f.positions()).toEqual(before);
  f.dispose();
});

it('lifts and flutters downwind while the hoist stays fixed, then settles when wind stops', () => {
  shared.uWind.value.set(6, 0);
  const f = setup();
  f.step(1);
  expect(f.tip().x).toBeGreaterThan(spec.width * 0.8);
  const before = f.positions();
  f.step(0.3);
  expect(f.positions()).not.toEqual(before);
  const pos = f.flag.mesh.geometry.getAttribute('position');
  for (let row = 0; row <= 8; row++) {
    const i = row * 17;
    expect(pos.getX(i)).toBeCloseTo(0, 8);
    expect(pos.getZ(i)).toBeCloseTo(0, 8);
    expect(pos.getY(i)).toBeCloseTo((-spec.height * row) / 8, 6);
  }
  shared.uWind.value.set(0, 0);
  const atStop = f.tip();
  f.step(1 / 60);
  expect(f.tip().distanceTo(atStop)).toBeLessThan(0.08);
  f.step(8);
  expect(f.tip().y).toBeLessThan(-spec.width * 0.8);
  const calm = f.positions();
  f.step(1);
  expect(Math.max(...f.positions().map((v, i) => Math.abs(v - calm[i]!)))).toBeLessThan(0.00001);
  f.dispose();
});

it('turns with the wind without moving the attachment or generating invalid normals', () => {
  shared.uWind.value.set(5, 0);
  const f = setup();
  f.step(1);
  shared.uWind.value.set(0, -5);
  const before = f.tip();
  f.step(1 / 60);
  expect(f.tip().distanceTo(before)).toBeLessThan(0.12);
  f.step(3);
  expect(f.tip().z).toBeLessThan(-spec.width * 0.75);
  expect(f.flag.mesh.position.toArray()).toEqual([spec.x, spec.y, spec.z]);
  const normal = f.flag.mesh.geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++)
    expect(new THREE.Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 5);
  f.dispose();
});

it('samples the same periodic wind field across negative coordinates and tile seams', () => {
  const map = makeWindMap(123),
    a = new THREE.Vector2(),
    b = new THREE.Vector2();
  for (const x of [-194, -96, -0.01, 0, 48, 95.99]) {
    sampleWindMap(map, x, -32, a);
    sampleWindMap(map, x + 96, 64, b);
    expect(a.distanceTo(b)).toBeLessThan(1e-8);
  }
  sampleWindMap(map, -0.00001, 0, a);
  sampleWindMap(map, 0.00001, 0, b);
  expect(a.distanceTo(b)).toBeLessThan(0.00001);
  map.dispose();
});

it('releases streamed flags and restores the same seeded anchor on reload', () => {
  const w = createWilderness(4242);
  let lookout = null;
  for (let x = -3; x <= 3 && !lookout; x++)
    for (let z = -3; z <= 3 && !lookout; z++) lookout = lookoutInCell(w, x, z);
  expect(lookout).not.toBeNull();
  const anchor = lookoutFlag(lookout!, w);
  const root = new THREE.Group();
  const flags = new WindFlags(root, w.seed);
  const release = flags.add(anchor);
  expect(root.children).toHaveLength(1);
  release();
  expect(root.children).toHaveLength(0);
  flags.add(lookoutFlag(lookout!, w));
  expect(root.children[0]!.position.toArray()).toEqual([anchor.x, anchor.y, anchor.z]);
  flags.dispose();
  expect(root.children).toHaveLength(0);
});
