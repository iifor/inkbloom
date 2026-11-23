import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHARACTERS, characterModel, characterModelPath, defaultLook } from '@/content/characters';
import { color } from '@/content/palette';
import { validLook } from '@/world/profile';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { CourierActor } from '@/systems/figures/quaternius-courier';
import { CourierViewArms } from '@/systems/player/courier-view-arms';
import { WEAPONS } from '@/content/weapons';
import { viewModel } from '@/systems/tools/viewmodels';
import type { PlayerPose } from '@/systems/figures/player-pose';
import { SwimArms } from '@/systems/player/swim-arms';

const outfits = CHARACTERS.filter((c) => characterModel(c.key));
it('includes every outfit in the eleven-character source pack and preserves the original choices', () => {
  expect(
    outfits
      .map((c) => characterModel(c.key)!)
      .filter((file) => !file.startsWith('kaykit:'))
      .sort(),
  ).toEqual([
    'adventurer',
    'beach',
    'casual',
    'casual2',
    'farmer',
    'king',
    'punk',
    'spacesuit',
    'suit',
    'swat',
    'worker',
  ]);
  expect(CHARACTERS).toHaveLength(16);
  for (const key of ['mason', 'apprentice', 'ranger', 'boatman', 'gardener'] as const)
    expect(characterModelPath(key)).toMatch(/^models\/kaykit\/player-/);
  for (const c of CHARACTERS) expect(validLook(defaultLook(c.key))).toEqual(defaultLook(c.key));
});

describe.each(outfits)('$key original model', (def) => {
  let source: THREE.Group;
  beforeAll(async () => {
    const bytes = await readFile(new URL(`../public/${characterModelPath(def.key)}`, import.meta.url));
    source = (
      await new GLTFLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene;
  });
  it('keeps its authored mesh, distinct outfit, independent colors, and finite poses', () => {
    const mat = makeInkMaterial({ cloth: true });
    const a = new CourierActor(source, mat),
      b = new CourierActor(source, mat);
    const look = defaultLook(def.key);
    const rest: PlayerPose = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      walk: 0,
      stride: 0,
      air: false,
      glide: false,
      hurt: 0,
      dying: -1,
      t: 0,
    };
    let phase = 0;
    for (const state of [
      {},
      { stride: 1 },
      { stride: 1.25 },
      { stride: 1.7 },
      { air: true },
      { glide: true },
      { swim: true },
      { held: 'brush' },
      { held: 'katana' },
      { held: 'rifle' },
    ] as Partial<PlayerPose>[]) {
      a.pose(look, { ...rest, ...state, t: (phase += 1), walk: phase, action: { kind: 'attack', t: 0.5 } });
      a.model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(a.model, true);
      expect(bounds.isEmpty()).toBe(false);
      expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(5);
      a.model.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) {
          expect(o.skeleton).not.toBe((source.getObjectByName(o.name) as THREE.SkinnedMesh).skeleton);
          for (let i = 0; i < o.geometry.getAttribute('position').count; i += 31) {
            expect(o.getVertexPosition(i, new THREE.Vector3()).toArray().every(Number.isFinite)).toBe(true);
          }
        }
      });
    }
    b.pose({ ...look, accent: color('pink') }, rest);
    // World translation must reach every weighted vertex, including trouser cuffs.
    a.pose(look, { ...rest, x: 100, t: 20 });
    a.model.updateMatrixWorld(true);
    b.model.updateMatrixWorld(true);
    a.model.traverse((o) => {
      if (o instanceof THREE.Mesh)
        expect(o.geometry).not.toBe((b.model.getObjectByName(o.name) as THREE.Mesh).geometry);
      if (o instanceof THREE.SkinnedMesh) {
        const original = b.model.getObjectByName(o.name) as THREE.SkinnedMesh;
        const moved = new THREE.Vector3();
        const stationary = new THREE.Vector3();
        let maxError = 0;
        for (let i = 0; i < o.geometry.getAttribute('position').count; i++) {
          const dx = o.getVertexPosition(i, moved).x - original.getVertexPosition(i, stationary).x;
          maxError = Math.max(maxError, Math.abs(dx - 100));
        }
        expect(maxError).toBeLessThan(0.001);
      }
    });
    a.dispose();
    b.dispose();
    mat.dispose();
  });
  it('uses the chosen outfit sleeves and connected wrists for all weapons', () => {
    const mat = makeInkMaterial({ cloth: true, viewModel: true });
    const arms = new CourierViewArms(source, mat);
    const look = defaultLook(def.key),
      r = arms.actor.rig;
    for (const weapon of WEAPONS) {
      const mesh = new THREE.Mesh(viewModel(weapon, null));
      for (let i = 0; i < 25; i++) {
        mesh.position.set(0.12, -0.22 + 0.05 * Math.sin(i), -0.28);
        mesh.rotation.set(0.12 * Math.sin(i), 0, 0);
        arms.holdWeapon(look, mesh, weapon.key);
        for (const side of ['L', 'R'] as const) {
          const wrist = arms.actor.model.getObjectByName(`hand_${side.toLowerCase()}`)!;
          expect(
            wrist
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(r[`fore${side}`].getWorldPosition(new THREE.Vector3())),
          ).toBeCloseTo(r.armLengths![1], 4);
          expect(r[`palm${side}`].quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1.3);
        }
      }
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    let triangles = 0;
    arms.actor.model.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible) triangles += o.geometry.index!.count / 3;
    });
    expect(triangles).toBeGreaterThan(100);
    arms.dispose();
    mat.dispose();
  });
  it('uses both imported arms through the full swimming cycle without a stretched wrist', () => {
    const material = makeInkMaterial({ cloth: true });
    const arms = new CourierViewArms(source, material);
    const camera = new THREE.PerspectiveCamera();
    const swim = new SwimArms(camera);
    const pose = swim as unknown as { limbs: { side: number; hand: THREE.Object3D; grip: THREE.Vector3 }[] };
    for (let frame = 0; frame < 90; frame++) {
      swim.update(1 / 30, 1, new THREE.Vector3(0, 0, -2.6), 0);
      arms.swim(defaultLook(def.key), pose.limbs);
      arms.root.updateMatrixWorld(true);
      for (const side of ['L', 'R'] as const) {
        const wrist = arms.actor.model.getObjectByName(`hand_${side.toLowerCase()}`)!;
        expect(
          wrist
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(arms.actor.rig[`fore${side}`].getWorldPosition(new THREE.Vector3())),
        ).toBeCloseTo(arms.actor.rig.armLengths![1], 4);
      }
    }
    swim.dispose();
    arms.dispose();
    material.dispose();
  });
});
