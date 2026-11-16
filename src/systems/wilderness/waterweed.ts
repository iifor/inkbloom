import * as THREE from 'three';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { hashAt, unit } from '@/world/math/hash';
import { Rng } from '@/world/math/rng';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';

function ribbons() {
  const g = new GeometryBuilder(),
    rng = new Rng(241);
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4,
      dx = Math.cos(a),
      dz = Math.sin(a),
      h = rng.range(0.55, 1);
    const point = (t: number, side: number) => {
      const r = 0.08 + t * t * 0.44,
        width = (1 - t * 0.96) * 0.064;
      return new THREE.Vector3(dx * r - side * dz * width, t * h, dz * r + side * dx * width);
    };
    for (let j = 0; j < 3; j++)
      g.quad(
        point(j / 3, -1),
        point(j / 3, 1),
        point((j + 1) / 3, 1),
        point((j + 1) / 3, -1),
        { x: -dx, y: 0.2, z: -dz },
        i % 3 === 0 ? color('green') : color('forest'),
      );
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
