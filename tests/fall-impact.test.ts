import * as THREE from 'three';
import { expect, it } from 'vitest';
import { TUNING } from '@/content/tuning';
import { PlayerSystem } from '@/systems/player/player';
import { WATER_LEVEL } from '@/world/wilderness/water-level';
import { headless } from './support/headless';

const DT = 1 / 60;

function setup(ground: number) {
  const h = headless();
  const camera = new THREE.PerspectiveCamera(65);
  Object.assign(h.ctx, { renderer: { camera }, wilderness: { heightAt: () => ground } });
  Object.assign(h.ctx.input, { takeLook: () => ({ yaw: 0, pitch: 0 }) });
  h.physics.ground = () => ground;
  const player = new PlayerSystem(h.ctx);
  Object.assign(h.ctx, { player });
  const drop = (height: number) => {
    player.flying = true;
    player.teleport(new THREE.Vector3(0, height, 0));
    player.update(DT);
    player.flying = false;
  };
  return { ...h, camera, player, drop };
}

it('accelerates when flight is released, uses both hands, and recovers after one damaging impact', () => {
  const { player, camera, combat, drop, count } = setup(0);
  drop(9);
  expect(player.falling).toBe(true);
  player.update(DT);
  expect(player.body.vel.y).toBeCloseTo(-TUNING.player.gravity * DT);
  for (let i = 0; i < 11; i++) player.update(DT);
  expect(player.body.vel.y).toBeCloseTo(-TUNING.player.gravity * 12 * DT);

  const hands = camera.getObjectByName('walking-hands')!;
  const empty = { item: null, aiming: false, painting: false };
  player.updateHands(DT, empty);
  expect(hands.visible).toBe(true);
  const hand = hands.children[0] as THREE.Mesh;
  const spread = hand.geometry;
  const raised = hand.position.y;
  for (let i = 0; i < 100 && !player.grounded; i++) player.update(DT);
  expect(player.grounded).toBe(true);
  expect(player.falling).toBe(true);
  expect(combat.hp).toBeLessThan(combat.maxHp);
  expect(count('player:land')).toBe(1);
  expect(count('player:hurt')).toBe(1);

  for (let i = 0; i < 30; i++) {
    player.update(DT);
    player.updateHands(DT, empty);
  }
  expect(player.falling).toBe(false);
  expect(count('player:hurt')).toBe(1);
  expect(hand.geometry).not.toBe(spread);
  expect(hand.position.y).toBeLessThan(raised);
  player.dispose();
});

it.each([0.5, 6, 14])('scales damage with the speed of a drop from %s metres', (height) => {
  const { player, combat, drop, count } = setup(0);
  drop(height);
  for (let i = 0; i < 100 && !player.grounded; i++) player.update(DT);
  const lost = combat.maxHp - combat.hp;
  if (height < 1) expect(lost).toBe(0);
  else if (height === 6) {
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(25);
  } else expect(lost).toBeGreaterThan(45);
  expect(count('player:land')).toBe(1);
  player.dispose();
});

it('uses the landing speed on a raised collider and does not tunnel through it', () => {
  const { player, combat, drop, count, physics } = setup(0);
  physics.addBox('platform', { x: -3, y: 4, z: -3 }, { x: 3, y: 5, z: 3 });
  drop(19);
  for (let i = 0; i < 100 && !player.grounded; i++) player.update(DT);
  expect(player.position.y).toBeCloseTo(5);
  expect(combat.maxHp - combat.hp).toBeGreaterThan(45);
  expect(count('player:land')).toBe(1);
  player.dispose();
});

it('splashes into deep water and takes fall damage on a shallow bed', () => {
  for (const depth of [0.4, 2]) {
    const { player, combat, drop, log, count } = setup(WATER_LEVEL - depth);
    drop(10);
    for (let i = 0; i < 100 && count('player:land') === 0; i++) player.update(DT);
    expect(log.find((e) => e.type === 'player:land')?.payload).toMatchObject({ water: true });
    if (depth > 1) {
      expect(player.waterMode).toBe('swimming');
      expect(player.falling).toBe(false);
      expect(combat.hp).toBe(combat.maxHp);
    } else {
      expect(player.waterMode).toBe('wading');
      expect(combat.hp).toBeLessThan(combat.maxHp);
    }
    player.dispose();
  }
});

it('does not immediately open the glider when the ascent key is still held on release', () => {
  const { player, held, ctx, drop } = setup(0);
  ctx.state.inventory.glider = true;
  held.add('jump');
  drop(20);
  player.update(DT);
  expect(player.gliding).toBe(false);
  held.delete('jump');
  player.update(DT);
  held.add('jump');
  player.update(DT);
  expect(player.gliding).toBe(true);
  expect(player.body.vel.y).toBeGreaterThanOrEqual(-TUNING.player.glideFall);
  player.dispose();
});
