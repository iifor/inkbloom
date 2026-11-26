import * as THREE from 'three';
import { color, type ColorKey } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { DRIFT_CELL, DRIFT_STEP, riverDriftTrack } from '@/world/wilderness/river-drift';
import { sheet } from './plant-geometry';

function stem(g: GeometryBuilder, from: THREE.Vector3, to: THREE.Vector3, radius: number, tint: ColorKey) {
  const axis = to.clone().sub(from);
  const shape = new THREE.CylinderGeometry(radius * 0.55, radius, axis.length(), 5);
  const pose = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()),
  );
  pose.setPosition(from.clone().lerp(to, 0.5));
  g.mesh(shape, pose, color(tint));
  shape.dispose();
}

function leaf(tint: ColorKey) {
  const g = new GeometryBuilder();
  const blade = sheet(6, 2, (t, side) => {
    const width = 0.082 * Math.sin(t * Math.PI) ** 0.82 + 0.001;
    return new THREE.Vector3(
      -side * width + 0.024 * t * t,
      width * (1 - Math.abs(side)) * 0.18 + 0.024 * t * t,
      (t - 0.5) * 0.32,
    );
  });
  g.mesh(blade, new THREE.Matrix4(), color(tint));
  blade.dispose();
  stem(g, new THREE.Vector3(-0.008, 0, -0.2), new THREE.Vector3(0.006, 0.017, 0.012), 0.0045, 'brown');
  return g.build();
}

function twig() {
  const g = new GeometryBuilder(),
    joint = new THREE.Vector3(0.027, 0.002, 0.04);
  stem(g, new THREE.Vector3(-0.02, 0, -0.34), joint, 0.024, 'bark');
  stem(g, joint, new THREE.Vector3(-0.035, 0.019, 0.31), 0.017, 'brown');
  stem(g, joint, new THREE.Vector3(0.17, 0.047, 0.21), 0.013, 'bark');
  return g.build();
}

const RADIUS = 6;
type Track = ReturnType<typeof riverDriftTrack>;

export class RiverDrift {
  private readonly tracks = new Map<string, Track>();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly pose = new THREE.Object3D();
  private ix = NaN;
  private iz = NaN;

  constructor(
    private readonly world: Wilderness,
    root: THREE.Group,
    material: THREE.Material,
  ) {
    this.meshes = [leaf('yellow'), leaf('orange'), leaf('clayTile'), twig()].map((geometry, i) => {
      const mesh = new THREE.InstancedMesh(geometry, material, (2 * RADIUS + 1) ** 2);
      mesh.name = i === 3 ? '水面枯枝' : '水面落叶';
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    });
  }

  update(clock: number, player: THREE.Vector3): void {
    const ix = Math.floor(player.x / DRIFT_CELL),
      iz = Math.floor(player.z / DRIFT_CELL);
    if (ix !== this.ix || iz !== this.iz) {
      this.ix = ix;
      this.iz = iz;
      const keep = new Set<string>();
      for (let z = iz - RADIUS; z <= iz + RADIUS; z++)
        for (let x = ix - RADIUS; x <= ix + RADIUS; x++) {
          const key = `${x},${z}`;
          keep.add(key);
          if (!this.tracks.has(key)) this.tracks.set(key, riverDriftTrack(this.world, x, z));
        }
      for (const key of this.tracks.keys()) if (!keep.has(key)) this.tracks.delete(key);
    }
    for (const mesh of this.meshes) mesh.count = 0;
    for (const t of this.tracks.values()) {
      if (!t) continue;
      const age = (clock + t.phase) % t.period;
      if (age >= t.duration) continue;
      const step = Math.floor(age / DRIFT_STEP),
        f = age / DRIFT_STEP - step;
      const a = t.points[step]!,
        b = t.points[step + 1]!;
      const x = a.x + (b.x - a.x) * f,
        z = a.z + (b.z - a.z) * f;
      const distance = Math.hypot(player.x - x, player.z - z);
      if (distance >= 30) continue;
      const swell = clock * 1.7 + t.yaw;
      this.pose.position.set(x, WATER_LEVEL + 0.017 + 0.007 * Math.sin(swell), z);
      this.pose.rotation.set(
        0.055 * Math.sin(swell),
        t.yaw + age * t.spin * (t.twig ? 0.35 : 1),
        0.06 * Math.cos(swell),
        'YXZ',
      );
      this.pose.scale.setScalar(t.size * Math.min(1, age, t.duration - age, (30 - distance) / 5));
      this.pose.updateMatrix();
      const mesh = this.meshes[t.twig ? 3 : t.tint]!;
      mesh.setMatrixAt(mesh.count++, this.pose.matrix);
    }
    for (const mesh of this.meshes) if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.tracks.clear();
  }
}
