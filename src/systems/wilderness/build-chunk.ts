// WildChunk data -> one mesh and a set of colliders. Terrain is terraced columns: a top quad
// per cell, a side wall wherever a neighbour is lower, and one collider per run of equal
// height along each row.
import * as THREE from 'three';
import { BIOMES } from '@/content/biomes';
import { color } from '@/content/palette';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';

const FLOOR = -40;
const crownShape = new THREE.IcosahedronGeometry(1, 0);

export function buildChunkGeometry(
  chunk: WildChunk,
  w: Wilderness,
  g = new GeometryBuilder(),
): GeometryBuilder {
  const { n, cell, heights, biomes, x0, z0 } = chunk;
  const h = (ix: number, iz: number): number =>
    ix >= 0 && iz >= 0 && ix < n && iz < n
      ? heights[iz * n + ix]!
      : w.heightAt(x0 + (ix + 0.5) * cell, z0 + (iz + 0.5) * cell);

  for (let iz = 0; iz < n; iz++)
    for (let ix = 0; ix < n; ix++) {
      const y = heights[iz * n + ix]!;
      const biome = BIOMES[biomes[iz * n + ix]!]!;
      const ax = x0 + ix * cell;
      const az = z0 + iz * cell;
      const bx = ax + cell;
      const bz = az + cell;
      g.quad(
        { x: ax, y, z: bz },
        { x: bx, y, z: bz },
        { x: bx, y, z: az },
        { x: ax, y, z: az },
        { x: 0, y: 1, z: 0 },
        biome.ground,
      );
      // sides towards lower neighbours
      const e = h(ix + 1, iz);
      if (e < y)
        g.quad(
          { x: bx, y: e, z: bz },
          { x: bx, y: e, z: az },
          { x: bx, y, z: az },
          { x: bx, y, z: bz },
          { x: 1, y: 0, z: 0 },
          biome.cliff,
        );
      const wv = h(ix - 1, iz);
      if (wv < y)
        g.quad(
          { x: ax, y: wv, z: az },
          { x: ax, y: wv, z: bz },
          { x: ax, y, z: bz },
          { x: ax, y, z: az },
          { x: -1, y: 0, z: 0 },
          biome.cliff,
        );
      const s = h(ix, iz + 1);
      if (s < y)
        g.quad(
          { x: ax, y: s, z: bz },
          { x: bx, y: s, z: bz },
          { x: bx, y, z: bz },
          { x: ax, y, z: bz },
          { x: 0, y: 0, z: 1 },
          biome.cliff,
        );
      const nv = h(ix, iz - 1);
      if (nv < y)
        g.quad(
          { x: bx, y: nv, z: az },
          { x: ax, y: nv, z: az },
          { x: ax, y, z: az },
          { x: bx, y, z: az },
          { x: 0, y: 0, z: -1 },
          biome.cliff,
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
    g.mesh(crownShape, m, t.color);
  }
  return g;
}

export function addChunkColliders(chunk: WildChunk, physics: PhysicsWorld, group: string): void {
  const { n, cell, heights, x0, z0 } = chunk;
  for (let iz = 0; iz < n; iz++) {
    let start = 0;
    for (let ix = 1; ix <= n; ix++) {
      const prev = heights[iz * n + ix - 1]!;
      if (ix < n && heights[iz * n + ix] === prev) continue;
      physics.addBox(
        group,
        { x: x0 + start * cell, y: FLOOR, z: z0 + iz * cell },
        { x: x0 + ix * cell, y: prev, z: z0 + (iz + 1) * cell },
      );
      start = ix;
    }
  }
  for (const t of chunk.trees)
    physics.addBox(
      group,
      { x: t.x - 0.3, y: t.y, z: t.z - 0.3 },
      { x: t.x + 0.3, y: t.y + t.height * 0.6, z: t.z + 0.3 },
    );
}
