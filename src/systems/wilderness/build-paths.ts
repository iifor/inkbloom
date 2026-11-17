// Footpaths and their bridges as chunk geometry (see world/wilderness/paths.ts for where they
// run). A path is a ribbon of sandy earth laid a few centimetres over the ground, following it
// exactly (the ground is flat within each of its cells), so it never floats or sinks; it fades
// into the water at a ford. A bridge is a plank deck on posts with a rail each side.
import * as THREE from 'three';
import { color } from '@/content/palette';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Vec3Like } from '@/engine/physics/world';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { type Bridge, pathsOf } from '@/world/wilderness/paths';

/** How far the ribbon sits over the ground, metres. */
const LIFT = 0.07;

/** The paths crossing a chunk, laid onto `g`. Each stretch is drawn by the chunk holding its
 * middle, so neighbouring chunks never draw the same piece twice. */
export function appendPaths(chunk: WildChunk, w: Wilderness, g: GeometryBuilder): void {
  const size = chunk.n * chunk.cell;
  const { x0, z0 } = chunk;
  const net = pathsOf(w);
  const earth = color('sand');
  const normal = (x: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(
      w.heightAt(x - 0.5, z) - w.heightAt(x + 0.5, z),
      1,
      w.heightAt(x, z - 0.5) - w.heightAt(x, z + 0.5),
    ).normalize();
  for (const t of net.trailsNear(x0, z0, x0 + size, z0 + size)) {
    const p = t.pts;
    const half = t.width / 2;
    const count = p.length / 2;
    /** The two edges of the ribbon at point k (x, z pairs), square to the way it runs there. */
    const edges = (k: number): [number, number, number, number] => {
      const i = k * 2;
      const a = Math.max(0, i - 2);
      const b = Math.min(p.length - 2, i + 2);
      const dx = p[b]! - p[a]!;
      const dz = p[b + 1]! - p[a + 1]!;
      const l = Math.hypot(dx, dz) || 1;
      // a trodden way is never ruled straight: its width wanders a little, and it peters out
      // over its last few metres instead of ending square
      const x = p[i]!;
      const z = p[i + 1]!;
      const wander =
        0.82 + 0.18 * (0.5 * Math.sin(x * 0.37 + z * 0.21) + 0.5 * Math.sin(x * 0.13 - z * 0.29));
      const taper = Math.min(1, (k + 0.5) / 3, (count - 0.5 - k) / 3);
      const w = half * wander * taper;
      const nx = (-dz / l) * w;
      const nz = (dx / l) * w;
      return [x + nx, z + nz, x - nx, z - nz];
    };
    for (let k = 0; k < count - 1; k++) {
      const mx = (p[k * 2]! + p[k * 2 + 2]!) / 2;
      const mz = (p[k * 2 + 1]! + p[k * 2 + 3]!) / 2;
      if (mx < x0 || mx >= x0 + size || mz < z0 || mz >= z0 + size) continue;
      // under water (a ford) or on a bridge deck: no earth to lay
      if (w.heightAt(mx, mz) < WATER_LEVEL + 0.05 || net.bridgeAt(mx, mz)) continue;
      const [ax, az, bx, bz] = edges(k);
      const [cx, cz, dx, dz] = edges(k + 1);
      const v = (x: number, z: number): Vec3Like => ({ x, y: w.heightAt(x, z) + LIFT, z });
      // counter-clockwise seen from above
      const quad = [v(ax, az), v(cx, cz), v(dx, dz), v(bx, bz)] as const;
      // front face up: the cross product of the first two edges (A→C, A→D) must point up
      const up = (cz - az) * (dx - ax) - (cx - ax) * (dz - az);
      const order = up > 0 ? quad : ([quad[3], quad[2], quad[1], quad[0]] as const);
      g.quadSmooth(
        order[0],
        order[1],
        order[2],
        order[3],
        [
          normal(order[0].x, order[0].z),
          normal(order[1].x, order[1].z),
          normal(order[2].x, order[2].z),
          normal(order[3].x, order[3].z),
        ],
        earth,
      );
    }
  }
  for (const b of chunk.bridges) appendBridge(b, w, g);
}

/** A plank deck on posts, with a rail along each side. */
function appendBridge(b: Bridge, w: Wilderness, g: GeometryBuilder): void {
  const plank = color('brown');
  const wood = color('bark');
  const all = { px: plank, nx: plank, py: plank, ny: plank, pz: plank, nz: plank };
  const dark = { px: wood, nx: wood, py: wood, ny: wood, pz: wood, nz: wood };
  g.box({ x: b.x0, y: b.y - 0.22, z: b.z - b.half }, { x: b.x1, y: b.y, z: b.z + b.half }, all);
  const len = b.x1 - b.x0;
  const posts = Math.max(2, Math.round(len / 6) + 1);
  for (let i = 0; i < posts; i++) {
    const x = b.x0 + 0.2 + ((len - 0.4) * i) / (posts - 1);
    for (const side of [-1, 1]) {
      const z = b.z + side * (b.half - 0.12);
      const foot = Math.min(w.heightAt(x, z), b.y - 0.3) - 0.4;
      g.box({ x: x - 0.12, y: foot, z: z - 0.12 }, { x: x + 0.12, y: b.y + 0.95, z: z + 0.12 }, dark);
    }
  }
  for (const side of [-1, 1]) {
    const z = b.z + side * (b.half - 0.12);
    g.box({ x: b.x0, y: b.y + 0.8, z: z - 0.06 }, { x: b.x1, y: b.y + 0.92, z: z + 0.06 }, dark);
  }
}

/** Colliders for the chunk's bridges: the deck to walk on, the rails to keep you on it. */
export function addBridgeColliders(
  chunk: WildChunk,
  physics: { addBox(group: string, min: Vec3Like, max: Vec3Like): unknown },
  group: string,
): void {
  for (const b of chunk.bridges) {
    physics.addBox(group, { x: b.x0, y: b.y - 0.22, z: b.z - b.half }, { x: b.x1, y: b.y, z: b.z + b.half });
    for (const side of [-1, 1]) {
      const z = b.z + side * (b.half - 0.12);
      physics.addBox(group, { x: b.x0, y: b.y, z: z - 0.1 }, { x: b.x1, y: b.y + 0.95, z: z + 0.1 });
    }
  }
}
