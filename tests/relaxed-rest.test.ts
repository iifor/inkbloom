import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { expect, it } from 'vitest';
import { CHARACTERS, characterModelPath, defaultLook } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { CourierActor } from '@/systems/figures/quaternius-courier';
import type { PlayerPose } from '@/systems/figures/player-pose';
import { restEyePosition } from '@/systems/player/rest-body';

const base: PlayerPose = {
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
it('supports a reclining seat with low palms and relaxed supine arms across character proportions', async () => {
  for (const def of CHARACTERS) {
    const path = characterModelPath(def.key);
    if (!path) continue;
    const bytes = await readFile(new URL(`../public/${path}`, import.meta.url));
    const source = (
      await new GLTFLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene;
    const material = makeInkMaterial({ cloth: true }),
      actor = new CourierActor(source, material),
      r = actor.rig;
    actor.retainTriangles(['Head'], (weight) => weight < 0.5);
    for (const sitting of [1, 0]) {
      actor.pose(defaultLook(def.key), {
        ...base,
        rest: { sitting, lying: 1 - sitting, groundPitch: 0, groundRoll: 0 },
      });
      r.root.updateMatrixWorld(true);
      const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
      const palms = [pos(r.palmL), pos(r.palmR)];
      const eye = new THREE.Vector3();
      restEyePosition(eye, pos(r.head), 0, { sitting, lying: 1 - sitting, groundPitch: 0, groundRoll: 0 });
      // Test the posed, skinned triangles, including bulky sleeves/collars. A clear near plane
      // is required for both poses on every imported character, not just the default courier.
      actor.model.updateMatrixWorld(true);
      let nearest = Infinity;
      const tri = new THREE.Triangle(),
        closest = new THREE.Vector3();
      actor.model.traverse((mesh) => {
        if (!(mesh instanceof THREE.SkinnedMesh) || !mesh.visible) return;
        mesh.skeleton.update();
        const indices = mesh.geometry.index!;
        const vertex = (i: number, out: THREE.Vector3) =>
          mesh.getVertexPosition(indices.getX(i), out).applyMatrix4(mesh.matrixWorld);
        for (let i = 0; i < indices.count; i += 3) {
          vertex(i, tri.a);
          vertex(i + 1, tri.b);
          vertex(i + 2, tri.c);
          nearest = Math.min(nearest, tri.closestPointToPoint(eye, closest).distanceTo(eye));
        }
      });
      expect.soft(nearest, `${def.key}: ${sitting ? 'sit' : 'lie'} eye clearance`).toBeGreaterThan(0.08);
      for (const p of palms) {
        expect(p.y, def.key).toBeGreaterThan(0.02);
        expect(p.y, def.key).toBeLessThan(0.07);
      }
      if (sitting) {
        expect(pos(r.head).z).toBeGreaterThan(pos(r.hips).z + 0.15);
        for (const p of palms) expect(p.z).toBeGreaterThan(0.2);
      } else {
        expect(palms[0]!.x).toBeLessThan(-0.2);
        expect(palms[1]!.x).toBeGreaterThan(0.2);
      }
    }
    actor.dispose();
    material.dispose();
  }
});
