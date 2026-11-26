// A fractured outcrop. The pigment is a thin mineral inclusion inside the rock:
// neighbouring layers share vertices along the seam, even where it almost pinches out.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, type GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Rng } from '@/world/math/rng';
import type { Wilderness } from '@/world/wilderness/generator';
import type { PigmentSource } from '@/world/wilderness/sources';

/** Slice each face with the same crooked geological plane. The resulting triangles tile
 * the original face exactly, including the exposed crown and the corners between faces. */
function fracturedStone(g: GeometryBuilder, matrix: THREE.Matrix4, pigment: number, rng: Rng): void {
  const host: number[] = [],
    mineral: number[] = [];
  const bands = [
    { low: -Infinity, high: -1, vertices: host },
    { low: -1, high: 1, vertices: mineral },
    { low: 1, high: Infinity, vertices: host },
  ];
  const slices = rng.int(7, 9);
  const offset = rng.range(-0.25, 0.25),
    dip = rng.range(0.18, 0.53);
  const value = (p: THREE.Vector3) =>
    (p.x + 0.46 * p.z + dip * p.y - offset + 0.13 * Math.sin(7 * p.z + 2 * p.y) + 0.07 * Math.sin(6 * p.y)) /
    (0.013 + 0.065 * (0.5 + 0.5 * Math.sin(4 * p.z + 3 * p.y)));
  type Corner = { p: THREE.Vector3; v: number };
  const corner = (p: THREE.Vector3): Corner => ({ p, v: value(p) });
  function clip(poly: Corner[], limit: number, above: boolean): Corner[] {
    const inside = (p: Corner) => (above ? p.v >= limit : p.v <= limit);
    const out: Corner[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!,
        b = poly[(i + 1) % poly.length]!;
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b))
        out.push({ p: a.p.clone().lerp(b.p, (limit - a.v) / (b.v - a.v)), v: limit });
    }
    return out;
  }
  function face(a: Corner, b: Corner, c: Corner): void {
    for (const band of bands) {
      const poly = clip(clip([a, b, c], band.low, true), band.high, false);
      for (let j = 1; j + 1 < poly.length; j++)
        for (const i of [0, j, j + 1]) {
          const p = poly[i]!.p;
          band.vertices.push(p.x, p.y, p.z);
        }
    }
  }
  const columns: Corner[][] = [];
  const crown = corner(new THREE.Vector3(-0.28, 1.09, 0.1));
  for (let i = 0; i < slices; i++) {
    const angle = ((i + rng.range(-0.19, 0.19)) * Math.PI * 2) / slices;
    const radius = rng.range(0.84, 1.1),
      x = radius * Math.cos(angle),
      z = radius * Math.sin(angle);
    const shelf = rng.range(0.72, 1.06);
    columns.push([
      corner(new THREE.Vector3(x * 0.91, -0.3, z * 0.91)),
      corner(new THREE.Vector3(x, 0.25 + 0.16 * z + rng.range(-0.08, 0.13), z)),
      corner(
        new THREE.Vector3(x * shelf - 0.08, 0.8 - 0.25 * x + 0.13 * z + rng.range(-0.16, 0.15), z * shelf),
      ),
      corner(new THREE.Vector3(x * 0.55 - 0.18, 0.98 - 0.19 * x + rng.range(-0.09, 0.08), z * 0.58)),
    ]);
  }
  for (let i = 0; i < slices; i++) {
    const a = columns[i]!,
      b = columns[(i + 1) % slices]!;
    for (let j = 0; j < a.length - 1; j++) {
      face(a[j]!, a[j + 1]!, b[j]!);
      face(a[j + 1]!, b[j + 1]!, b[j]!);
    }
    face(a[3]!, crown, b[3]!);
    if (i > 0 && i < slices - 1) face(columns[0]![0]!, a[0]!, b[0]!);
  }
  for (const [vertices, tint] of [
    [host, color('rock')],
    [mineral, pigment],
  ] as const) {
    const geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    g.mesh(geometry, matrix, tint, ALWAYS_COLOR);
    geometry.dispose();
  }
}

export function addPigmentOre(
  g: GeometryBuilder,
  src: PigmentSource,
  ground: Wilderness['heightAt'],
  rng: Rng,
): void {
  const yaw = rng.range(0, Math.PI * 2);
  const matrix = new THREE.Matrix4(),
    q = new THREE.Quaternion();
  // One high broken face, two lower shoulders and a loose fragment. Each is seated
  // on the actual slope; the long axes follow the same bed of rock.
  for (const [dx, dz, hw, h, hd] of [
    [-0.32, 0, 1.12, 1.38, 0.85],
    [0.96, 0.04, 0.84, 0.76, 0.65],
    [-0.67, 0.82, 0.74, 0.48, 0.5],
    [1.35, -0.76, 0.4, 0.31, 0.34],
  ] as const) {
    const x = src.x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
      z = src.z - dx * Math.sin(yaw) + dz * Math.cos(yaw);
    q.setFromEuler(
      new THREE.Euler(rng.range(-0.08, 0.08), yaw + rng.range(-0.22, 0.22), rng.range(-0.12, 0.02), 'YXZ'),
    );
    matrix.compose(new THREE.Vector3(x, ground(x, z) + 0.035, z), q, new THREE.Vector3(hw, h, hd));
    fracturedStone(g, matrix, src.color, rng);
  }
}
