import * as THREE from 'three';
import { color } from '@/content/palette';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import { Rng } from '@/world/math/rng';
import { type GroundProp, propFootprint } from '@/world/wilderness/ground-props';
import { BOULDER } from './stone-shape';

const bark = color('bark'),
  wood = color('brown'),
  worn = color('sand');
const stem = new THREE.CylinderGeometry(0.84, 1, 1, 9);
const twig = new THREE.CylinderGeometry(0.28, 1, 1, 6);
const up = new THREE.Vector3(0, 1, 0);
// Moss follows the actual facets, leaving broken edges and exposed stone between patches.
const moss = BOULDER.clone();
const idx = moss.index!,
  pos = moss.getAttribute('position'),
  patch: number[] = [];
for (let i = 0; i < idx.count; i += 3) {
  const a = idx.getX(i),
    b = idx.getX(i + 1),
    c = idx.getX(i + 2);
  const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
  if (y > 0.45 + 0.32 * Math.sin(pos.getX(a) * 4 + pos.getZ(c) * 2)) patch.push(a, b, c);
}
moss.setIndex(patch);

export function appendGroundProp(
  g: GeometryBuilder,
  p: GroundProp,
  ground: (x: number, z: number) => number,
): void {
  const rng = new Rng(p.seed),
    s = p.scale;
  const sin = Math.sin(p.yaw),
    cos = Math.cos(p.yaw);
  const local = (x: number, y: number, z: number) =>
    new THREE.Vector3(p.x + s * (cos * x + sin * z), p.y + s * y, p.z + s * (-sin * x + cos * z));
  const matrix = new THREE.Matrix4(),
    rotation = new THREE.Quaternion();
  const stone = (
    x: number,
    z: number,
    hw: number,
    h: number,
    hd: number,
    angle: number,
    tint: number,
    green = false,
  ) => {
    const at = local(x, 0, z);
    at.y = ground(at.x, at.z) + h * s * 0.18;
    rotation.setFromEuler(new THREE.Euler(0, p.yaw + angle, 0));
    matrix.compose(at, rotation, new THREE.Vector3(hw * s, h * s, hd * s));
    g.meshSmooth(BOULDER, matrix, tint);
    if (green) {
      matrix.scale(new THREE.Vector3(1.008, 1.014, 1.008));
      g.meshSmooth(moss, matrix, color('forest'));
    }
  };
  if (p.kind === 'shingle') {
    const count = rng.int(12, 22);
    for (let i = 0; i < count; i++) {
      const r = rng.range(0.09, 0.34);
      stone(
        rng.range(-2.5, 2.5),
        rng.range(-1, 1),
        r,
        r * 0.46,
        r * rng.range(0.55, 0.9),
        rng.next() * 6,
        rng.chance(0.6) ? color('rock') : color('stone'),
      );
    }
    return;
  }
  if (p.kind === 'outcrop' || p.kind === 'mossRock') {
    stone(0, 0, 1.38, 0.96, 1.06, 0, color('rock'), p.kind === 'mossRock');
    stone(1.0, 0.35, 0.73, 0.49, 0.57, 0.55, color('rock'), p.kind === 'mossRock');
    for (let i = 0; i < 3; i++) {
      const r = rng.range(0.12, 0.35);
      stone(
        rng.range(-1.9, 1.9),
        rng.range(0.9, 1.65),
        r,
        r * 0.65,
        r * 0.78,
        rng.next() * 6,
        color('stone'),
      );
    }
    return;
  }
  const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number, tint: number, shape = stem) => {
    const axis = b.clone().sub(a);
    const length = axis.length();
    rotation.setFromUnitVectors(up, axis.divideScalar(length));
    matrix.compose(a.clone().lerp(b, 0.5), rotation, new THREE.Vector3(r * s, length, r * s));
    g.mesh(shape, matrix, tint);
  };
  if (p.kind === 'stump') {
    const top = rng.range(0.55, 0.83);
    limb(local(0, -0.18, 0), local(0, top, 0), 0.52, bark);
    // End grain visible from above. Offset the heart from the middle of the cut.
    for (const [r, h, tint] of [
      [0.43, 0, worn],
      [0.31, 0.008, wood],
      [0.27, 0.016, worn],
      [0.11, 0.024, wood],
    ] as const)
      limb(local(0.025, top + h, 0), local(0.025, top + h + 0.009, 0), r, tint);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + rng.range(-0.15, 0.15);
      const end = local(0.85 * Math.cos(a), 0, 0.85 * Math.sin(a));
      end.y = ground(end.x, end.z) - 0.04;
      limb(local(0.21 * Math.cos(a), 0.28, 0.21 * Math.sin(a)), end, 0.18, bark, twig);
    }
    return;
  }
  const drift = p.kind === 'driftwood',
    tint = drift ? worn : bark;
  const point = (x: number, y: number, z: number) => local(x, y + 0.24 + (p.rise * z) / (3.6 * s), z);
  limb(point(0, 0, -1.8), point(0, 0.02, 1.8), 0.32, tint);
  limb(point(0, 0.02, 1.8), point(0, 0.02, 1.815), 0.25, drift ? wood : worn);
  limb(point(0, 0.02, 1.815), point(0, 0.02, 1.822), 0.12, wood);
  limb(point(0, 0.12, 0.56), point(0.46, 0.53, 0.88), 0.13, tint, twig);
  limb(point(-0.12, 0, -0.26), point(-0.61, 0.18, 0.08), 0.11, tint, twig);
  for (let i = 0; i < (drift ? 3 : 5); i++) {
    const a = i * 1.6;
    limb(
      point(0, 0, -1.55),
      point(0.55 * Math.cos(a), 0.22 + 0.38 * Math.sin(a), -2.15 - rng.next() * 0.22),
      0.14,
      tint,
      twig,
    );
  }
}

export function addPropCollider(physics: PhysicsWorld, group: string, p: GroundProp): void {
  const foot = propFootprint(p);
  if (!foot) return;
  const trunk = p.kind === 'windfall' || p.kind === 'driftwood';
  const count = trunk ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const along = (i + 0.5) / count - 0.5;
    const x = p.x + Math.sin(p.yaw) * 2 * foot.hd * along,
      z = p.z + Math.cos(p.yaw) * 2 * foot.hd * along;
    const top = p.y + p.rise * along + p.scale * (trunk ? 0.5 : p.kind === 'stump' ? 0.65 : 0.98);
    physics.addBox(
      group,
      { x: x - foot.hw, y: p.y - Math.abs(p.rise) - p.scale, z: z - foot.hd / count },
      { x: x + foot.hw, y: top, z: z + foot.hd / count },
      { tag: 'ground-prop' },
      p.yaw,
    );
  }
}
