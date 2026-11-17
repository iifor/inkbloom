// Hot springs and summit lookouts as chunk geometry (see world/wilderness/landmarks.ts for
// where they stand). A spring is a still pool in a low stone basin, ringed with rocks; its
// steam, warmth and bubbling come from the atmosphere and ambience systems. A lookout is a
// cairn of stacked stones with a pole and a cloth flag, visible from the next hill over.
import * as THREE from 'three';
import { color } from '@/content/palette';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Vec3Like } from '@/engine/physics/world';
import type { WildChunk } from '@/world/wilderness/chunk';
import type { Wilderness } from '@/world/wilderness/generator';
import { type Lookout, type Spring, springLevel } from '@/world/wilderness/landmarks';

const ROCK = new THREE.IcosahedronGeometry(1, 0);
/** Segments round a pool's rim. */
const RIM = 20;

/** 0..1 from a seed and a salt: each rock its own size and turn. */
const roll = (seed: number, k: number): number => {
  const h = Math.sin(seed * 0.001 + k * 12.9898) * 43758.5453;
  return h - Math.floor(h);
};

function appendSpring(s: Spring, w: Wilderness, g: GeometryBuilder): void {
  const level = springLevel(s, w);
  const water = color('water');
  const stone = color('rock');
  const up = { x: 0, y: 1, z: 0 };
  const rim = (k: number): { x: number; z: number } => ({
    x: s.x + Math.cos((k / RIM) * Math.PI * 2) * s.r,
    z: s.z + Math.sin((k / RIM) * Math.PI * 2) * s.r,
  });
  for (let k = 0; k < RIM; k++) {
    const a = rim(k);
    const b = rim(k + 1);
    // the water: a fan from the middle (a degenerate quad per wedge), counter-clockwise from above
    g.quad(
      { x: s.x, y: level, z: s.z },
      { x: b.x, y: level, z: b.z },
      { x: a.x, y: level, z: a.z },
      { x: s.x, y: level, z: s.z },
      up,
      water,
    );
    // the basin wall, down from the water's edge to the ground, facing out
    const out = {
      x: Math.cos(((k + 0.5) / RIM) * Math.PI * 2),
      y: 0,
      z: Math.sin(((k + 0.5) / RIM) * Math.PI * 2),
    };
    g.quad(
      { x: a.x, y: level + 0.12, z: a.z },
      { x: b.x, y: level + 0.12, z: b.z },
      { x: b.x, y: w.heightAt(b.x, b.z) - 0.2, z: b.z },
      { x: a.x, y: w.heightAt(a.x, a.z) - 0.2, z: a.z },
      out,
      stone,
    );
  }
  // a ring of rocks, big and small, round the rim
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const count = 12 + Math.floor(roll(s.seed, 0) * 6);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + roll(s.seed, i + 1) * 0.3;
    const size = 0.35 + roll(s.seed, i + 40) * 0.6;
    const x = s.x + Math.cos(a) * (s.r + size * 0.4);
    const z = s.z + Math.sin(a) * (s.r + size * 0.4);
    q.setFromEuler(new THREE.Euler(roll(s.seed, i + 80), roll(s.seed, i + 90) * 6, 0));
    m.compose(
      new THREE.Vector3(x, Math.min(w.heightAt(x, z), level) + size * 0.25, z),
      q,
      new THREE.Vector3(size * 1.3, size * 0.75, size),
    );
    g.meshSmooth(ROCK, m, stone);
  }
}

function appendLookout(l: Lookout, w: Wilderness, g: GeometryBuilder): void {
  const stone = color('rock');
  const wood = color('bark');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  // a cairn: flat stones stacked, smaller toward the top
  let y = w.heightAt(l.x, l.z) - 0.1;
  for (let i = 0; i < 6; i++) {
    const size = 0.85 - i * 0.11;
    const h = size * 0.42;
    q.setFromEuler(new THREE.Euler(0, roll(l.seed, i) * 6, (roll(l.seed, i + 10) - 0.5) * 0.15));
    const off = (roll(l.seed, i + 20) - 0.5) * 0.12;
    m.compose(new THREE.Vector3(l.x + off, y + h, l.z - off), q, new THREE.Vector3(size, h, size * 0.9));
    g.meshSmooth(ROCK, m, stone);
    y += h * 1.7;
  }
  // a pole out of the top, with a cloth flag
  const top = y + 1.6;
  g.box(
    { x: l.x - 0.05, y: y - 0.3, z: l.z - 0.05 },
    { x: l.x + 0.05, y: top, z: l.z + 0.05 },
    { px: wood, nx: wood, pz: wood, nz: wood, py: wood },
  );
  const flag = { px: l.flag, nx: l.flag, py: l.flag, ny: l.flag, pz: l.flag, nz: l.flag };
  g.box(
    { x: l.x + 0.05, y: top - 0.55, z: l.z - 0.015 },
    { x: l.x + 0.95, y: top - 0.05, z: l.z + 0.015 },
    flag,
  );
}

/** The chunk's hot springs and lookouts, laid onto `g`. */
export function appendLandmarks(chunk: WildChunk, w: Wilderness, g: GeometryBuilder): void {
  for (const s of chunk.springs) appendSpring(s, w, g);
  for (const l of chunk.lookouts) appendLookout(l, w, g);
}

/** Colliders: a lookout's cairn is solid; a spring's pool can be waded into. */
export function addLandmarkColliders(
  chunk: WildChunk,
  physics: { addBox(group: string, min: Vec3Like, max: Vec3Like): unknown },
  group: string,
): void {
  for (const l of chunk.lookouts)
    physics.addBox(
      group,
      { x: l.x - 0.75, y: l.y - 0.2, z: l.z - 0.75 },
      { x: l.x + 0.75, y: l.y + 2, z: l.z + 0.75 },
    );
}
