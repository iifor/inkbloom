import * as THREE from 'three';
import { expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext } from '@/game/types';
import { PlayerSystem } from '@/systems/player/player';

function stairs(angle = 0, sprint = false) {
  const physics = new PhysicsWorld(4);
  physics.ground = () => 10;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  for (let i = 0; i < 12; i++) {
    const z = -(i + 0.5) * 0.55,
      x = s * z,
      wz = c * z;
    physics.addBox(
      'stairs',
      { x: x - 2, y: 10, z: wz - 0.275 },
      { x: x + 2, y: 10 + (i + 1) * 0.3, z: wz + 0.275 },
      {},
      angle,
    );
  }
  const camera = new THREE.PerspectiveCamera();
  const held = new Set(['forward', ...(sprint ? ['sprint'] : [])]);
  let jump = false;
  const ctx = {
    wilderness: { heightAt: () => 10 },
    scenes: { active: { physics } },
    input: {
      takeLook: () => ({ yaw: 0, pitch: 0 }),
      held: (k: string) => held.has(k),
      pressed: (k: string) => {
        if (k === 'jump' && jump) {
          jump = false;
          return true;
        }
        return false;
      },
    },
    combat: { alive: true },
    state: { inventory: { glider: false } },
    events: { emit() {} },
    renderer: { camera },
  };
  const player = new PlayerSystem(ctx as unknown as GameContext);
  player.teleport(new THREE.Vector3(s * 2, 10, c * 2), angle);
  return {
    player,
    camera,
    held,
    physics,
    jump: () => {
      jump = true;
    },
    along: () => -(player.position.x * s + player.position.z * c),
  };
}

it.each([0, 0.6, Math.PI / 2])(
  'climbs consecutive stairs without losing forward speed at yaw %s',
  (angle) => {
    const h = stairs(angle);
    let minSpeed = Infinity,
      maxEyeStep = 0,
      rises = 0;
    for (let i = 0; i < 80; i++) {
      const y = h.player.position.y,
        eye = h.camera.position.y;
      h.player.update(1 / 60);
      if (h.along() > 0 && h.along() < 5.5) {
        minSpeed = Math.min(minSpeed, h.player.speed);
        maxEyeStep = Math.max(maxEyeStep, Math.abs(h.camera.position.y - eye));
        if (h.player.position.y - y > 0.2) rises++;
      }
    }
    expect(h.along()).toBeGreaterThan(5);
    expect(minSpeed).toBeGreaterThan(TUNING.player.walkSpeed * 0.95);
    expect(rises).toBeGreaterThan(5);
    expect(maxEyeStep).toBeLessThan(0.12);
    h.player.dispose();
  },
);

it.each([30, 60, 120])('smooths ascent and descent at %i Hz, including sprinting and stopping', (hz) => {
  const h = stairs(0.6, true),
    dt = 1 / hz;
  let maxChange = 0;
  for (let i = 0; i < hz * 3 && h.along() < 5; i++) {
    const eye = h.camera.position.y;
    h.player.update(dt);
    maxChange = Math.max(maxChange, Math.abs(h.camera.position.y - eye));
  }
  expect(h.along()).toBeGreaterThanOrEqual(5);
  h.held.clear();
  for (let i = 0; i < hz; i++) h.player.update(dt);
  expect(h.player.eye.y - h.player.position.y).toBeCloseTo(TUNING.player.eyeHeight, 5);
  h.player.yaw += Math.PI;
  h.held.add('forward');
  h.held.add('sprint');
  let airborne = 0;
  for (let i = 0; i < hz && h.along() > 0; i++) {
    const eye = h.camera.position.y;
    h.player.update(dt);
    maxChange = Math.max(maxChange, Math.abs(h.camera.position.y - eye));
    if (!h.player.grounded) airborne++;
  }
  expect(h.along()).toBeLessThan(0);
  expect(airborne).toBe(0);
  // Sprinting climbs about 5.5 metres/s; allow its eased peak, not a 30 cm snap.
  expect(maxChange).toBeLessThan(9 / hz);
  h.player.dispose();
});

it('keeps jumps immediate and clears stair offsets on teleport and flight', () => {
  const h = stairs();
  for (let i = 0; i < 180 && h.along() < 2; i++) h.player.update(1 / 60);
  expect(h.along()).toBeGreaterThanOrEqual(2);
  expect(h.player.eye.y - h.player.position.y).toBeLessThan(TUNING.player.eyeHeight - 0.01);
  h.jump();
  const y = h.player.position.y;
  h.player.update(1 / 60);
  expect(h.player.position.y - y).toBeGreaterThan(0.1);
  expect(h.player.grounded).toBe(false);
  h.player.teleport(new THREE.Vector3(30, 20, 30));
  expect(h.player.eye.y).toBe(20 + TUNING.player.eyeHeight);
  h.player.flying = true;
  h.player.update(1 / 60);
  expect(h.player.eye.y - h.player.position.y).toBeCloseTo(TUNING.player.eyeHeight, 6);
  h.player.dispose();
});

it('does not lift the body through a low ceiling when a step is obstructed', () => {
  const h = stairs();
  h.physics.addBox('ceiling', { x: -3, y: 12, z: -8 }, { x: 3, y: 13, z: 0 });
  for (let i = 0; i < 120; i++) h.player.update(1 / 60);
  expect(h.player.position.z).toBeGreaterThan(0);
  expect(h.player.position.y).toBeCloseTo(10, 3);
  expect(h.player.eye.y).toBeCloseTo(10 + TUNING.player.eyeHeight, 3);
  h.player.dispose();
});
