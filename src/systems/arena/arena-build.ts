// What the arena looks like (its colliders and hits are its plain boxes: systems/arena and
// world/arena/hits.ts). The wall is a standing wave of wet ink: its face swells and its crest
// leans in, so the ink's sheen catches the light along it instead of reading as a black slab.
// The cover is old stone: courses of rounded blocks, a little rubble at the foot and moss on
// top, each inside the box that stops players and shots.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ARENA } from '@/content/arena';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { lumpGeometry } from '@/engine/render/soft-shapes';
import type { ArenaSite } from '@/world/arena/site';
import { Rng } from '@/world/math/rng';

/** Columns round the ring: enough for the swells to read smooth. */
const COLUMNS = 192;

/** The wall's cross-section at one place round the ring: (out from the wall line, up from the
 * ground) from the outer foot over the crest to the inner foot. `lean` tips the crest inwards,
 * `top` is how high it stands there. */
function profile(top: number, lean: number, swell: number): [number, number][] {
  const t = ARENA.wall.thickness;
  return [
    [t + 0.3, -1.2],
    [t + 0.15 + swell * 0.5, top * 0.35],
    [t * 0.7 + swell * 0.3, top * 0.75],
    [t * 0.3 - lean * 0.4, top * 0.97],
    [-lean * 0.6, top + 0.15],
    [-lean - 0.15, top * 0.95],
    [-lean * 0.7 - swell, top * 0.7],
    [-swell * 0.6, top * 0.35],
    [-0.25, -1.2],
  ];
}

/** Part of the ring, as one smooth mesh following the ground: the profile's points `from` to
 * `to` (the crest is solid wet ink; below it the wall is painted, so it takes the light). */
function inkWall(
  site: ArenaSite,
  heightAt: (x: number, z: number) => number,
  from: number,
  to: number,
): THREE.BufferGeometry {
  const rng = new Rng(Math.round(site.x * 31 + site.z * 17));
  const waves = [3, 7, 13, 29].map((k) => ({ k, a: rng.range(0, Math.PI * 2) }));
  const pos: number[] = [];
  const index: number[] = [];
  const P = to - from + 1;
  for (let i = 0; i <= COLUMNS; i++) {
    const a = (i / COLUMNS) * Math.PI * 2;
    // the crest rises and falls round the ring in long swells with smaller ones on them
    const w = waves.reduce((s, v, n) => s + Math.sin(v.k * a + v.a) / (n + 1.5), 0);
    const top = ARENA.wall.height + w * 0.7;
    const lean = 0.35 + 0.25 * Math.sin(5 * a + waves[0]!.a);
    const swell = 0.12 * Math.sin(41 * a + waves[1]!.a) + 0.08 * Math.sin(67 * a);
    const out = { x: Math.cos(a), z: Math.sin(a) };
    const r0 = site.radius;
    const ground = heightAt(site.x + out.x * r0, site.z + out.z * r0);
    for (const [d, y] of profile(top, lean, swell).slice(from, to + 1))
      pos.push(site.x + out.x * (r0 + d), ground + y, site.z + out.z * (r0 + d));
  }
  for (let i = 0; i < COLUMNS; i++)
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k;
      const b = (i + 1) * P + k;
      // wound to face outwards on the outer side and inwards on the inner (the profile runs
      // over the crest, so one winding does both)
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const course = new Map<string, THREE.BufferGeometry>();
function rounded(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = [w, h, d].map((v) => v.toFixed(2)).join();
  let g = course.get(key);
  if (!g)
    course.set(key, (g = new RoundedBoxGeometry(w, h, d, 2, Math.min(0.12, Math.min(w, h, d) / 2 - 0.01))));
  return g;
}

/** One block of cover: stone courses, each a little set back and rounded, the top one broken
 * off unevenly, with rubble and moss. All inside its box. */
function coverBlock(g: GeometryBuilder, box: ArenaSite['cover'][number], seed: number): void {
  const rng = new Rng(seed);
  const m = new THREE.Matrix4();
  const stone = color('stone');
  const rock = color('rock');
  const moss = color('forest');
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const height = box.max.y - box.min.y;
  const courses = Math.max(2, Math.round(height / 0.6));
  const along = w >= d ? 'x' : 'z';
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  for (let c = 0; c < courses; c++) {
    const y0 = box.min.y + (c / courses) * height;
    const h = height / courses;
    // stones in this course: a row along the block's length, joints staggered course to course
    const n = Math.max(1, Math.round(long / 1.4));
    const last = c === courses - 1;
    for (let s = 0; s < n; s++) {
      // the top course is broken: some stones gone, the rest lower
      if (last && n > 1 && rng.next() < 0.3) continue;
      const len = long / n;
      const off = -long / 2 + len * (s + 0.5) + (c % 2 ? len * 0.15 : -len * 0.15);
      const sl = len * 0.97;
      const sh = h * (last ? 0.55 + 0.4 * rng.next() : 0.96);
      const sd = short * (0.92 + 0.06 * rng.next());
      const geo = along === 'x' ? rounded(sl, sh, sd) : rounded(sd, sh, sl);
      const x = along === 'x' ? cx + THREE.MathUtils.clamp(off, -w / 2 + sl / 2, w / 2 - sl / 2) : cx;
      const z = along === 'z' ? cz + THREE.MathUtils.clamp(off, -d / 2 + sl / 2, d / 2 - sl / 2) : cz;
      g.meshSmooth(geo, m.makeTranslation(x, y0 + sh / 2, z), (s + c) % 3 === 0 ? rock : stone, ALWAYS_COLOR);
      // moss on what faces up
      if (rng.next() < (last ? 0.6 : 0.15))
        g.meshSmooth(
          lumpGeometry(seed + s * 7 + c, 0.3),
          m.compose(
            new THREE.Vector3(x + (rng.next() - 0.5) * sl * 0.4, y0 + sh, z + (rng.next() - 0.5) * sd * 0.4),
            new THREE.Quaternion(),
            new THREE.Vector3(0.35 * Math.min(1, sl), 0.07, 0.25),
          ),
          moss,
          ALWAYS_COLOR,
        );
    }
  }
  // fallen stones round the foot
  for (let r = 0; r < 3; r++) {
    const side = rng.next() < 0.5 ? -1 : 1;
    const x = along === 'x' ? cx + (rng.next() - 0.5) * w : cx + side * (w / 2 + 0.25);
    const z = along === 'z' ? cz + (rng.next() - 0.5) * d : cz + side * (d / 2 + 0.25);
    const s = 0.18 + rng.next() * 0.16;
    g.meshSmooth(
      lumpGeometry(seed * 3 + r, 0.25),
      m.compose(
        new THREE.Vector3(x, box.min.y + 0.4 + s * 0.4, z),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s * 0.7, s),
      ),
      rock,
      ALWAYS_COLOR,
    );
  }
}

/** The arena's wall and cover, ready to draw. */
export function buildArena(
  site: ArenaSite,
  heightAt: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  // the outer and inner faces in a dark wash, the crest over the top in wet ink
  const id = new THREE.Matrix4();
  g.meshSmooth(inkWall(site, heightAt, 0, 3), id, color('charcoal'), ALWAYS_COLOR);
  g.meshSmooth(inkWall(site, heightAt, 3, 5), id, color('ink'), ALWAYS_COLOR);
  g.meshSmooth(inkWall(site, heightAt, 5, 8), id, color('charcoal'), ALWAYS_COLOR);
  site.cover.forEach((b, i) => coverBlock(g, b, 1000 + i));
  return g.build();
}
