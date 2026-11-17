import * as THREE from 'three';
import { color, MAX_COLORS } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { hashString } from '@/world/math/hash';
import { Rng } from '@/world/math/rng';
import type { Wilderness } from '@/world/wilderness/generator';
import type { PigmentSource } from '@/world/wilderness/sources';
import { place, sheet } from './plant-geometry';

const TAU = 2 * Math.PI;
const straw = color('sand');
const green = color('sprout');

// The last third of the cane carries the panicle. Leaves and seed sprays attach
// to the same centreline so their bases meet the stem even on a leaning plant.
function centre(t: number): [number, number, number] {
  return [0.025 * t + 0.32 * t ** 3, t - 0.09 * t ** 4, 0.045 * t * t];
}

const stem = new THREE.LatheGeometry(
  [0, 0.25, 0.5, 0.7, 0.84, 1].map((t) => new THREE.Vector2(0.013 * (1 - t) + 0.0018, t)),
  6,
);
const stalkVertices = stem.getAttribute('position');
for (let i = 0; i < stalkVertices.count; i++) {
  const [x, y, z] = centre(stalkVertices.getY(i));
  stalkVertices.setXYZ(i, stalkVertices.getX(i) + x, y, stalkVertices.getZ(i) + z);
}
stem.computeVertexNormals();

const leaf = sheet(6, 2, (t, side) => {
  const width = 0.001 + 0.026 * Math.sin(Math.PI * t) ** 0.82;
  return new THREE.Vector3(
    0.46 * t,
    0.19 * Math.sin(2.85 * t) - 0.045 * t * t - Math.abs(side) * width * 0.55,
    side * width + 0.04 * t * t,
  );
});

// Each brush-shaped spray has a narrow attachment, a folded belly and a long
// pale point. Forking several off a branch leaves gaps for the sky between them.
const wash: number[] = [];
const spray = sheet(4, 2, (t, side) => {
  const width = 0.0007 + 0.012 * Math.sin(Math.PI * t) * (1.3 - 0.7 * t);
  wash.push(0.23 + 0.55 * t + 0.14 * (1 - Math.abs(side)));
  return new THREE.Vector3(
    0.16 * t,
    0.11 * t + 0.048 * Math.sin(Math.PI * t) - Math.abs(side) * width * 0.65,
    side * width,
  );
});
const awnWash: number[] = [];
const awn = sheet(3, 1, (t, side) => {
  awnWash.push(0.5 + 0.41 * t);
  return new THREE.Vector3(
    0.12 * t,
    0.17 * t - 0.036 * t * t,
    side * (0.0006 + 0.007 * Math.sin(Math.PI * t)),
  );
});

export function buildPigmentReeds(
  src: PigmentSource,
  ground: Wilderness['heightAt'],
  sites: Rng,
): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const wind: number[] = [];
  const rng = new Rng(hashString(src.id + ':panicles'));
  const direction = rng.range(0, TAU);
  for (let i = 0; i < 12; i++) {
    const x = src.x + sites.range(-1.3, 1.3),
      z = src.z + sites.range(-1.3, 1.3);
    const h = sites.range(1.2, 2.2);
    const y = ground(x, z) - 0.035;
    const first = g.vertexCount;
    const plant = place([x, y, z], [0, direction + rng.range(-1.1, 1.1), rng.range(-0.12, 0.09)], [h, h, h]);
    g.meshSmooth(stem, plant, i % 3 === 0 ? green : straw, ALWAYS_COLOR);
    const twist = rng.range(0, TAU);
    for (let j = 0; j < 4; j++) {
      const size = rng.range(0.75, 1.12) - 0.09 * j;
      const pose = place(
        centre(0.16 + 0.14 * j),
        [0, twist + j * 2.4, rng.range(-0.25, 0.48)],
        [size, size, size],
      );
      g.meshSmooth(leaf, pose.premultiply(plant), j === 0 && i % 4 === 0 ? straw : green, ALWAYS_COLOR);
    }
    const openness = rng.range(0.65, 1.15);
    for (let j = 0; j < 14; j++) {
      const t = j / 14;
      const scale = 0.48 + 0.56 * Math.sin(Math.PI * (0.22 + 0.78 * t));
      const branch = place(
        centre(0.7 + 0.3 * t),
        [0, twist + 2.4 * j, 0.05 + 0.5 * t],
        [scale * openness, scale, scale],
      );
      branch.premultiply(plant);
      g.meshSmooth(spray, branch, MAX_COLORS + src.color, ALWAYS_COLOR, wash);
      // The outer florets diverge just above the branch base, like barbs on a feather.
      const fork = place([0.049, 0.072, 0], [0, j % 2 ? 0.48 : -0.48, 0.16], [1, 1, 1]);
      const awnColor = (i + j) % 3 === 0 ? straw : src.color;
      g.meshSmooth(awn, fork.premultiply(branch), MAX_COLORS + awnColor, ALWAYS_COLOR, awnWash);
    }
    const phase = rng.next();
    for (let v = first; v < g.vertexCount; v++) wind.push(x, y, z, phase);
  }
  const geometry = g.build();
  geometry.setAttribute('aReedRoot', new THREE.Float32BufferAttribute(wind, 4));
  // The renderer culls against the rest pose; allow room for the tallest swaying plume.
  geometry.boundingSphere!.radius += 0.85;
  return geometry;
}
