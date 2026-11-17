import * as THREE from 'three';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { hashAt, unit } from '@/world/math/hash';
import { Rng } from '@/world/math/rng';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { sheet } from './plant-geometry';

function ribbons() {
  const g = new GeometryBuilder(),
    rng = new Rng(241);
  const pose = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) {
    const yaw = 2.4 * i + rng.range(-0.38, 0.38);
    const height = rng.range(0.4, 1),
      reach = rng.range(0.28, 0.58);
    const twist = rng.range(-1.6, 1.6),
      breadth = rng.range(0.03, 0.057);
    const sweep = rng.range(-0.14, 0.14);
    const tall = height > 0.76;
    const blade = sheet(tall ? 5 : 4, tall ? 2 : 1, (t, side) => {
      const width = breadth * (0.18 * (1 - t) + 0.98 * Math.sin(Math.PI * t) ** 0.74 + 0.015);
      const turn = twist * t + 0.45 * Math.sin(3.6 * t);
      const fold = width * (1 - Math.abs(side)) * 0.34;
      return new THREE.Vector3(
        0.028 + reach * t * t + Math.sin(5.2 * t) * 0.058 + side * width * Math.sin(turn) + fold,
        height * t * (1.14 - 0.27 * t),
        sweep * Math.sin(3.8 * t) + side * width * Math.cos(turn),
      );
    });
    g.meshSmooth(blade, pose.makeRotationY(yaw), i % 3 ? color('forest') : color('teal'));
    blade.dispose();
  }
  return g.build();
}

export class Waterweed {
  private readonly shape = ribbons();
  private readonly material = makeInkMaterial({ side: THREE.DoubleSide, waterweed: true });
  constructor(private readonly root: THREE.Group) {}

  add(chunk: WildChunk, w: Wilderness): () => void {
    if (!chunk.hasWater) return () => {};
    const plants: THREE.Matrix4[] = [];
    const pose = new THREE.Object3D();
    for (let iz = 0; iz < chunk.n; iz += 2)
      for (let ix = 0; ix < chunk.n; ix += 2) {
        const seed = hashAt(w.seed, 'weed', chunk.cx * chunk.n + ix, chunk.cz * chunk.n + iz);
        if (unit(seed) > 0.34) continue;
        const rng = new Rng(seed);
        const cx = chunk.x0 + (ix + 1) * chunk.cell,
          cz = chunk.z0 + (iz + 1) * chunk.cell;
        for (let i = 0; i < 4; i++) {
          const x = cx + rng.range(-2.6, 2.6),
            z = cz + rng.range(-2.6, 2.6),
            bed = w.heightAt(x, z),
            depth = WATER_LEVEL - bed;
          if (depth < 0.62 || depth > 3.6) continue;
          pose.position.set(x, bed - 0.09, z);
          pose.rotation.y = rng.range(0, 6.28);
          const size = rng.range(0.65, 1.24);
          pose.scale.set(size, Math.min(depth * 0.83, 1.7) * rng.range(0.7, 1), size);
          pose.updateMatrix();
          plants.push(pose.matrix.clone());
        }
      }
    if (!plants.length) return () => {};
    const mesh = new THREE.InstancedMesh(this.shape, this.material, plants.length);
    mesh.name = '水草';
    plants.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    mesh.boundingSphere!.radius += 0.17;
    this.root.add(mesh);
    return () => {
      mesh.removeFromParent();
      mesh.dispose();
    };
  }
  dispose(): void {
    this.shape.dispose();
    this.material.dispose();
  }
}
