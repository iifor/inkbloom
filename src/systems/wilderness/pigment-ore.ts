// An ore vein: a broken boulder with a seam of the pigment running across it and a cluster of
// six-sided crystals breaking out of the seam, with a stone or two fallen beside it. Faceted
// like the hot-spring rocks (build-landmarks.ts), so the light lies on it in flat planes the
// way a painter blocks in stone, instead of rolling smoothly round a lump.
import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, type GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Rng } from '@/world/math/rng';
import type { Wilderness } from '@/world/wilderness/generator';
import type { PigmentSource } from '@/world/wilderness/sources';

const rock = color('rock');
const up = new THREE.Vector3(0, 1, 0);
// a crystal: a hexagonal prism narrowing a little, under a six-sided point; base at y 0,
// shoulder at y 1
const prism = new THREE.CylinderGeometry(0.82, 1, 1, 6, 1, true).translate(0, 0.5, 0);
const point = new THREE.ConeGeometry(0.82, 0.55, 6, 1, true).translate(0, 1.275, 0);

/** A broken stone about one unit across: a ball cut down by a handful of cleavage planes, so
 * it has broad flat faces meeting at edges, like stone split along its grain, and a little
 * roughness on top. Non-indexed, so each face keeps its own flat normal; a corner moves the
 * same way in every face that shares it, so the stone stays closed. */
function boulder(rng: Rng, detail: number, cuts: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const planes = Array.from({ length: cuts }, (_, i) => ({
    // spread round the stone, with one always taking off the underside
    n:
      i === 0
        ? new THREE.Vector3(rng.range(-0.15, 0.15), -1, rng.range(-0.15, 0.15)).normalize()
        : new THREE.Vector3(rng.range(-1, 1), rng.range(-0.6, 1), rng.range(-1, 1)).normalize(),
    d: i === 0 ? 0.55 : rng.range(0.62, 0.86),
  }));
  const p = g.getAttribute('position');
  const seed = rng.range(0, 100);
  const v = new THREE.Vector3();
  // rounded first: each face works out its corners itself, a hair apart
  const k = (x: number): number => Math.round(x * 1000) / 1000;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    // out along this direction until the first cut
    let r = 1;
    for (const pl of planes) {
      const along = v.dot(pl.n);
      if (along > 0.01) r = Math.min(r, pl.d / along);
    }
    const h = Math.sin(k(v.x) * 12.9898 + k(v.y) * 78.233 + k(v.z) * 37.719 + seed) * 43758.5453;
    r *= 0.985 + 0.03 * (h - Math.floor(h));
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  return g;
}

/** Splits a stone's faces into rock and seam by a band either side of a plane through it. */
function splitSeam(
  stone: THREE.BufferGeometry,
  normal: THREE.Vector3,
  offset: number,
  width: number,
): { rock: THREE.BufferGeometry; seam: THREE.BufferGeometry } {
  const p = stone.getAttribute('position');
  const rockPos: number[] = [];
  const seamPos: number[] = [];
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(p, i + k));
    c.divideScalar(3);
    const out = Math.abs(c.dot(normal) - offset) < width ? seamPos : rockPos;
    for (let k = 0; k < 3; k++) out.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
  }
  const geometry = (pos: number[]): THREE.BufferGeometry =>
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return { rock: geometry(rockPos), seam: geometry(seamPos) };
}

export function addPigmentOre(g: GeometryBuilder, src: PigmentSource, ground: Wilderness['heightAt'], rng: Rng): void {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yaw = rng.next() * Math.PI * 2;

  // the boulder, seated in the slope
  const size = new THREE.Vector3(1.45, 1.0, 1.2).multiplyScalar(rng.range(0.9, 1.1));
  const at = new THREE.Vector3(src.x, ground(src.x, src.z) + size.y * 0.42, src.z);
  q.setFromEuler(new THREE.Euler(rng.range(-0.12, 0.12), yaw, rng.range(-0.12, 0.12)));
  m.compose(at, q, size);
  const stone = boulder(rng, 3, 12);
  // the seam runs slantwise round the stone, like a stratum
  const tilt = rng.range(0.85, 1.2);
  const across = rng.range(0, Math.PI * 2);
  const seamNormal = new THREE.Vector3(Math.cos(across) * Math.cos(tilt), Math.sin(tilt), Math.sin(across) * Math.cos(tilt));
  const { rock: body, seam } = splitSeam(stone, seamNormal, rng.range(-0.15, 0.2), 0.11);
  g.mesh(body, m, rock, ALWAYS_COLOR);
  g.mesh(seam, m, src.color, ALWAYS_COLOR);

  // crystals break out of the seam's upper faces, leaning out from the stone
  const sp = seam.getAttribute('position');
  const sites: { pos: THREE.Vector3; out: THREE.Vector3 }[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < sp.count; i += 3) {
    a.fromBufferAttribute(sp, i).applyMatrix4(m);
    b.fromBufferAttribute(sp, i + 1).applyMatrix4(m);
    c.fromBufferAttribute(sp, i + 2).applyMatrix4(m);
    const out = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    if (out.y > 0.05) sites.push({ pos: a.clone().add(b).add(c).divideScalar(3), out });
  }
  sites.sort((s, t) => t.pos.y - s.pos.y);
  const count = Math.min(sites.length, rng.int(5, 7));
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // most from the top of the seam, a few further down it
    const site = sites[i < 3 ? i : rng.int(3, sites.length - 1)]!;
    dir
      .copy(site.out)
      .multiplyScalar(0.7)
      .addScaledVector(up, 0.55)
      .add(new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)))
      .normalize();
    const big = i < 3;
    const length = big ? rng.range(0.5, 0.85) : rng.range(0.25, 0.45);
    const radius = length * rng.range(0.2, 0.28);
    // the root sunk into the stone
    const base = site.pos.clone().addScaledVector(dir, -0.18);
    q.setFromUnitVectors(up, dir).multiply(new THREE.Quaternion().setFromAxisAngle(up, rng.next() * Math.PI));
    m.compose(base, q, new THREE.Vector3(radius, length, radius));
    g.mesh(prism, m, src.color, ALWAYS_COLOR);
    g.mesh(point, m, src.color, ALWAYS_COLOR);
  }

  // a stone or two broken off and lying beside it
  const fallen = rng.int(1, 2);
  for (let i = 0; i < fallen; i++) {
    const turn = yaw + rng.range(-1.2, 1.2) + i * Math.PI;
    const s = rng.range(0.35, 0.6);
    const x = src.x + Math.cos(turn) * (1.25 + s * 0.5);
    const z = src.z + Math.sin(turn) * (1.15 + s * 0.5);
    q.setFromEuler(new THREE.Euler(rng.range(-0.4, 0.4), rng.next() * 6, rng.range(-0.4, 0.4)));
    m.compose(new THREE.Vector3(x, ground(x, z) + s * 0.3, z), q, new THREE.Vector3(s * 1.2, s * 0.8, s));
    const chip = boulder(rng, 1, 6);
    // the seam carries on through what broke off
    const parts = splitSeam(chip, seamNormal, rng.range(-0.3, 0.3), 0.16);
    g.mesh(parts.rock, m, rock, ALWAYS_COLOR);
    g.mesh(parts.seam, m, src.color, ALWAYS_COLOR);
    for (const part of [chip, parts.rock, parts.seam]) part.dispose();
  }
  stone.dispose();
  body.dispose();
  seam.dispose();
}
