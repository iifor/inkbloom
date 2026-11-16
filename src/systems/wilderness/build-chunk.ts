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
const crownShape = makeCrown();

/**
 * A tree crown like a painted one: a few overlapping lumps of leaves shaded as one soft mass.
 * Each lump is a smooth sphere, but its normals lean out from the crown's centre, so light
 * falls across the whole crown (bright top, cool underside) instead of lump by lump.
 */
function makeCrown(): THREE.BufferGeometry {
  const lumps: [number, number, number, number, number][] = [
    // x, y, z, radius, detail
    [0, 0, 0, 1, 1],
    [0.55, 0.22, 0.25, 0.72, 0],
    [-0.5, 0.18, -0.3, 0.7, 0],
    [0.05, 0.62, -0.12, 0.62, 0],
    [-0.2, -0.28, 0.52, 0.6, 0],
  ];
  const parts: { pos: number[]; nor: number[] } = { pos: [], nor: [] };
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
      // a little lumpiness so the outline is not perfectly round
      const k = 1 + 0.08 * Math.sin(v.x * 7.1 + v.y * 5.3 + v.z * 3.7 + x * 11);
      v.multiplyScalar(k).add(c);
      out.copy(v).normalize();
      n.lerp(out, 0.65).normalize();
      parts.pos.push(v.x, v.y, v.z);
      parts.nor.push(n.x, n.y, n.z);
    }
    flat.dispose();
    g.dispose();
  }
  const crown = new THREE.BufferGeometry();
  crown.setAttribute('position', new THREE.Float32BufferAttribute(parts.pos, 3));
  crown.setAttribute('normal', new THREE.Float32BufferAttribute(parts.nor, 3));
  return crown;
}

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
      const biome = BIOMES[biomes[cz * n + cx]!]!;
      const rise = Math.max(Math.abs(H(i + 1, k) - H(i, k)), Math.abs(H(i, k + 1) - H(i, k))) / MESH_STEP;
      const colour = rise > STEEP ? biome.cliff : biome.ground;
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
    const trunk = 0.25;
    g.box(
      { x: t.x - trunk, y: t.y, z: t.z - trunk },
      { x: t.x + trunk, y: t.y + t.height * 0.6, z: t.z + trunk },
      { px: bark, nx: bark, pz: bark, nz: bark },
    );
    m.compose(
      new THREE.Vector3(t.x, t.y + t.height * 0.62 + t.crown * 0.6, t.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.x * 0.37, 0)),
      new THREE.Vector3(t.crown, t.crown * 1.25, t.crown),
    );
    g.meshSmooth(crownShape, m, t.color);
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
