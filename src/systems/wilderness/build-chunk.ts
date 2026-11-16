// WildChunk data -> one mesh and its colliders. The ground is a smooth heightfield sampled
// every MESH_STEP metres with normals from the height function, so hills shade as one soft
// surface; steep ground shows the biome's slope colour. The ground needs no colliders: the
// wild physics world stands bodies on the same height function. Trees get trunk colliders.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BIOMES } from '@/content/biomes';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';

/** Metres between terrain mesh vertices. */
const MESH_STEP = 2;
/** Ground steeper than this (rise over run) shows the biome's slope colour. */
const STEEP = 0.75;
type Lump = [x: number, y: number, z: number, radius: number, detail: number];

/** A broad leafy crown: a heap of clumps, wider than tall, a little flat underneath. */
const BROADLEAF: readonly Lump[] = [
  [0, 0, 0, 1, 1],
  [0.62, 0.12, 0.3, 0.74, 1],
  [-0.58, 0.1, -0.28, 0.72, 0],
  [0.1, 0.62, -0.15, 0.66, 0],
  [-0.28, -0.22, 0.58, 0.62, 0],
  [0.35, -0.18, -0.6, 0.6, 0],
  [-0.4, 0.5, 0.35, 0.55, 0],
];

/** A tall cedar: clumps stacked up the trunk, narrowing to a point. */
const CEDAR: readonly Lump[] = [
  [0, 0, 0, 1, 1],
  [0.12, 0.85, -0.08, 0.84, 1],
  [-0.08, 1.6, 0.06, 0.68, 0],
  [0.06, 2.25, 0, 0.5, 0],
  [0, 2.75, 0.04, 0.32, 0],
];

const broadleaf = makeCrown(BROADLEAF);
const cedar = makeCrown(CEDAR);

/**
 * A tree crown like a painted one: overlapping clumps of leaves shaded as one soft mass. Each
 * clump is a smooth sphere, but its normals lean out from the crown's own axis, so light falls
 * across the whole crown (bright top, cool underside) instead of clump by clump.
 */
