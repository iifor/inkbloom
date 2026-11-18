// Footpaths and their bridges as chunk geometry (see world/wilderness/paths.ts for where they
// run). A path is trodden earth: a low crown along the middle, its edges sinking raggedly into
// the grass, the odd stone kicked to the side; it fades into the water at a ford. A bridge is
// planks across two beams on round posts, with a pole rail each side.
import * as THREE from 'three';
import { color } from '@/content/palette';
import type { GeometryBuilder } from '@/engine/render/geometry-builder';
import type { Vec3Like } from '@/engine/physics/world';
import type { WildChunk } from '@/world/wilderness/chunk';
import { WATER_LEVEL, type Wilderness } from '@/world/wilderness/generator';
import { type Bridge, pathsOf } from '@/world/wilderness/paths';
import { BOULDER } from './stone-shape';

/** How high the trodden middle of a path stands over the ground, metres. Its edges lie just on
 * the ground and are marked as edges (GeometryBuilder.pathEdge): the material breaks them up, so
 * where earth meets grass is a ragged painted line, not the hard edge of a ribbon. */
const CROWN = 0.045;
/** Longest stretch of path between cross-sections, metres: short enough for the edges to wander. */
const STEP = 0.6;
/** Where the path's cross-section has its points, from one edge (-1) to the other (1), and the
 * height of each over the ground (the edges' own wander is added to theirs). */
const ACROSS = [-1, -0.55, 0, 0.55, 1] as const;
const LIFTS = [0.012, CROWN, CROWN * 0.8, CROWN, 0.012] as const;
const ROCK = BOULDER;

/** 0..1 from a position and a salt: smooth enough along a path to read as one wavering edge. */
const wobble = (x: number, z: number, k: number): number =>
  0.5 +
  0.25 * Math.sin(x * 1.37 + z * 0.71 + k * 2.1) +
  0.15 * Math.sin(x * 3.1 - z * 2.3 + k * 5.7) +
  0.1 * Math.sin(x * 7.3 + z * 5.9 + k * 1.3);
/** 0..1, scattered (a cheap hash of a position). */
const speck = (x: number, z: number, k: number): number => {
  const h = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

/** The paths crossing a chunk, laid onto `g`. Each stretch is drawn by the chunk holding its
 * middle, so neighbouring chunks never draw the same piece twice. */
export function appendPaths(chunk: WildChunk, w: Wilderness, g: GeometryBuilder): void {
  const size = chunk.n * chunk.cell;
  const { x0, z0 } = chunk;
  const net = pathsOf(w);
  const earth = color('sand');
  const stone = color('rock');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
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
    /** The path at `k` (a point index, fractional between points): middle and the unit
     * sideways, and how wide it is there. */
    const at = (k: number): { x: number; z: number; sx: number; sz: number; half: number } => {
      const i = Math.min(count - 2, Math.floor(k));
      const f = k - i;
      const x = p[i * 2]! + (p[i * 2 + 2]! - p[i * 2]!) * f;
      const z = p[i * 2 + 1]! + (p[i * 2 + 3]! - p[i * 2 + 1]!) * f;
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 2);
      const dx = p[b * 2]! - p[a * 2]!;
      const dz = p[b * 2 + 1]! - p[a * 2 + 1]!;
      const l = Math.hypot(dx, dz) || 1;
      // a trodden way is never ruled straight: its width wanders, and it peters out over its
      // last few metres instead of ending square
      const wander = 0.8 + 0.2 * (0.5 * Math.sin(x * 0.37 + z * 0.21) + 0.5 * Math.sin(x * 0.13 - z * 0.29));
      const taper = Math.min(1, (k + 0.5) / 3, (count - 0.5 - k) / 3);
      return { x, z, sx: -dz / l, sz: dx / l, half: half * wander * taper };
    };
    /** A cross-section's points (ACROSS order), each edge pushed in or out a little on its own. */
    const section = (k: number): (Vec3Like & { edge: number })[] => {
      const c = at(k);
      return ACROSS.map((u, j) => {
        const edge = j === 0 || j === ACROSS.length - 1;
        const reach = c.half * (edge ? 1.15 + 0.35 * wobble(c.x, c.z, j) : 1) * u;
        const x = c.x + c.sx * reach;
        const z = c.z + c.sz * reach;
        return { x, y: w.heightAt(x, z) + LIFTS[j]!, z, edge: Math.abs(u) };
      });
    };
    for (let k = 0; k < count - 1; k++) {
      const mx = (p[k * 2]! + p[k * 2 + 2]!) / 2;
      const mz = (p[k * 2 + 1]! + p[k * 2 + 3]!) / 2;
      if (mx < x0 || mx >= x0 + size || mz < z0 || mz >= z0 + size) continue;
      // under water (a ford) or on a bridge deck: no earth to lay
      if (w.heightAt(mx, mz) < WATER_LEVEL + 0.05 || net.bridgeAt(mx, mz)) continue;
      const len = Math.hypot(p[k * 2 + 2]! - p[k * 2]!, p[k * 2 + 3]! - p[k * 2 + 1]!);
      const pieces = Math.max(1, Math.ceil(len / STEP));
      let prev = section(k);
      for (let s = 1; s <= pieces; s++) {
        const next = section(k + s / pieces);
        for (let j = 0; j < ACROSS.length - 1; j++) {
          const quad = [prev[j]!, next[j]!, next[j + 1]!, prev[j + 1]!] as const;
          // counter-clockwise seen from above: the cross product of A→B and A→C points up
          const [A, B, C] = quad;
          const up = (B.z - A.z) * (C.x - A.x) - (B.x - A.x) * (C.z - A.z);
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
          g.pathEdge([order[0].edge, order[1].edge, order[2].edge, order[3].edge]);
        }
        prev = next;
      }
      // now and then a stone half sunk at the path's edge, kicked aside by feet
      const c = at(k + 0.5);
      for (const side of [-1, 1]) {
        if (speck(c.x, c.z, side) > 0.35) continue;
        const r = 0.09 + 0.16 * speck(c.z, c.x, side + 2);
        const x = c.x + c.sx * side * (c.half + r * 0.4);
        const z = c.z + c.sz * side * (c.half + r * 0.4);
        q.setFromEuler(new THREE.Euler(speck(x, z, 4) * 3, speck(x, z, 5) * 6, 0));
        m.compose(
          new THREE.Vector3(x, w.heightAt(x, z) + r * 0.15, z),
          q,
          new THREE.Vector3(r * 1.3, r * 0.7, r),
        );
        g.meshSmooth(ROCK, m, stone);
      }
    }
  }
  for (const b of chunk.bridges) appendBridge(b, w, g);
}

