import * as THREE from 'three';
import { color, MAX_COLORS } from '@/content/palette';
import { ALWAYS_COLOR, type GeometryBuilder } from '@/engine/render/geometry-builder';
import { hashString } from '@/world/math/hash';
import { Rng } from '@/world/math/rng';
import type { Wilderness } from '@/world/wilderness/generator';
import type { PigmentSource } from '@/world/wilderness/sources';

const TAU = 2 * Math.PI;
const stemColor = color('sprout');
const leafColor = color('green');
const pollen = color('yellow');
const heart = color('brown');

// Render thin petals and leaves with the field's double-sided material, sharing
// the same vertices between adjoining folds and between front and back views.
function sheet(
  rows: number,
  columns: number,
  point: (t: number, side: number) => THREE.Vector3,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const p = point(row / rows, (2 * col) / columns - 1);
      positions.push(p.x, p.y, p.z);
      if (row === rows || col === columns) continue;
      const a = row * (columns + 1) + col;
      const b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makePetal(phase: number) {
  const wash: number[] = [];
  const geometry = sheet(2, 14, (t, side) => {
    const fold = Math.cos(2.6 * Math.PI * side + phase + 0.6 * t);
    const radius = 0.016 + t * (0.198 - 0.072 * side ** 4 + 0.006 * fold * t);
    const angle = side * (0.45 + 0.49 * Math.sin(2.45 * t)) + phase * t * 0.035;
    const y = t * (0.072 + 0.031 * side * side) + t * t * (0.016 * fold - 0.015 * side);
    // Keep both ends away from integer boundaries in the half-float colour buffer.
    wash.push(0.055 + 0.69 * t + 0.15 * t * fold + 0.055 * t * Math.sin(20 * side + phase));
    return new THREE.Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle));
  });
  return { geometry, wash };
}

const petals = [makePetal(-0.8), makePetal(1.1)];
const leaf = sheet(3, 2, (t, side) => {
  const width = 0.002 + 0.034 * Math.sin(Math.PI * t);
  return new THREE.Vector3(0.24 * t, 0.14 * Math.sin(2.15 * t) - Math.abs(side) * width * 0.43, side * width);
});
const center = new THREE.SphereGeometry(1, 8, 3);
const anther = new THREE.SphereGeometry(1, 4, 2);
const stemPath = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(),
  new THREE.Vector3(-0.06, 0.53, 0.02),
  new THREE.Vector3(0.17, 1, -0.035),
);
const stem = new THREE.TubeGeometry(stemPath, 4, 0.012, 5, false);

type Triple = [number, number, number];
function place(position: Triple, rotation: Triple, scale: Triple) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, 'YXZ')),
    new THREE.Vector3(...scale),
  );
}

export function addPigmentFlowers(
  g: GeometryBuilder,
  src: PigmentSource,
  ground: Wilderness['heightAt'],
  positions: Rng,
): void {
  // Keep the established planting sites. Shape and flowering stage use a separate stream.
  const rng = new Rng(hashString(src.id + ':blooms'));
  const budIndex = rng.int(0, 8);
  for (let i = 0; i < 9; i++) {
    const x = src.x + positions.range(-1.6, 1.6),
      z = src.z + positions.range(-1.6, 1.6);
    const height = rng.range(0.63, 1.02);
    const plant = place([x, ground(x, z) - 0.025, z], [0, rng.range(0, TAU), 0], [1, height, 1]);
    g.meshSmooth(stem, plant, stemColor, ALWAYS_COLOR);
    for (let j = 0; j < 3; j++) {
      const p = stemPath.getPoint(0.23 + 0.22 * j);
      const size = 1 - 0.18 * j;
      const pose = place(
        [p.x, p.y, p.z],
        [0, j * 2.4 + rng.range(-0.6, 0.6), rng.range(-0.18, 0.3)],
        [size, size, size],
      );
      g.meshSmooth(leaf, pose.premultiply(plant), leafColor, ALWAYS_COLOR);
    }

    const tip = stemPath.v2;
    const size = rng.range(0.78, 1.17);
    const head = place(
      [tip.x, tip.y, tip.z],
      [rng.range(-0.55, 0.55), rng.range(0, TAU), rng.range(-0.6, 0.48)],
      [size, size, size],
    );
    head.premultiply(plant);
    if (i === budIndex) {
      // Two folded sepals part around the first sliver of pigment.
      const seam = place([0, 0.064, 0], [0, 0, 0], [0.032, 0.067, 0.037]);
      g.meshSmooth(center, seam.premultiply(head), src.color, ALWAYS_COLOR);
      for (const side of [-1, 1]) {
        const sepal = place([0.016 * side, 0.053, 0], [0, 0, -0.15 * side], [0.031, 0.072, 0.042]);
        g.meshSmooth(center, sepal.premultiply(head), stemColor, ALWAYS_COLOR);
      }
      continue;
    }
    const calyx = place([0, 0, 0], [0, 0, 0], [0.037, 0.026, 0.037]);
    g.meshSmooth(center, calyx.premultiply(head), stemColor, ALWAYS_COLOR);

    const count = i % 3 === 0 ? 4 : 5;
    const opening = rng.range(-0.17, 0.28);
    for (let j = 0; j < count; j++) {
      const p = petals[j % petals.length]!;
      const yaw = (TAU * j) / count + rng.range(-0.06, 0.06);
      const pose = place(
        [0, (j % 2) * 0.008, 0],
        [rng.range(-0.1, 0.1), yaw, opening + rng.range(-0.14, 0.14)],
        [rng.range(0.92, 1.1), 1, rng.range(0.94, 1.13)],
      );
      g.meshSmooth(p.geometry, pose.premultiply(head), MAX_COLORS + src.color, ALWAYS_COLOR, p.wash);
    }
    g.meshSmooth(
      center,
      place([0, 0.028, 0], [0, 0, 0], [0.048, 0.023, 0.048]).premultiply(head),
      heart,
      ALWAYS_COLOR,
    );
    for (let j = 0; j < 10; j++) {
      const a = (j * TAU) / 10 + i + 0.14 * Math.sin(3 * j);
      const radius = 0.028 + 0.011 * Math.sin(5 * j + i);
      const pose = place(
        [radius * Math.cos(a), 0.05 + 0.005 * Math.cos(j), radius * Math.sin(a)],
        [0, -a, -0.36],
        [0.012, 0.007, 0.0045],
      );
      g.meshSmooth(anther, pose.premultiply(head), pollen, ALWAYS_COLOR);
    }
  }
}
