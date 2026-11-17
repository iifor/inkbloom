import * as THREE from 'three';
import { color, MAX_COLORS } from '@/content/palette';
import { ALWAYS_COLOR, type GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Rng } from '@/world/math/rng';
import type { Wilderness } from '@/world/wilderness/generator';
import type { PigmentSource } from '@/world/wilderness/sources';
import { place, sheet } from './plant-geometry';

const tau = 2 * Math.PI;
const bark = color('bark'),
  shade = color('forest'),
  green = color('sprout');
const cane = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(),
  new THREE.Vector3(0.12, 1.02, -0.09),
  new THREE.Vector3(0.96, 0.95, 0.07),
);
const wood = new THREE.TubeGeometry(cane, 4, 0.016, 5, false);
const leaf = sheet(4, 2, (t, side) => {
  const width = 0.001 + 0.079 * Math.pow(Math.sin(Math.PI * t), 1.13) * (1.17 - 0.36 * t);
  return new THREE.Vector3(
    0.32 * t,
    0.077 * Math.sin(2.65 * t) - 0.075 * t * t - 0.43 * width * Math.abs(side),
    width * side + 0.028 * t * t,
  );
});
const fruit = new THREE.SphereGeometry(1, 9, 5);
const berryWash: number[] = [];
const vertices = fruit.getAttribute('position');
for (let i = 0; i < vertices.count; i++) {
  const x = vertices.getX(i),
    y = vertices.getY(i),
    z = vertices.getZ(i);
  // Recess the blossom end and let the dusty skin lighten over the shoulders.
  vertices.setY(i, y + 0.22 * Math.max(0, -y) ** 12);
  berryWash.push(0.12 + (0.63 * (y + 1)) / 2 + 0.23 * (1 - y * y) + 0.09 * x - 0.06 * z);
}
fruit.computeVertexNormals();
const pedicel = new THREE.CylinderGeometry(0.004, 0.004, 1, 4, 1, true);

export function addPigmentBerries(
  g: GeometryBuilder,
  src: PigmentSource,
  ground: Wilderness['heightAt'],
  rng: Rng,
): void {
  const phase = rng.range(0, tau);
  for (let i = 0; i < 8; i++) {
    const yaw = phase + i * 2.4 + rng.range(-0.2, 0.2);
    const x = src.x + 0.16 * Math.cos(yaw),
      z = src.z - 0.16 * Math.sin(yaw);
    const width = i < 2 ? rng.range(0.37, 0.63) : rng.range(0.82, 1.15);
    const plant = place([x, ground(x, z) - 0.035, z], [0, yaw, 0], [width, rng.range(0.95, 1.48), width]);
    g.meshSmooth(wood, plant, bark, ALWAYS_COLOR);
    for (let j = 0; j < 3; j++) {
      const t = 0.24 + 0.24 * j,
        p = cane.getPoint(t);
      const fork = place(
        [p.x, p.y, p.z],
        [0, (j % 2 ? -1 : 1) * rng.range(0.81, 1.42), -0.22],
        [0.45, 0.33, 0.45],
      ).premultiply(plant);
      g.meshSmooth(wood, fork, bark, ALWAYS_COLOR);
      for (let l = 0; l < 5; l++) {
        const bud = cane.getPoint(0.24 + 0.18 * l);
        const length = rng.range(0.76, 1.16);
        const pose = place(
          [bud.x, bud.y, bud.z],
          [rng.range(-0.94, 0.94), (l % 2 ? -1 : 1) * rng.range(0.76, 1.6), rng.range(-0.66, 0.49)],
          [2.18 * length, 2.24, 2.9 * length],
        );
        g.meshSmooth(leaf, pose.premultiply(fork), (l + i + j) % 3 ? green : shade, ALWAYS_COLOR);
      }
    }
    // Hang fruit at the ends of the canes. Each short pedicel actually joins the fruit.
    const count = rng.int(3, 5);
    const cluster = rng.range(0.7, 0.91);
    for (let j = 0; j < count; j++) {
      const bud = cane.getPoint(cluster + (0.1 * j) / count).applyMatrix4(plant);
      const radius = rng.range(0.048, 0.073);
      const a = yaw + j * 2.4;
      const spread = rng.range(0.06, 0.13);
      const fall = new THREE.Vector3(spread * Math.cos(a), -rng.range(0.07, 0.22), spread * Math.sin(a));
      const end = bud.clone().add(fall);
      const length = fall.length();
      const stem = new THREE.Matrix4().compose(
        bud.lerp(end, 0.5),
        new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP, fall.divideScalar(length)),
        new THREE.Vector3(1, length, 1),
      );
      g.meshSmooth(pedicel, stem, shade, ALWAYS_COLOR);
      const pose = place(
        [end.x, end.y - radius * 0.88, end.z],
        [0, yaw + j, rng.range(-0.25, 0.25)],
        [radius, radius * 0.92, radius * 1.03],
      );
      g.meshSmooth(fruit, pose, MAX_COLORS + src.color, ALWAYS_COLOR, berryWash);
    }
  }
}
