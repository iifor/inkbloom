import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { characterModelPath, defaultLook } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { CourierActor } from '@/systems/figures/quaternius-courier';
import { weaponModel } from '@/systems/figures/player-props';
import type { PlayerPose } from '@/systems/figures/player-pose';
import { HELD_ITEMS } from '@/world/net/protocol';
import { CourierViewArms } from '@/systems/player/courier-view-arms';

let source: THREE.Group;
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
const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
beforeAll(async () => {
  const bytes = await readFile(
    new URL('../public/models/quaternius/modular-adventurer.glb', import.meta.url),
  );
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  source = (await new GLTFLoader().parseAsync(buffer, '')).scene;
});

describe('imported Quaternius courier', () => {
  it.each(['courier', 'ranger', 'casual', 'witch'] as const)(
    '%s reaches both glider handles with its own limb proportions',
    async (key) => {
      const bytes = await readFile(new URL(`../public/${characterModelPath(key)}`, import.meta.url));
      const model = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      );
      const material = makeInkMaterial({ cloth: true });
      const actor = new CourierActor(model.scene, material);
      actor.pose(defaultLook(key), { ...rest, flight: { blend: 1, bank: 0, pitch: 0 } });
      actor.rig.root.updateMatrixWorld(true);
      for (const side of ['L', 'R'] as const) {
        const palm = pos(actor.rig[`palm${side}`]);
        expect(palm.distanceTo(new THREE.Vector3(side === 'L' ? -0.36 : 0.36, 1.25, -0.78))).toBeLessThan(
          0.06,
        );
      }
      actor.dispose();
      material.dispose();
    },
  );

  it('keeps the suspended pilot below the sail while banking and grips the bar', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    const vertex = new THREE.Vector3();
    const inverse = new THREE.Matrix4();
    for (const [yaw, bank, pitch] of [
      [0, 0, 0],
      [1.1, 0.3, -0.18],
      [-1.1, -0.3, 0.18],
    ] as const) {
      actor.pose(defaultLook('courier'), { ...rest, yaw, flight: { blend: 1, bank, pitch } });
      actor.model.updateMatrixWorld(true);
      inverse.makeRotationFromEuler(new THREE.Euler(pitch, yaw, bank, 'YXZ')).invert();
      let highest = -Infinity;
      actor.model.traverse((mesh) => {
        if (!(mesh instanceof THREE.SkinnedMesh) || !mesh.visible) return;
        const positions = mesh.geometry.getAttribute('position');
        for (let index = 0; index < positions.count; index++) {
          mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
          highest = Math.max(highest, vertex.y);
        }
      });
      expect(highest).toBeLessThan(2.1);
      for (const side of ['L', 'R'] as const) {
        const palm = pos(actor.rig[`palm${side}`]).applyMatrix4(inverse);
        expect(palm.distanceTo(new THREE.Vector3(side === 'L' ? -0.36 : 0.36, 1.25, -0.78))).toBeLessThan(
          0.06,
        );
      }
    }
    actor.dispose();
    material.dispose();
  });
  it('reuses the character arm vertices and skinning without changing the shared full-body asset', () => {
    const original = new Map<THREE.Object3D, number>();
    source.traverse((o) => {
      if (o instanceof THREE.Mesh) original.set(o, o.geometry.index!.count);
    });
    const material = makeInkMaterial({ cloth: true, viewModel: true });
    const hands = new CourierViewArms(source, material);
    let triangles = 0;
    hands.actor.model.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh) || !o.visible) return;
      const originalMesh = source.getObjectByName(o.name) as THREE.SkinnedMesh;
      expect(o.geometry).not.toBe(originalMesh.geometry);
      expect(o.skeleton).not.toBe(originalMesh.skeleton);
      expect(o.geometry.getAttribute('position').array).toEqual(
        originalMesh.geometry.getAttribute('position').array,
      );
      triangles += o.geometry.index!.count / 3;
      const indices = o.geometry.index!;
      const skin = o.geometry.getAttribute('skinIndex');
      const weights = o.geometry.getAttribute('skinWeight');
      for (let i = 0; i < indices.count; i++) {
        const vertex = indices.getX(i);
        for (let j = 0; j < 4; j++) {
          if (weights.getComponent(vertex, j) < 0.35) continue;
          expect(o.skeleton.bones[skin.getComponent(vertex, j)]!.name).not.toMatch(
            /Head|neck|thigh|calf|foot/,
          );
        }
      }
    });
    expect(triangles).toBeGreaterThan(2000);
    for (const [mesh, count] of original) expect((mesh as THREE.Mesh).geometry.index!.count).toBe(count);
    hands.dispose();
    material.dispose();
  });

  it.each(['courier', 'witch'] as const)(
    'keeps the %s wrist and brush attached as the camera moves and turns',
    async (key) => {
      const material = makeInkMaterial({ cloth: true, viewModel: true });
      const bytes = await readFile(new URL(`../public/${characterModelPath(key)}`, import.meta.url));
      const model = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      );
      const hands = new CourierViewArms(model.scene, material);
      const camera = new THREE.PerspectiveCamera(65);
      camera.add(hands.root);
      const left = new THREE.Object3D(),
        right = new THREE.Object3D();
      left.position.set(-0.32, -0.075, -0.48);
      right.position.set(0.32, -0.075, -0.48);
      let reference: THREE.Vector3 | null = null;
      for (let frame = 0; frame < 40; frame++) {
        camera.position.set(frame * 0.1, 4 + frame * 0.01, 70);
        camera.rotation.set(Math.sin(frame) * 0.6, frame * 0.15, 0);
        hands.update(1 / 60, defaultLook(key), left, right, true, false);
        camera.updateMatrixWorld(true);
        const r = hands.actor.rig;
        const actual = pos(hands.actor.model.getObjectByName('hand_r')!);
        expect(actual.distanceTo(pos(r.foreR))).toBeCloseTo(r.armLengths![1], 3);
        expect(pos(r.palmR).distanceTo(pos(r.props.brush.node))).toBeLessThan(1e-6);
        const local = camera.worldToLocal(actual);
        if (reference) expect(local.distanceTo(reference)).toBeLessThan(1e-5);
        reference = local;
      }
      const finger = hands.actor.model.getObjectByName('index_02_r')!;
      const clenched = finger.quaternion.clone();
      hands.update(1, defaultLook(key), left, right, false, true);
      expect(finger.quaternion.angleTo(clenched)).toBeGreaterThan(1);
      hands.dispose();
      expect(camera.children).toHaveLength(0);
      material.dispose();
    },
  );

  it('moves the actual elbow bones more than the shoulders through walking, jogging and running', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    for (const stride of [1, 1.25, 1.7]) {
      const angles: number[] = [],
        shoulders: number[] = [];
      for (let frame = 0; frame <= 120; frame++) {
        actor.pose(defaultLook('courier'), { ...rest, stride, walk: (frame / 120) * Math.PI * 2 });
        const shoulder = pos(actor.model.getObjectByName('upperarm_r')!);
        const elbow = pos(actor.model.getObjectByName('lowerarm_r')!);
        const wrist = pos(actor.model.getObjectByName('hand_r')!);
        angles.push(Math.PI - shoulder.sub(elbow).angleTo(wrist.sub(elbow)));
        shoulders.push(actor.rig.armR.rotation.x);
        expect(actor.rig.foreL.rotation.x).toBeGreaterThan(0.1);
      }
      const range = (values: number[]) => Math.max(...values) - Math.min(...values);
      expect(range(angles)).toBeGreaterThan(range(shoulders) * 2);
      expect(range(angles)).toBeGreaterThan(0.7);
    }
    actor.dispose();
    material.dispose();
  });

  it('ships an actual compact rigged asset with a human-sized silhouette and no external textures', () => {
    const box = new THREE.Box3().setFromObject(source);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.7);
    expect(box.max.y - box.min.y).toBeLessThan(1.95);
    expect(Math.abs(box.min.y)).toBeLessThan(0.015);
    let meshes = 0;
    source.traverse((o) => {
      if (!(o instanceof THREE.SkinnedMesh)) return;
      meshes++;
      expect(o.skeleton.bones.length).toBeGreaterThan(30);
      const weights = o.geometry.getAttribute('skinWeight');
      for (let i = 0; i < weights.count; i++) {
        expect(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)).toBeCloseTo(1, 3);
      }
    });
    expect(meshes).toBeGreaterThan(0);
    expect(meshes).toBeLessThanOrEqual(10);
  });

  it('keeps wrist lengths and both hand contacts attached through every attack and skill', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    for (const held of HELD_ITEMS)
      for (const kind of ['attack', 'skill'] as const)
        for (const t of [0, 0.2, 0.45, 0.8, 1]) {
          actor.pose(defaultLook('courier'), {
            ...rest,
            x: 12,
            y: 3,
            z: -6,
            yaw: 0.73,
            stride: 1,
            walk: t * 4,
            held,
            action: { kind, t },
          });
          const wrist = actor.model.getObjectByName('hand_r')!;
          const handOrientation = wrist
            .getWorldQuaternion(new THREE.Quaternion())
            .multiply(source.getObjectByName('hand_r')!.getWorldQuaternion(new THREE.Quaternion()).invert());
          const palm = pos(wrist).add(actor.rig.gripOffset!.clone().applyQuaternion(handOrientation));
          expect(palm.distanceTo(pos(actor.rig.props[held].node))).toBeLessThan(0.015);
          expect(pos(actor.rig.palmR).distanceTo(pos(actor.rig.props[held].node))).toBeLessThan(0.015);
          expect(pos(wrist).distanceTo(pos(actor.model.getObjectByName('lowerarm_r')!))).toBeCloseTo(
            actor.rig.armLengths![1],
            2,
          );
          const off = actor.rig.props[held].off;
          if (off)
            expect(
              pos(actor.rig.palmL).distanceTo(actor.rig.props[held].node.localToWorld(off.clone())),
              `${held} ${kind} ${t}`,
            ).toBeLessThan(0.08);
        }
    actor.dispose();
    material.dispose();
  });

  it('keeps brush and rifle geometry outside the chest throughout a stroke or shot', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    const v = new THREE.Vector3();
    for (const held of ['brush', 'rifle'] as const)
      for (const pitch of [-0.6, 0, 0.6])
        for (let frame = 0; frame <= 40; frame++) {
          actor.pose(defaultLook('courier'), {
            ...rest,
            held,
            pitch,
            t: frame / 20,
            paint: 1,
            aim: 1,
            action: { kind: 'attack', t: frame / 40 },
          });
          const prop = actor.rig.props[held];
          if (held === 'rifle') {
            const handDirection = new THREE.Vector3(0, -1, 0).applyQuaternion(
              actor.rig.palmR.getWorldQuaternion(new THREE.Quaternion()),
            );
            const foreDirection = pos(actor.model.getObjectByName('hand_r')!)
              .sub(pos(actor.rig.foreR))
              .normalize();
            expect(handDirection.angleTo(foreDirection), `rifle wrist pitch ${pitch}`).toBeLessThan(0.85);
          }
          const inv = actor.rig.torso.matrixWorld.clone().invert();
          const matrices =
            held === 'rifle'
              ? [{ geometry: weaponModel('rifle').geometry, matrix: prop.node.matrixWorld }]
              : [];
          // Brush shaft including its rear end; rifle samples include the entire stock.
          const points: THREE.Vector3[] = [];
          if (held === 'brush')
            for (let i = 0; i <= 20; i++)
              points.push(
                new THREE.Vector3(0, 0, 0.1 - i * 0.03).applyMatrix4(prop.node.matrixWorld).applyMatrix4(inv),
              );
          for (const { geometry, matrix } of matrices) {
            const positions = geometry.getAttribute('position');
            for (let i = 0; i < positions.count; i += 7)
              points.push(v.fromBufferAttribute(positions, i).applyMatrix4(matrix).applyMatrix4(inv).clone());
          }
          for (const point of points) {
            const chest = (point.x / 0.17) ** 2 + ((point.y - 0.23) / 0.25) ** 2 + (point.z / 0.145) ** 2;
            expect(chest, `${held} pitch ${pitch} frame ${frame}`).toBeGreaterThan(1.05);
          }
        }
    actor.dispose();
    material.dispose();
  });

  it('blends state changes, converges, and resets when a pooled figure moves to another player', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    actor.pose(defaultLook('courier'), rest);
    const previous = actor.rig.armR.quaternion.clone();
    actor.pose(defaultLook('courier'), { ...rest, glide: true, t: 1 / 60 });
    expect(previous.angleTo(actor.rig.armR.quaternion)).toBeLessThan(0.95);
    for (let i = 2; i <= 30; i++) actor.pose(defaultLook('courier'), { ...rest, glide: true, t: i / 60 });
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(2.9, 0, 0.25));
    expect(target.angleTo(actor.rig.armR.quaternion)).toBeLessThan(0.001);
    actor.pose(defaultLook('courier'), { ...rest, x: 20, t: 31 / 60 });
    expect(actor.rig.root.position.x).toBe(20);
    expect(actor.rig.armR.rotation.x).toBeCloseTo(0, 5);
    actor.dispose();
    material.dispose();
  });

  it('keeps the sword wrist straight and the blade outside the chest through cuts and recovery', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    const vertices = weaponModel('katana').geometry.getAttribute('position');
    const point = new THREE.Vector3();
    for (const kind of ['attack', 'skill'] as const)
      for (let frame = 0; frame <= 60; frame++) {
        actor.pose(defaultLook('courier'), {
          ...rest,
          held: 'katana',
          t: frame / 60,
          action: { kind, t: frame / 60 },
        });
        const r = actor.rig;
        const handDirection = new THREE.Vector3(0, -1, 0).applyQuaternion(
          r.palmR.getWorldQuaternion(new THREE.Quaternion()),
        );
        const foreDirection = pos(actor.model.getObjectByName('hand_r')!).sub(pos(r.foreR)).normalize();
        expect(handDirection.angleTo(foreDirection)).toBeLessThan(0.08);
        const matrix = r.torso.matrixWorld.clone().invert().multiply(r.props.katana.node.matrixWorld);
        for (let i = 0; i < vertices.count; i += 7) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(matrix);
          const chest = (point.x / 0.17) ** 2 + ((point.y - 0.23) / 0.25) ** 2 + (point.z / 0.145) ** 2;
          expect(chest, `${kind} frame ${frame}`).toBeGreaterThan(1.05);
        }
      }
    actor.dispose();
    material.dispose();
  });

  it('swims with connected wrists, alternating recovery, and a continuous loop', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    for (let frame = 0; frame <= 120; frame++) {
      actor.pose(defaultLook('courier'), { ...rest, swim: true, walk: (frame / 120) * Math.PI * 2 });
      for (const side of ['L', 'R'] as const) {
        const wrist = actor.model.getObjectByName(`hand_${side.toLowerCase()}`)!;
        expect(pos(wrist).distanceTo(pos(actor.rig[`fore${side}`]))).toBeCloseTo(actor.rig.armLengths![1], 3);
        const hand = new THREE.Vector3(0, -1, 0).applyQuaternion(
          actor.rig[`palm${side}`].getWorldQuaternion(new THREE.Quaternion()),
        );
        expect(
          hand.angleTo(
            pos(wrist)
              .sub(pos(actor.rig[`fore${side}`]))
              .normalize(),
          ),
        ).toBeLessThan(0.02);
      }
    }
    actor.pose(defaultLook('courier'), { ...rest, swim: true, walk: 0 });
    const left = actor.rig.armL.quaternion.clone();
    const fore = actor.rig.foreL.quaternion.clone();
    actor.pose(defaultLook('courier'), { ...rest, swim: true, walk: 2 * Math.PI - 0.0001 });
    expect(left.angleTo(actor.rig.armL.quaternion)).toBeLessThan(0.001);
    expect(fore.angleTo(actor.rig.foreL.quaternion)).toBeLessThan(0.001);
    actor.pose(defaultLook('courier'), { ...rest, swim: true, walk: 0.78 * 2 * Math.PI });
    expect(actor.rig.foreL.rotation.x).toBeGreaterThan(1.1);
    expect(actor.rig.foreR.rotation.x).toBeLessThan(0.9);
    actor.dispose();
    material.dispose();
  });

  it('paints with a neutral wrist and a lowered elbow over a complete stroke', () => {
    const material = makeInkMaterial({ cloth: true });
    const actor = new CourierActor(source, material);
    for (let frame = 0; frame < 120; frame++) {
      actor.pose(defaultLook('courier'), { ...rest, held: 'brush', paint: 1, t: frame / 60 });
      const r = actor.rig;
      const handForward = new THREE.Vector3(0, -1, 0).applyQuaternion(
        r.palmR.getWorldQuaternion(new THREE.Quaternion()),
      );
      const foreForward = pos(actor.model.getObjectByName('hand_r')!).sub(pos(r.foreR)).normalize();
      expect(handForward.angleTo(foreForward)).toBeLessThan(0.08);
      expect(pos(r.foreR).y).toBeLessThan(pos(r.armR).y - 0.06);
    }
    actor.pose(defaultLook('courier'), { ...rest, held: 'brush', t: 3 });
    const restingGrip = actor.rig.props.brush.node.position.clone();
    for (let i = 1; i <= 60; i++)
      actor.pose(defaultLook('courier'), { ...rest, held: 'brush', t: 3 + i / 60 });
    expect(restingGrip.distanceTo(actor.rig.props.brush.node.position)).toBeLessThan(0.005);
    actor.dispose();
    material.dispose();
  });

  it('keeps simultaneous characters independent and produces finite skinned vertices in every movement state', () => {
    const material = makeInkMaterial({ cloth: true });
    const a = new CourierActor(source, material),
      b = new CourierActor(source, material);
    b.pose({ ...defaultLook('courier'), skin: 2, accent: 4 }, { ...rest, x: 4 });
    const otherHead = pos(b.model.getObjectByName('Head')!);
    for (const p of [
      { stride: 1, walk: 2 },
      { stride: 1.7, walk: 4 },
      { air: true },
      { glide: true },
      { swim: true },
      { hurt: 1 },
      { dying: 0.95 },
    ]) {
      a.pose(defaultLook('courier'), { ...rest, ...p });
      a.model.updateMatrixWorld(true);
      a.model.traverse((o) => {
        if (!(o instanceof THREE.SkinnedMesh)) return;
        o.skeleton.update();
        for (let i = 0; i < o.geometry.getAttribute('position').count; i += 67) {
          const v = o.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(o.matrixWorld);
          expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
          expect(v.length()).toBeLessThan(4);
        }
      });
    }
    expect(pos(b.model.getObjectByName('Head')!).distanceTo(otherHead)).toBeLessThan(1e-6);
    expect(a.model.getObjectByName('Head')).not.toBe(b.model.getObjectByName('Head'));
    a.dispose();
    b.dispose();
    material.dispose();
  });
});
