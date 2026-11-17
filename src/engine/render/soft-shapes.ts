// Small soft shapes for things that would otherwise be a cylinder or an icosahedron. The world
// is painted with smooth normals and no outlines, and a faceted shape under the brush filter
// turns into broken shards (docs/game-design.md 11.1), so these are rounded and a little
// irregular, like something painted by hand. Each returns an indexed geometry with smooth
// normals, for GeometryBuilder.meshSmooth.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '@/world/math/rng';

/** A dome over an outline that wanders around radius `r` (rim at y 0, top at `h`). */
function dome(
  pos: number[],
  index: number[],
  cx: number,
  cz: number,
  radius: (a: number) => number,
  h: number,
  steps: number,
): void {
  const centre = pos.length / 3;
  pos.push(cx, h, cz);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = radius(a);
    // a flat top that rolls over into the rim, a little below the ground at its edge
    pos.push(cx + Math.cos(a) * r * 0.7, h, cz + Math.sin(a) * r * 0.7);
    pos.push(cx + Math.cos(a) * r * 0.93, h * 0.62, cz + Math.sin(a) * r * 0.93);
    pos.push(cx + Math.cos(a) * r, -h * 0.25, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < steps; i++) {
    const a = centre + 1 + i * 3;
    const b = centre + 1 + ((i + 1) % steps) * 3;
    index.push(centre, b, a);
    for (let k = 0; k < 2; k++) index.push(a + k, b + k, b + k + 1, a + k, b + k + 1, a + k + 1);
  }
}

function geometry(pos: number[], index: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A splash of wet ink about one unit across, `h` thick: a lobed pool and a few droplets
 * thrown off around it. Turn each copy (or pick another seed) so no two look alike. */
export function splatGeometry(seed: number, h = 0.04): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const index: number[] = [];
  const lobes = [2, 3, 5, 7].map((k) => ({ k, a: rng.range(0, Math.PI * 2), amp: rng.range(0.05, 0.14) }));
  const outline = (a: number): number =>
    0.86 + lobes.reduce((s, l) => s + l.amp * Math.sin(l.k * a + l.a), 0);
  dome(pos, index, 0, 0, outline, h, 40);
  const drops = 3 + Math.floor(rng.next() * 3);
  for (let i = 0; i < drops; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = outline(a) + rng.range(0.12, 0.38);
    const r = rng.range(0.05, 0.12);
    dome(pos, index, Math.cos(a) * d, Math.sin(a) * d, () => r, h * 0.8, 12);
  }
  return geometry(pos, index);
}

/** A rounded stone about one unit across, gently lumpy rather than faceted. */
export function lumpGeometry(seed: number, rough = 0.16): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const bumps = Array.from({ length: 5 }, () =>
    new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize(),
  );
  const weights = bumps.map(() => rng.range(-1, 1));
  // one vertex per point (no seam), so the computed normals run smoothly all the way round
  const sphere = new THREE.SphereGeometry(1, 18, 12);
  sphere.deleteAttribute('normal');
  sphere.deleteAttribute('uv');
  const g = mergeVertices(sphere);
  sphere.dispose();
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    // broad swellings, each fading out over half the stone, so the form stays smooth
    let r = 1;
    bumps.forEach((b, k) => (r += rough * weights[k]! * Math.max(0, n.dot(b)) ** 2));
    // a stone sits on its flatter underside
    if (n.y < -0.3) r *= 1 - (-0.3 - n.y) * 0.35;
    p.setXYZ(i, n.x * r, n.y * r, n.z * r);
  }
  g.computeVertexNormals();
  return g;
}

/** A drop of paint about one unit across, round at the bottom and drawn to a soft point at the
 * top (+y). */
export function dropGeometry(): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    // a circle for the lower part, easing into a point
    const a = Math.PI * t;
    const r = Math.sin(a) * (1 - 0.55 * t * t);
    profile.push(new THREE.Vector2(r * 0.5, -Math.cos(a) * 0.5 * (1 + 0.5 * t)));
  }
  return new THREE.LatheGeometry(profile, 10);
}
