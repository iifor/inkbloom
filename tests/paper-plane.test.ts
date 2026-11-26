import * as THREE from 'three';
import { expect, it } from 'vitest';
import { CHARACTERS, defaultLook } from '@/content/characters';
import { FlightMotion } from '@/systems/figures/flight-motion';
import { PlayerFigures, type PlayerPose, characterRig, posePlayer } from '@/systems/figures/player-figure';
import { heldIn } from '@/systems/figures/player-hold';
import { FLYING, GLIDING, parseClientMessage } from '@/world/net/protocol';
import { PlayerSystem } from '@/systems/player/player';
import { headless } from './support/headless';

const pose: PlayerPose = {
  x: 5,
  y: 20,
  z: 9,
  yaw: 0.4,
  pitch: 0,
  walk: 1,
  stride: 0,
  air: true,
  glide: false,
  hurt: 0,
  dying: -1,
  t: 1,
  held: 'rifle',
  flight: { blend: 1, bank: 0.2, pitch: 0.1 },
};

it('preserves a distinct F2 flight flag through the server parser', () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      t: 'move',
      p: [0, 20, 0],
      v: [0, 0, -12],
      yaw: 0,
      pitch: 0,
      f: FLYING | 256,
      scene: { kind: 'wild' },
      town: null,
    }),
  );
  expect(parsed).toMatchObject({ t: 'move', f: FLYING });
  expect(FLYING & GLIDING).toBe(0);
});

it('suspends every character under the glider with trailing legs and hands on the control bar', () => {
  for (const c of CHARACTERS) {
    const r = characterRig(c.key);
    posePlayer(r, pose);
    expect(r.legL.rotation.x).toBeCloseTo(r.legR.rotation.x);
    expect(r.shinL.rotation.x).toBeGreaterThan(-0.3);
    expect(r.hips.rotation.x).toBeLessThan(-0.9);
    expect(r.hips.position.y).toBeCloseTo(1.18);
    r.root.updateMatrixWorld(true);
    for (const side of ['L', 'R'] as const) {
      const palm = r.root.worldToLocal(r[`palm${side}`].getWorldPosition(new THREE.Vector3()));
      expect(palm.distanceTo(new THREE.Vector3(side === 'L' ? -0.36 : 0.36, 1.25, -0.78))).toBeLessThan(
        0.035,
      );
      const foot = r.root.worldToLocal(r[`foot${side}`].getWorldPosition(new THREE.Vector3()));
      expect(foot.z).toBeGreaterThan(0.5);
    }
    expect(r.root.rotation.z).toBeCloseTo(0.2);
    expect(heldIn(pose)).toBeNull();
    posePlayer(r, { ...pose, flight: undefined, air: false });
    expect(r.root.rotation.z).toBe(0);
    expect(r.legL.rotation.x).toBe(0);
    expect(heldIn({ ...pose, flight: undefined })).toBe('rifle');
  }
});

it('banks smoothly across wrapped network yaw, settles, unfolds and folds completely', () => {
  const f = new FlightMotion();
  f.update(1 / 60, true, Math.PI - 0.01, 15, 0);
  f.update(1 / 60, true, -Math.PI + 0.01, 15, 0);
  expect(f.bank).toBeGreaterThan(0);
  expect(f.bank).toBeLessThan(0.03);
  for (let i = 0; i < 120; i++) f.update(1 / 60, true, -Math.PI + 0.01, 15, 0);
  expect(f.blend).toBe(1);
  expect(Math.abs(f.bank)).toBeLessThan(0.001);
  for (let i = 0; i < 30; i++) f.update(1 / 60, false, 0, 0, 0);
  expect(f.blend).toBe(0);
});

it('instances planes only for living riders, supports a crowd, and removes them after flight', () => {
  const parent = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const figures = new PlayerFigures(parent, material);
  figures.begin();
  for (let i = 0; i < 20; i++) figures.draw(defaultLook('ranger'), { ...pose, x: i });
  figures.draw(defaultLook('ranger'), { ...pose, dying: 0.2 });
  figures.end();
  const plane = parent.getObjectByName('paper-plane-vehicles') as THREE.InstancedMesh;
  expect(plane.count).toBe(20);
  expect(plane.geometry.boundingBox!.max.x - plane.geometry.boundingBox!.min.x).toBeGreaterThan(5);
  const matrix = new THREE.Matrix4();
  plane.getMatrixAt(19, matrix);
  expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(19);
  figures.begin();
  figures.draw(defaultLook('ranger'), { ...pose, flight: undefined });
  figures.end();
  expect(plane.count).toBe(0);
  figures.dispose();
  expect(parent.getObjectByName('paper-plane-vehicles')).toBeUndefined();
  material.dispose();
});

it('F2 keeps the first-person view clear while flying and restores the camera when toggled off', () => {
  const h = headless();
  const scene = new THREE.Scene();
  let action = '';
  Object.assign(h.ctx, {
    renderer: { scene, camera: new THREE.PerspectiveCamera() },
    wilderness: { heightAt: () => 2, townAt: () => null },
  });
  Object.assign(h.ctx.input, {
    takeLook: () => ({ yaw: 0, pitch: 0 }),
    pressed: (key: string) => key === action,
  });
  h.physics.ground = () => 2;
  const player = new PlayerSystem(h.ctx);
  Object.assign(h.ctx, { player });
  player.teleport(new THREE.Vector3(0, 20, 0));
  action = 'debugFly';
  player.update(1 / 60);
  action = '';
  h.held.add('forward');
  h.held.add('jump');
  h.run(0.6, (dt) => player.update(dt), 1 / 60);
  expect(player.flying).toBe(true);
  expect(player.gliding).toBe(false);
  expect(scene.getObjectByName('paper-plane-vehicles')).toBeUndefined();
  expect(scene.getObjectByName('paper-plane-pilot')).toBeUndefined();
  expect(player.position.z).toBeLessThan(-2);
  expect(player.position.y).toBeGreaterThan(22);
  h.held.clear();
  h.run(1, (dt) => player.update(dt), 1 / 60);
  expect(h.ctx.renderer.camera.position.y - player.eye.y).toBeCloseTo(-0.04);
  expect(h.ctx.renderer.camera.position.z - player.eye.z).toBeCloseTo(-0.66);
  action = 'debugFly';
  player.update(1 / 60);
  action = '';
  h.run(0.6, (dt) => player.update(dt), 1 / 60);
  expect(player.flying).toBe(false);
  expect(scene.getObjectByName('paper-plane-vehicles')).toBeUndefined();
  expect(h.ctx.renderer.camera.position.z - player.eye.z).toBeCloseTo(0);
  player.dispose();
  expect(scene.getObjectByName('paper-plane-pilot')).toBeUndefined();
});
