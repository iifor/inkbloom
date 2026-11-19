import * as THREE from 'three';
import { color } from '@/content/palette';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { ColliderData, Vec3Like } from '@/engine/physics/world';

type WallPoint = (along: number, height: number, depth: number) => Vec3Like;
type Variation = (salt: number) => number;

const stem = new THREE.CylinderGeometry(0.72, 1, 1, 5, 1, true);
const pollen = new THREE.SphereGeometry(1, 7, 3);
const up = new THREE.Vector3(0, 1, 0);
const stalk = color('forest');
const leaf = color('leaf');
const wood = color('bark');
const brown = color('brown');
const yellow = color('yellow');
const flowers = [color('pink'), color('cream'), yellow, color('red')];
const vec = (p: Vec3Like): THREE.Vector3 => new THREE.Vector3(p.x, p.y, p.z);

/** A blade with a raised midrib and a thinner back, both visible from the side. */
function blade(outline: readonly (readonly [number, number])[]): THREE.BufferGeometry {
  const positions = [0, 0.49, 0.13, 0, 0.49, 0.03];
  const indices: number[] = [];
  for (const [x, y] of outline) positions.push(x, y, 0.2 * y * y - 0.06 * Math.abs(x));
  for (let i = 0; i < outline.length; i++) {
    const a = 2 + i;
    const b = 2 + ((i + 1) % outline.length);
    indices.push(0, a, b, 1, b, a);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const smallLeaf = blade([
  [0, 0],
  [0.3, 0.22],
  [0.48, 0.49],
  [0.29, 0.76],
  [0, 1],
  [-0.29, 0.76],
  [-0.48, 0.49],
  [-0.3, 0.22],
]);
const ivyLeaf = blade([
  [0, 0],
  [0.47, 0.12],
  [0.61, 0.36],
  [0.64, 0.48],
  [0.38, 0.48],
  [0.44, 0.7],
  [0.36, 0.77],
  [0.2, 0.72],
  [0.08, 0.94],
  [0, 1],
  [-0.08, 0.94],
  [-0.2, 0.72],
  [-0.36, 0.77],
  [-0.44, 0.7],
  [-0.38, 0.48],
  [-0.64, 0.48],
  [-0.61, 0.36],
  [-0.47, 0.12],
]);
const petal = blade([
  [0, 0],
  [0.42, 0.36],
  [0.49, 0.64],
  [0.33, 0.9],
  [0, 1],
  [-0.33, 0.9],
  [-0.49, 0.64],
  [-0.42, 0.36],
]);

function plants(g: GeometryBuilder, surface: number) {
  const pose = new THREE.Matrix4();
  const axis = new THREE.Quaternion();
  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const middle = new THREE.Vector3();
  return {
    twig(a: THREE.Vector3, b: THREE.Vector3, radius: number, tint: number) {
      direction.subVectors(b, a);
      const height = direction.length();
      axis.setFromUnitVectors(up, direction.normalize());
      pose.compose(middle.copy(a).lerp(b, 0.5), axis, scale.set(radius, height, radius));
      g.meshSmooth(stem, pose, tint, surface);
    },
    blade(
      geometry: THREE.BufferGeometry,
      a: THREE.Vector3,
      b: THREE.Vector3,
      face: THREE.Vector3,
      width: number,
      tint: number,
    ) {
      direction.subVectors(b, a);
      const length = direction.length();
      direction.normalize();
      side.crossVectors(direction, face).normalize();
      normal.crossVectors(side, direction);
      pose
        .makeBasis(side, direction, normal)
        .scale(scale.set(length * width, length, length))
        .setPosition(a);
      g.meshSmooth(geometry, pose, tint, surface);
    },
    centre(at: THREE.Vector3, radius: number) {
      pose.makeScale(radius, radius, radius).setPosition(at);
      g.meshSmooth(pollen, pose, yellow, surface);
    },
  };
}

export function appendWindowBox(
  g: GeometryBuilder,
  p: WallPoint,
  u: number,
  half: number,
  surface: number,
  roll: Variation,
  collide: (min: Vec3Like, max: Vec3Like, data: ColliderData) => void,
): void {
  const bottomY = 0.83;
  const rimY = 1.105;
  const frontDepth = 0.43;
  const bounds = (left: number, right: number, bottom: number, top: number, near: number, far: number) => {
    const a = p(u + left, bottom, near);
    const b = p(u + right, top, far);
    return [
      { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) },
      { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) },
    ] as const;
  };
  const surfaceFaces = { px: surface, nx: surface, py: surface, ny: surface, pz: surface, nz: surface };
  const plank = (
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
    tint: number,
  ) => {
    const faces = { px: tint, nx: tint, py: tint, ny: tint, pz: tint, nz: tint };
    g.box(...bounds(left, right, bottom, top, near, far), faces, surfaceFaces);
  };
  plank(-half, half, bottomY, 1.02, 0.09, 0.42, wood);
  plank(-half + 0.05, half - 0.05, 1.02, 1.058, 0.145, 0.375, brown);
  plank(-half, half, 1.02, rimY, 0.09, 0.14, wood);
  plank(-half, half, 1.02, rimY, 0.38, frontDepth, wood);
  plank(-half, -half + 0.05, 1.02, rimY, 0.14, 0.38, wood);
  plank(half - 0.05, half, 1.02, rimY, 0.14, 0.38, wood);
  // One solid envelope for the trough; the stems and leaves stay out of the way.
  collide(...bounds(-half, half, bottomY, rimY, 0, frontDepth), {
    noAutoStep: true,
    faces: surface >= 0 ? surfaceFaces : undefined,
  });

  const plant = plants(g, surface);
  const outward = vec(p(u, 0, 1))
    .sub(vec(p(u, 0, 0)))
    .normalize();
  const across = vec(p(u + 1, 0, 0))
    .sub(vec(p(u, 0, 0)))
    .normalize();
  const startColor = Math.floor(roll(0) * flowers.length);
  for (let i = 0; i < 7; i++) {
    const salt = 12 * i + 3;
    const x = u + half * ((i - 3) * 0.26 + (roll(salt) - 0.5) * 0.13);
    const depth = 0.18 + roll(salt + 1) * 0.13;
    const rise = 0.19 + 0.2 * roll(salt + 2);
    const lean = (roll(salt + 3) - 0.5) * 0.13;
    const root = vec(p(x, 1.056, depth));
    const joint = vec(p(x + lean * 0.35, 1.056 + rise * 0.52, depth + 0.022));
    const head = vec(p(x + lean, 1.056 + rise, depth + 0.045));
    plant.twig(root, joint, 0.013, stalk);
    plant.twig(joint, head, 0.009, stalk);
    for (const sign of [-1, 1]) {
      const start = joint.clone().lerp(sign > 0 ? root : head, 0.33);
      const tip = start
        .clone()
        .addScaledVector(across, sign * (0.085 + 0.035 * roll(salt + 4)))
        .addScaledVector(up, 0.055)
        .addScaledVector(outward, 0.06);
      plant.blade(smallLeaf, start, tip, outward.clone().addScaledVector(up, 0.35), 0.62, leaf);
    }
    const face = outward
      .clone()
      .addScaledVector(up, 0.78 + roll(salt + 5) * 0.9)
      .normalize();
    const upper = new THREE.Vector3().crossVectors(face, across).normalize();
    if (upper.y < 0) upper.negate();
    const size = 0.06 + roll(salt + 6) * 0.03;
    const tint = flowers[(startColor + (i % 3 === 0 ? 1 : 0)) % flowers.length]!;
    for (let k = 0; k < 5; k++) {
      const angle = k * ((Math.PI * 2) / 5) + roll(salt + 7) * Math.PI;
      const tip = head
        .clone()
        .addScaledVector(across, size * Math.cos(angle))
        .addScaledVector(upper, size * Math.sin(angle));
      plant.blade(petal, head, tip, face, 0.81, tint);
    }
    plant.centre(head.clone().addScaledVector(face, size * 0.16), size * 0.24);
  }
}

