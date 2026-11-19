import * as THREE from 'three';
import { expect, it } from 'vitest';
import { HandGait } from '@/systems/player/hand-gait';
import { WalkArms } from '@/systems/player/walk-arms';
import { WeaponSlot } from '@/systems/tools/weapons';
import { ToolBelt, type InHand } from '@/systems/tools/tool';
import { headless } from './support/headless';

const brush: InHand = { item: 'brush', aiming: false, painting: false };

it('keeps hand proportions and framing stable across world FOV settings', () => {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65, 16 / 9);
  const arms = new WalkArms(camera);
  const root = camera.getObjectByName('walking-hands')!;
  const hand = root.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  arms.update(1 / 60, h.ctx.player, brush, true);
  const geometry = hand.geometry;
  const projected = () => {
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const tip = new THREE.Vector3(-0.054, 0.179, -0.037);
    tip.applyMatrix4(hand.matrixWorld).project(camera);
    return new THREE.Vector2(tip.x, tip.y).multiplyScalar(hand.material.uniforms.uViewScale!.value);
  };
  const initial = projected();
  for (const fov of [50, 92, 110]) {
    camera.fov = fov;
    arms.update(1 / 60, h.ctx.player, brush, true);
    expect(projected().distanceTo(initial)).toBeLessThan(1e-6);
    expect(hand.scale.x).toBe(hand.scale.y);
    expect(hand.scale.y).toBe(hand.scale.z);
    expect(hand.geometry).toBe(geometry);
  }
  arms.dispose();
});

it('alternates the hands, increases stride at a run, and settles without drift', () => {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65);
  const arms = new WalkArms(camera);
  const root = camera.getObjectByName('walking-hands')!;
  const [left, right] = root.children;
  const range = (speed: number) => {
    Object.assign(h.ctx.player, { speed });
    h.run(1, (dt) => arms.update(dt, h.ctx.player, brush, true));
    let lo = Infinity,
      hi = -Infinity;
    h.run(2, (dt) => {
      arms.update(dt, h.ctx.player, brush, true);
      expect(left!.position.z + right!.position.z).toBeCloseTo(-0.96, 6);
      lo = Math.min(lo, right!.position.z);
      hi = Math.max(hi, right!.position.z);
    });
    return hi - lo;
  };
  const walk = range(6);
  expect(walk).toBeGreaterThan(0.08);
  expect(range(10)).toBeGreaterThan(walk * 1.8);
  Object.assign(h.ctx.player, { speed: 0 });
  h.held.add('forward');
  h.held.add('sprint');
  h.run(2, (dt) => arms.update(dt, h.ctx.player, brush, true));
  expect(right!.position.z).toBeCloseTo(-0.48, 6);
  const rest = right!.position.clone();
  h.run(2, (dt) => arms.update(dt, h.ctx.player, brush, true));
  expect(right!.position.distanceTo(rest)).toBeLessThan(0.00001);
  arms.dispose();
  expect(camera.children).toHaveLength(0);
});

it('never overlaps walking hands with swimming, flight, weapons or death', () => {
  const h = headless();
  const camera = new THREE.Camera();
  const arms = new WalkArms(camera);
  const root = camera.getObjectByName('walking-hands')!;
  arms.update(1 / 60, h.ctx.player, brush, true);
  expect(root.visible).toBe(true);
  for (const state of [{ flying: true }, { gliding: true }, { waterMode: 'swimming' }]) {
    Object.assign(h.ctx.player, { flying: false, gliding: false, waterMode: 'dry' }, state);
    arms.update(1 / 60, h.ctx.player, brush, true);
    expect(root.visible).toBe(false);
  }
  Object.assign(h.ctx.player, { waterMode: 'dry' });
  arms.update(1 / 60, h.ctx.player, { ...brush, item: 'rifle' }, true);
  expect(root.visible).toBe(false);
  arms.update(1 / 60, h.ctx.player, brush, false);
  expect(root.visible).toBe(false);
  arms.update(1 / 60, h.ctx.player, { ...brush, item: null }, true);
  expect(root.visible).toBe(true);
  arms.dispose();
});

it('fades the gait in the air and keeps equivalent timing across frame rates', () => {
  const h = headless();
  Object.assign(h.ctx.player, { speed: 10 });
  const a = new HandGait(),
    b = new HandGait();
  for (let i = 0; i < 60; i++) a.update(1 / 60, h.ctx.player);
  for (let i = 0; i < 30; i++) b.update(1 / 30, h.ctx.player);
  expect(a.phase).toBeCloseTo(b.phase, 6);
  expect(a.amount).toBeCloseTo(b.amount, 6);
  Object.assign(h.ctx.player, { grounded: false });
  const phase = a.phase;
  h.run(2, (dt) => a.update(dt, h.ctx.player));
  expect(a.phase).toBe(phase);
  expect(a.amount).toBeLessThan(0.00001);
  expect(a.run).toBeLessThan(0.00001);
});

it('steadies the actual weapon while scoped without changing the aim direction', () => {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65);
  Object.assign(h.ctx, { renderer: { camera, baseFov: 65, scene: new THREE.Scene() } });
  Object.assign(h.ctx.input, { takeWheel: () => 0 });
  Object.assign(h.ctx.player, { speed: 10 });
  h.ctx.state.inventory.weapons = ['sniper'];
  const weapons = new WeaponSlot(h.ctx);
  const belt = new ToolBelt(h.ctx, [weapons]);
  const range = () => {
    h.run(1, (dt) => belt.update(dt));
    let lo = Infinity,
      hi = -Infinity;
    h.run(2, (dt) => {
      belt.update(dt);
      const gun = camera.children.find((child) => child.visible)!;
      lo = Math.min(lo, gun.position.x);
      hi = Math.max(hi, gun.position.x);
    });
    return hi - lo;
  };
  const free = range();
  h.held.add('alt');
  expect(range()).toBeLessThan(free * 0.2);
  expect(camera.fov).toBe(32);
  expect(h.ctx.player.forward.toArray()).toEqual([0, 0, -1]);
});

it('raises the first-person sword then cuts forward and down without sweeping sideways', () => {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65);
  Object.assign(h.ctx, { renderer: { camera, baseFov: 65, scene: new THREE.Scene() } });
  Object.assign(h.ctx.input, { takeWheel: () => 0 });
  h.ctx.state.inventory.weapons = ['katana'];
  const weapons = new WeaponSlot(h.ctx);
  const belt = new ToolBelt(h.ctx, [weapons]);
  belt.update(0);
  const sword = camera.children.find((child) => child.visible)!;
  const tip = () => {
    sword.updateMatrix();
    return new THREE.Vector3(0, 0.062, -0.88).applyMatrix4(sword.matrix);
  };
  const rest = tip();
  h.held.add('use');
  belt.update(0);
  h.held.delete('use');
  const points: THREE.Vector3[] = [];
  for (let frame = 0; frame < 100; frame++) {
    belt.update(0.42 / 100);
    points.push(tip());
  }
  const raised = points[19]!;
  const cut = points[47]!;
  expect(raised.y).toBeGreaterThan(rest.y + 0.35);
  expect(cut.y).toBeLessThan(raised.y - 1);
  expect(cut.z).toBeLessThan(raised.z - 0.25);
  expect(Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))).toBeLessThan(0.2);
  expect(points.every((p) => p.z < -0.75)).toBe(true);
  expect(tip().distanceTo(rest)).toBeLessThan(1e-6);
  // A new cut begins at the recovered pose, without jumping to the far side.
  h.held.add('use');
  belt.update(0);
  expect(tip().distanceTo(rest)).toBeLessThan(1e-6);
});