/** Planks across the deck, one every PLANK metres along it (on a world grid, so the paint
 * pass can tell one plank from the next), with a sliver of a gap between them. */
const PLANK = 0.3;
const GAP = 0.035;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const POLE = new THREE.CylinderGeometry(1, 1, 1, 7);

/**
 * A footbridge as a carpenter would build it: two beams from bank to bank, planks laid across
 * them each a little different (length, height, set, and wood: fresh, dark or weathered grey),
 * round posts leaning a touch with braces between the pairs where the water is deep, and a pole
 * rail along each side sagging between the posts.
 */
function appendBridge(b: Bridge, w: Wilderness, g: GeometryBuilder): void {
  const woods = [color('brown'), color('brown'), color('bark'), color('rock')];
  const dark = color('bark');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const len = b.x1 - b.x0;
  /** A box from its middle, size and turn. */
  const block = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    turn: THREE.Euler,
    c: number,
  ) =>
    g.mesh(
      BOX,
      m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(turn), new THREE.Vector3(sx, sy, sz)),
      c,
    );
  /** A round pole from one point to another. */
  const pole = (a: THREE.Vector3, c: THREE.Vector3, r: number, colour: number) => {
    const d = new THREE.Vector3().subVectors(c, a);
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.mesh(
      POLE,
      m.compose(a.clone().add(c).multiplyScalar(0.5), q, new THREE.Vector3(r, d.length(), r)),
      colour,
    );
  };
  // the beams
  for (const side of [-1, 1])
    block((b.x0 + b.x1) / 2, b.y - 0.17, b.z + side * (b.half - 0.4), len, 0.16, 0.18, e.set(0, 0, 0), dark);
  // the planks
  for (let x = Math.ceil(b.x0 / PLANK) * PLANK; x + PLANK <= b.x1 + 1e-6; x += PLANK) {
    const r = (k: number) => speck(x, b.z, k);
    const ragL = (r(1) - 0.3) * 0.12;
    const ragR = (r(2) - 0.3) * 0.12;
    const zl = b.z - b.half - ragL;
    const zr = b.z + b.half + ragR;
    e.set((r(3) - 0.5) * 0.03, (r(4) - 0.5) * 0.05, (r(5) - 0.5) * 0.04);
    block(
      x + PLANK / 2,
      b.y - 0.04 + (r(6) - 0.5) * 0.025,
      (zl + zr) / 2,
      PLANK - GAP,
      0.075,
      zr - zl,
      e,
      woods[Math.floor(r(7) * woods.length)]!,
    );
  }
  // posts, a pair every few metres, each leaning its own way
  const posts = Math.max(2, Math.round(len / 5) + 1);
  const tops: THREE.Vector3[][] = [[], []];
  for (let i = 0; i < posts; i++) {
    const x = b.x0 + 0.2 + ((len - 0.4) * i) / (posts - 1);
    [-1, 1].forEach((side, s) => {
      const z = b.z + side * (b.half - 0.12);
      const r = (k: number) => speck(x, z, k + 10);
      const foot = new THREE.Vector3(x, Math.min(w.heightAt(x, z), b.y - 0.3) - 0.4, z);
      const top = new THREE.Vector3(
        x + (r(1) - 0.5) * 0.08,
        b.y + 0.9 + (r(2) - 0.5) * 0.12,
        z + side * r(3) * 0.05,
      );
      pole(foot, top, 0.1 + 0.025 * r(4), dark);
      tops[s]!.push(top);
    });
    // a brace across the pair below the deck, where there is water under it
    const depth = WATER_LEVEL - w.heightAt(x, b.z);
    if (depth > 0.6) {
      const lo = Math.max(w.heightAt(x, b.z) + 0.2, b.y - 1.6);
      pole(
        new THREE.Vector3(x, b.y - 0.3, b.z - b.half + 0.12),
        new THREE.Vector3(x, lo, b.z + b.half - 0.12),
        0.05,
        dark,
      );
    }
  }
  // the rails: a pole from post to post along each side, sagging a little in between
  for (const row of tops)
    for (let i = 0; i + 1 < row.length; i++) {
      const a = row[i]!.clone().setY(row[i]!.y - 0.1);
      const c = row[i + 1]!.clone().setY(row[i + 1]!.y - 0.1);
      const mid = a.clone().add(c).multiplyScalar(0.5);
      mid.y -= 0.05 + 0.03 * speck(mid.x, mid.z, 20);
      pole(a, mid, 0.045, dark);
      pole(mid, c, 0.045, dark);
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