export function appendIvy(
  g: GeometryBuilder,
  p: WallPoint,
  corner: number,
  inward: number,
  height: number,
  foot: number | undefined,
  surface: number,
  roll: Variation,
): void {
  const plant = plants(g, surface);
  const outward = vec(p(corner, 0, 1))
    .sub(vec(p(corner, 0, 0)))
    .normalize();
  const nodes = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    const u = corner + inward * (0.22 + t * 0.27 + Math.sin(11 * t + roll(4)) * 0.13 * t);
    return { u, y: 0.12 + height * t, depth: 0.085 + 0.025 * Math.sin(7 * t) };
  });
  const point = (n: (typeof nodes)[number]) => vec(p(n.u, n.y, n.depth));
  const first = nodes[0]!;
  if (foot !== undefined && foot < 0) {
    const turn = vec(p(first.u - inward * 0.02, 0.035, 0.28));
    plant.twig(vec(p(first.u - inward * 0.09, foot - 0.03, 0.3)), turn, 0.025, wood);
    plant.twig(turn, point(first), 0.023, wood);
  }
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i]!;
    const at = point(node);
    const t = i / 11;
    plant.twig(point(nodes[i - 1]!), at, 0.024 - 0.015 * t, wood);
    const toward = inward * (i % 3 !== 0 ? 1 : -0.46);
    const reach = (0.55 - 0.25 * t) * (0.7 + 0.45 * roll(32 + i));
    const branch = vec(p(node.u + toward * reach, node.y + reach * 0.37, node.depth + 0.025));
    plant.twig(at, branch, 0.012 - 0.005 * t, stalk);
    for (let j = 0; j < 3; j++) {
      const salt = 80 + 5 * i + j;
      const base = at.clone().lerp(branch, 0.2 + j * 0.39);
      const sign = j % 2 === 0 ? 1 : -1;
      const length = (0.27 - 0.12 * t) * (0.8 + roll(salt) * 0.45);
      const leafBase = base
        .clone()
        .addScaledVector(up, sign * (0.03 + 0.035 * roll(salt + 1)))
        .addScaledVector(outward, 0.025);
      plant.twig(base, leafBase, 0.006, stalk);
      const tip = leafBase
        .clone()
        .addScaledVector(up, sign * length * 0.95)
        .addScaledVector(outward, length * 0.24);
      const across = vec(p(node.u + toward * length * (0.48 + roll(salt + 2) * 0.4), node.y, node.depth)).sub(
        at,
      );
      tip.add(across);
      plant.blade(ivyLeaf, leafBase, tip, outward, 0.94, (i + j) % 4 === 0 ? stalk : leaf);
    }
  }
}
