// WildChunk data -> one mesh and its colliders. The ground is a smooth heightfield sampled
// every MESH_STEP metres with normals from the height function, so hills shade as one soft
// surface; steep ground shows the biome's slope colour. The ground needs no colliders: the
// wild physics world stands bodies on the same height function. Trees get trunk colliders.
import * as THREE from 'three';
import { appendTree, treeMatrix, treePalette } from './tree-geometry';
import { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { WildChunk } from '@/world/wilderness/chunk';
import { riverbedMeadow, type Wilderness } from '@/world/wilderness/generator';

/** Metres between terrain mesh vertices. */
const MESH_STEP = 2;
export function buildChunkGeometry(
  chunk: WildChunk,
  w: Wilderness,
  g = new GeometryBuilder(),
): GeometryBuilder {
  const steps = buildChunkSteps(chunk, w, g);
  while (!steps.next().done);
  return g;
}

/** Rows of terrain (or trees) built between pauses when a chunk is built a little per frame. */
const ROWS_PER_STEP = 12;

/**
 * The same work as buildChunkGeometry, pausing (yield) every few rows, so a chunk streamed in
 * while walking can be built over several frames instead of stalling one.
 */
export function* buildChunkSteps(
  chunk: WildChunk,
  w: Wilderness,
  g: GeometryBuilder,
): Generator<void, void, void> {
  yield* buildTerrainSteps(chunk, w, g);
  for (const [i, tree] of chunk.trees.entries()) {
    if (i > 0 && i % (ROWS_PER_STEP * 2) === 0) yield;
    appendTree(g, treePalette(tree), treeMatrix(tree), false);
  }
}

/** The live scene batches trees separately so it can switch their geometry by distance. */
export function* buildTerrainSteps(
  chunk: WildChunk,
  w: Wilderness,
  g: GeometryBuilder,
): Generator<void, void, void> {
  const { n, cell, x0, z0 } = chunk;
  const size = n * cell;
  const steps = Math.round(size / MESH_STEP);
  // heights at the grid corners, one ring wider so edge normals match the next chunk's
  const side = steps + 3;
  const hs = new Float32Array(side * side);
  for (let k = 0; k < side; k++) {
    for (let i = 0; i < side; i++)
      hs[k * side + i] = w.heightAt(x0 + (i - 1) * MESH_STEP, z0 + (k - 1) * MESH_STEP);
    if (k % ROWS_PER_STEP === ROWS_PER_STEP - 1) yield;
  }
  const H = (i: number, k: number): number => hs[(k + 1) * side + (i + 1)]!;
  const normalAt = (i: number, k: number): THREE.Vector3 =>
    new THREE.Vector3(H(i - 1, k) - H(i + 1, k), 2 * MESH_STEP, H(i, k - 1) - H(i, k + 1)).normalize();
  const normals: THREE.Vector3[] = [];
  for (let k = 0; k <= steps; k++) for (let i = 0; i <= steps; i++) normals.push(normalAt(i, k));
  const N = (i: number, k: number): THREE.Vector3 => normals[k * (steps + 1) + i]!;
  // Negative colour codes carry the continuous riverbed mask to the terrain paint pass.
  // The climate field changes over hundreds of metres; its samples span the full chunk edge.
  const soil = new Float32Array((n + 1) ** 2);
  for (let k = 0; k <= n; k++)
    for (let i = 0; i <= n; i++)
      soil[k * (n + 1) + i] = -1 - riverbedMeadow(w.climate(x0 + i * cell, z0 + k * cell));
  const soilAt = (i: number, k: number): number => {
    const u = (i * MESH_STEP) / cell,
      v = (k * MESH_STEP) / cell;
    const ix = Math.min(n - 1, Math.floor(u)),
      iz = Math.min(n - 1, Math.floor(v));
    const a = iz * (n + 1) + ix,
      b = a + n + 1;
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(soil[a]!, soil[a + 1]!, u - ix),
      THREE.MathUtils.lerp(soil[b]!, soil[b + 1]!, u - ix),
      v - iz,
    );
  };
  const P = (i: number, k: number): THREE.Vector3Like => ({
    x: x0 + i * MESH_STEP,
    y: H(i, k),
    z: z0 + k * MESH_STEP,
  });
  yield;
  for (let k = 0; k < steps; k++) {
    if (k % ROWS_PER_STEP === ROWS_PER_STEP - 1) yield;
    for (let i = 0; i < steps; i++) {
      // counter-clockwise seen from above
      g.quadSmooth(
        P(i, k + 1),
        P(i + 1, k + 1),
        P(i + 1, k),
        P(i, k),
        [N(i, k + 1), N(i + 1, k + 1), N(i + 1, k), N(i, k)],
        [soilAt(i, k + 1), soilAt(i + 1, k + 1), soilAt(i + 1, k), soilAt(i, k)],
      );
    }
  }
}

export function addChunkColliders(chunk: WildChunk, physics: PhysicsWorld, group: string): void {
  for (const t of chunk.trees)
    physics.addBox(
      group,
      { x: t.x - 0.3, y: t.y, z: t.z - 0.3 },
      { x: t.x + 0.3, y: t.y + t.height * 0.6, z: t.z + 0.3 },
    );
}
