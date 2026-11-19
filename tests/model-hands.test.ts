import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, expect, it } from 'vitest';
import { defaultLook } from '@/content/characters';
import { WEAPONS, type WeaponKey, type WeaponDef } from '@/content/weapons';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { CourierViewArms } from '@/systems/player/courier-view-arms';
import { SwimArms } from '@/systems/player/swim-arms';
import { WeaponSlot } from '@/systems/tools/weapons';
import { ToolBelt } from '@/systems/tools/tool';
import { headless } from './support/headless';

let source: THREE.Group;
beforeAll(async () => {
  const bytes = await readFile(
    new URL('../public/models/quaternius/modular-adventurer.glb', import.meta.url),
  );
  source = (
    await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
  ).scene;
});
const pos = (node: THREE.Object3D) => node.getWorldPosition(new THREE.Vector3());

it.each<WeaponKey>(['katana', 'rifle', 'sniper', 'launcher', 'staff'])(
  'keeps %s wrists connected and unstrained through a complete attack/reload',
  (key) => {
    const h = headless();
    const camera = new THREE.PerspectiveCamera(65);
    Object.assign(h.ctx, { renderer: { camera, baseFov: 65, scene: new THREE.Scene() } });
    Object.assign(h.ctx.input, { takeWheel: () => 0 });
    h.ctx.state.inventory.weapons = [key];
    const material = makeInkMaterial({ cloth: true });
    const arms = new CourierViewArms(source, material);
    const slot = new WeaponSlot(h.ctx);
    const testSlot = slot as unknown as {
      modelHands: CourierViewArms;
      kick: number;
      current: { cooldown: number; reloading: number; view: THREE.Mesh };
    };
    testSlot.modelHands = arms;
    camera.add(arms.root);
    slot.setLook(defaultLook('courier'));
    slot.onEquip();
    const def: WeaponDef = WEAPONS.find((w) => w.key === key)!;
    for (let i = 0; i <= 120; i++) {
      testSlot.current.cooldown = def.interval * (1 - i / 120);
      testSlot.current.reloading = i > 60 ? (def.reload * (i - 60)) / 60 : 0;
      testSlot.kick = i < 30 ? (1 - i / 30) * (key === 'rifle' ? 3 : (def.shot?.recoil ?? 0)) : 0;
      slot.update();
      camera.updateMatrixWorld(true);
      const r = arms.actor.rig;
      for (const side of ['L', 'R'] as const) {
        const wrist = arms.actor.model.getObjectByName(`hand_${side.toLowerCase()}`)!;
        expect(pos(wrist).distanceTo(pos(r[`fore${side}`])), `${key} ${side} frame ${i}`).toBeCloseTo(
          r.armLengths![1],
          4,
        );
        // Swing after transferring pronation to the forearm; excludes harmless axial twist.
        expect(
          r[`palm${side}`].quaternion.angleTo(new THREE.Quaternion()),
          `${key} ${side} frame ${i}`,
        ).toBeLessThan(1.25);
      }
      const mesh = arms.actor.model.getObjectByName('Adventurer_Body_2') as THREE.SkinnedMesh;
      mesh.skeleton.update();
      const inverse = testSlot.current.view.matrixWorld.clone().invert();
      const skin = mesh.geometry.getAttribute('skinIndex');
      const weight = mesh.geometry.getAttribute('skinWeight');
      const indices = mesh.geometry.index!;
      for (let n = 0; n < indices.count; n += 9) {
        const vertex = indices.getX(n);
        let hand = 0;
        for (let c = 0; c < 4; c++)
          if (
            /^(hand|index|middle|ring|pinky|thumb)/.test(
              mesh.skeleton.bones[skin.getComponent(vertex, c)]!.name,
            )
          )
            hand += weight.getComponent(vertex, c);
        if (hand < 0.7) continue;
        const p = mesh
          .getVertexPosition(vertex, new THREE.Vector3())
          .applyMatrix4(mesh.matrixWorld)
          .applyMatrix4(inverse);
        if (key === 'katana')
          expect(
            p.z < -0.025 && p.z > -0.88 && Math.abs(p.x) < 0.01 && Math.abs(p.y - 0.03) < 0.018,
            `blade at ${i}: ${p.toArray()}`,
          ).toBe(false);
        if (key === 'rifle')
          expect(
            Math.abs(p.x) < 0.031 && Math.abs(p.y) < 0.037 && p.z > -0.28 && p.z < 0.12,
            `rifle receiver at ${i}: ${p.toArray()}`,
          ).toBe(false);
        if (key === 'sniper')
          expect(
            Math.abs(p.x) < 0.029 && Math.abs(p.y) < 0.034 && p.z > -0.3 && p.z < 0.13,
            `receiver at ${i}: ${p.toArray()}`,
          ).toBe(false);
        if (key === 'launcher')
          expect(
            p.x * p.x + p.y * p.y < 0.066 ** 2 && p.z > -0.58 && p.z < 0.22,
            `launcher tube at ${i}: ${p.toArray()}`,
          ).toBe(false);
      }
    }
    const belt = new ToolBelt(h.ctx, [slot]);
    Object.assign(h.ctx.player, { waterMode: 'swimming' });
    belt.update(1 / 60);
    expect(arms.root.visible).toBe(false);
    expect(testSlot.current.view.visible).toBe(false);
    Object.assign(h.ctx.player, { waterMode: 'dry' });
    belt.update(1 / 60);
    expect(arms.root.visible).toBe(true);
    expect(testSlot.current.view.visible).toBe(true);
    slot.onUnequip();
    expect(arms.root.visible).toBe(false);
    slot.dispose();
    expect(arms.root.parent).toBeNull();
    material.dispose();
  },
);

it('keeps swimming palms separated and wrists connected through forward, backward and idle strokes', () => {
  const camera = new THREE.PerspectiveCamera(65);
  const swim = new SwimArms(camera);
  const material = makeInkMaterial({ cloth: true });
  const model = new CourierViewArms(source, material);
  const testSwim = swim as unknown as { model: CourierViewArms; root: THREE.Group };
  testSwim.model = model;
  testSwim.root.add(model.root);
  swim.setLook(defaultLook('courier'));
  for (const velocity of [new THREE.Vector3(0, 0, -2.6), new THREE.Vector3(0, 0, 2.6), new THREE.Vector3()])
    for (let frame = 0; frame < 180; frame++) {
      swim.update(1 / 60, 1, velocity, 0, Math.sin(frame / 60) * 0.7);
      camera.updateMatrixWorld(true);
      const r = model.actor.rig;
      for (const side of ['L', 'R'] as const) {
        expect(
          pos(model.actor.model.getObjectByName(`hand_${side.toLowerCase()}`)!).distanceTo(
            pos(r[`fore${side}`]),
          ),
        ).toBeCloseTo(r.armLengths![1], 4);
        expect(r[`palm${side}`].quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1.25);
      }
      expect(pos(r.palmR).distanceTo(pos(r.palmL))).toBeGreaterThan(0.15);
      const thumbL = pos(model.actor.model.getObjectByName('thumb_02_l')!);
      const thumbR = pos(model.actor.model.getObjectByName('thumb_02_r')!);
      expect(thumbL.distanceTo(thumbR)).toBeGreaterThan(0.03);
    }
  swim.update(0, 0, new THREE.Vector3(), 0);
  expect(testSwim.root.visible).toBe(false);
  swim.dispose();
  expect(camera.children).toHaveLength(0);
  material.dispose();
});