function makeCrown(lumps: readonly Lump[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (const [x, y, z, r, detail] of lumps) {
    const g = mergeVertices(new THREE.IcosahedronGeometry(r, detail));
    g.computeVertexNormals();
    c.set(x, y, z);
    const flat = g.toNonIndexed();
    const fp = flat.getAttribute('position');
    const fn = flat.getAttribute('normal');
    for (let i = 0; i < fp.count; i++) {
      v.fromBufferAttribute(fp, i);
      n.fromBufferAttribute(fn, i);
      // lumpy, so the outline is not a row of perfect balls
      const k = 1 + 0.1 * Math.sin(v.x * 7.1 + v.y * 5.3 + v.z * 3.7 + x * 11 + y * 5);
      v.multiplyScalar(k).add(c);
      // out from the crown's axis at this clump's height (one mass, also for a tall cedar)
      out.set(v.x, v.y - y * 0.85, v.z).normalize();
      n.lerp(out, 0.65).normalize();
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
    }
    flat.dispose();
    g.dispose();
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  crown.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return crown;
}

/** 0..1 from a tree's position: picks its species without touching generation or saves. */
const treeRoll = (x: number, z: number): number => {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
};
/** Share of cedars among the trees of the dark forest colour, and among the rest. */
const CEDAR_SHARE = { forest: 0.4, other: 0.12 };

export function buildChunkGeometry(
  chunk: WildChunk,
  w: Wilderness,
  g = new GeometryBuilder(),
): GeometryBuilder {
  const { n, cell, biomes, x0, z0 } = chunk;
  const size = n * cell;
  const steps = Math.round(size / MESH_STEP);
  // heights at the grid corners, one ring wider so edge normals match the next chunk's
  const side = steps + 3;
  const hs = new Float32Array(side * side);
  for (let k = 0; k < side; k++)
    for (let i = 0; i < side; i++)
      hs[k * side + i] = w.heightAt(x0 + (i - 1) * MESH_STEP, z0 + (k - 1) * MESH_STEP);
  const H = (i: number, k: number): number => hs[(k + 1) * side + (i + 1)]!;
  const normalAt = (i: number, k: number): THREE.Vector3 =>
    new THREE.Vector3(H(i - 1, k) - H(i + 1, k), 2 * MESH_STEP, H(i, k - 1) - H(i, k + 1)).normalize();
  const normals: THREE.Vector3[] = [];
  for (let k = 0; k <= steps; k++) for (let i = 0; i <= steps; i++) normals.push(normalAt(i, k));
  const N = (i: number, k: number): THREE.Vector3 => normals[k * (steps + 1) + i]!;
  const P = (i: number, k: number): THREE.Vector3Like => ({
    x: x0 + i * MESH_STEP,
    y: H(i, k),
    z: z0 + k * MESH_STEP,
  });
  for (let k = 0; k < steps; k++)
    for (let i = 0; i < steps; i++) {
      const cx = Math.min(n - 1, Math.floor(((i + 0.5) * MESH_STEP) / cell));
      const cz = Math.min(n - 1, Math.floor(((k + 0.5) * MESH_STEP) / cell));
      // meadow ground shows rock on steep slopes in the shader, with a painted edge; other
      // ground (sand) switches colour per square here
      const biome = BIOMES[biomes[cz * n + cx]!]!;
      const rise = Math.max(Math.abs(H(i + 1, k) - H(i, k)), Math.abs(H(i, k + 1) - H(i, k))) / MESH_STEP;
      const colour = rise > STEEP && biome.ground !== color('grass') ? biome.cliff : biome.ground;
      // counter-clockwise seen from above
      g.quadSmooth(
        P(i, k + 1),
        P(i + 1, k + 1),
        P(i + 1, k),
        P(i, k),
        [N(i, k + 1), N(i + 1, k + 1), N(i + 1, k), N(i, k)],
        colour,
      );
    }

  if (chunk.hasWater) {
    const s = n * cell;
    const y = WATER_LEVEL;
    g.quad(
      { x: x0, y, z: z0 + s },
      { x: x0 + s, y, z: z0 + s },
      { x: x0 + s, y, z: z0 },
      { x: x0, y, z: z0 },
      { x: 0, y: 1, z: 0 },
      color('water'),
    );
  }

  const m = new THREE.Matrix4();
  const bark = color('bark');
  for (const t of chunk.trees) {
    const roll = treeRoll(t.x, t.z);
    const isCedar = roll < (t.color === color('canopy') ? CEDAR_SHARE.forest : CEDAR_SHARE.other);
    const trunk = isCedar ? 0.3 : 0.25;
    const trunkTop = t.height * (isCedar ? 0.45 : 0.6);
    g.box(
      { x: t.x - trunk, y: t.y, z: t.z - trunk },
      { x: t.x + trunk, y: t.y + trunkTop, z: t.z + trunk },
      { px: bark, nx: bark, pz: bark, nz: bark },
    );
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, roll * Math.PI * 2, 0));
    if (isCedar) {
      const r = t.crown * 0.8;
      m.compose(
        new THREE.Vector3(t.x, t.y + trunkTop + r * 0.5, t.z),
        spin,
        new THREE.Vector3(r, r * 1.35, r),
      );
      // evergreen: cedars keep their colour through the year, broadleaf crowns turn
      g.meshSmooth(cedar, m, color('cedar'));
    } else {
      // some crowns spread wide, some stand rounder
      const wide = 0.9 + 0.35 * treeRoll(t.z, t.x);
      m.compose(
        new THREE.Vector3(t.x, t.y + trunkTop + t.crown * 0.55, t.z),
        spin,
        new THREE.Vector3(t.crown * wide, t.crown * 1.05, t.crown * wide),
      );
      g.meshSmooth(broadleaf, m, t.color);
    }
  }
  return g;
}

export function addChunkColliders(chunk: WildChunk, physics: PhysicsWorld, group: string): void {
  for (const t of chunk.trees)
    physics.addBox(
      group,
      { x: t.x - 0.3, y: t.y, z: t.z - 0.3 },
      { x: t.x + 0.3, y: t.y + t.height * 0.6, z: t.z + 0.3 },
    );
}
