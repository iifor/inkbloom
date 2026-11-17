// Where the arena is: a stretch of real wilderness, the same for the server and every client
// because it follows from the seed. Searched once, in a ring well away from the spawn: dry,
// rolling ground with some trees, no town near and no ruin inside. Also lays out what is built
// there (wall, cover, spawn points) and the tree trunks inside, which stop shots.
import { ARENA, ARENA_COVER } from '@/content/arena';
import { TUNING } from '@/content/tuning';
import { type Wilderness, WATER_LEVEL, townDistance } from '../wilderness/generator';
import { generateWildChunk } from '../wilderness/chunk';
import { ruinsInChunk } from '../wilderness/ruins';
import type { Box } from './hits';

export interface ArenaSite {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Stone blocks to hide behind, and tree trunks: both stop shots. */
  readonly cover: readonly Box[];
  readonly trunks: readonly Box[];
  /** Where players stand up, facing the middle. */
  readonly spawns: readonly { x: number; y: number; z: number; yaw: number }[];
}

/** Candidates spread over the ring on a golden-angle spiral: the same order for any seed.
 * Towns are a few hundred metres apart and rivers run between them, so most are turned down;
 * the cheap checks (towns, then water) come first. */
const CANDIDATES = 4000;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Metres between ground samples: close enough not to step over a stream. */
const SAMPLE = 3;

/** Chunks overlapping a circle. */
function chunksAround(x: number, z: number, r: number): [number, number][] {
  const size = TUNING.world.chunkSize;
  const out: [number, number][] = [];
  for (let cx = Math.floor((x - r) / size); cx <= Math.floor((x + r) / size); cx++)
    for (let cz = Math.floor((z - r) / size); cz <= Math.floor((z + r) / size); cz++) out.push([cx, cz]);
  return out;
}

/** How the ground round (x, z) suits an arena: 'no' (a town, water or a ruin in the way),
 * 'dry' (could be used, but too flat, too rough or too steep), or 'good'. */
function suits(w: Wilderness, x: number, z: number): 'no' | 'dry' | 'good' {
  const r = ARENA.radius;
  if (w.entrancesNear(x, z, 2).some((e) => townDistance(e, x, z) < ARENA.townClear)) return 'no';
  let lo = Infinity;
  let hi = -Infinity;
  const n = Math.ceil(r / SAMPLE);
  const heights = new Map<string, number>();
  for (let i = -n; i <= n; i++)
    for (let k = -n; k <= n; k++) {
      if (Math.hypot(i, k) * SAMPLE > r + SAMPLE) continue;
      const h = w.heightAt(x + i * SAMPLE, z + k * SAMPLE);
      if (h < WATER_LEVEL + 0.8) return 'no';
      heights.set(`${i},${k}`, h);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  for (const [cx, cz] of chunksAround(x, z, r + 20))
    if (ruinsInChunk(w, cx, cz).some((ruin) => Math.hypot(ruin.x - x, ruin.z - z) < r + 20)) return 'no';
  if (hi - lo < ARENA.minRelief || hi - lo > ARENA.maxRelief) return 'dry';
  for (const [key, h] of heights) {
    const [i, k] = key.split(',').map(Number) as [number, number];
    for (const [di, dk] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const next = heights.get(`${i + di},${k + dk}`);
      if (next !== undefined && Math.abs(next - h) > ARENA.maxStep * (SAMPLE / 6)) return 'dry';
    }
  }
  return 'good';
}

function treesInside(w: Wilderness, x: number, z: number, r: number) {
  return chunksAround(x, z, r).flatMap(([cx, cz]) =>
    generateWildChunk(w, cx, cz).trees.filter((t) => Math.hypot(t.x - x, t.z - z) < r - 1),
  );
}

/** The ground's highest and lowest point under a footprint. */
function groundUnder(w: Wilderness, x0: number, z0: number, x1: number, z1: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = x0; x <= x1 + 0.01; x += Math.max(0.5, (x1 - x0) / 4))
    for (let z = z0; z <= z1 + 0.01; z += Math.max(0.5, (z1 - z0) / 4)) {
      const h = w.heightAt(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  return [lo, hi];
}

/** Lay the arena out at (x, z). */
export function arenaAt(w: Wilderness, x: number, z: number): ArenaSite {
  const cover: Box[] = ARENA_COVER.map((c) => {
    const x0 = x + c.dx - c.w / 2;
    const x1 = x + c.dx + c.w / 2;
    const z0 = z + c.dz - c.d / 2;
    const z1 = z + c.dz + c.d / 2;
    const [lo, hi] = groundUnder(w, x0, z0, x1, z1);
    // sunk into the low side so no gap shows under it
    return { min: { x: x0, y: lo - 0.4, z: z0 }, max: { x: x1, y: hi + c.h, z: z1 } };
  });
  const trunks: Box[] = treesInside(w, x, z, ARENA.radius).map((t) => ({
    // the same trunk the physics uses (systems/wilderness/build-chunk.ts addChunkColliders)
    min: { x: t.x - 0.3, y: t.y, z: t.z - 0.3 },
    max: { x: t.x + 0.3, y: t.y + t.height * 0.6, z: t.z + 0.3 },
  }));
  const blocked = (px: number, pz: number): boolean =>
    [...cover, ...trunks].some(
      (b) => px > b.min.x - 1 && px < b.max.x + 1 && pz > b.min.z - 1 && pz < b.max.z + 1,
    );
  const spawns: ArenaSite['spawns'][number][] = [];
  for (let i = 0; i < ARENA.spawns; i++) {
    // nudge round the ring until clear of cover and trees
    for (let step = 0; step < 12; step++) {
      const a = ((i + step * 0.07) / ARENA.spawns) * Math.PI * 2;
      const px = x + Math.cos(a) * ARENA.spawnRing;
      const pz = z + Math.sin(a) * ARENA.spawnRing;
      if (blocked(px, pz) && step < 11) continue;
      // facing the middle (the game's yaw: 0 looks down -z)
      spawns.push({ x: px, y: w.heightAt(px, pz), z: pz, yaw: Math.atan2(px - x, pz - z) });
      break;
    }
  }
  return { x, z, radius: ARENA.radius, cover, trunks, spawns };
}

const found = new Map<number, ArenaSite>();

/** The arena of this world. The first call searches (a few milliseconds); later ones remember. */
export function findArenaSite(w: Wilderness): ArenaSite {
  const known = found.get(w.seed);
  if (known) return known;
  // second best: dry but bare, or dry but too flat or rough; last resort: the first spot tried
  let fallback: [number, number] | null = null;
  let site: ArenaSite | null = null;
  for (let i = 0; i < CANDIDATES && !site; i++) {
    const d = ARENA.nearest + (ARENA.farthest - ARENA.nearest) * ((i * 0.618034) % 1);
    const a = i * GOLDEN;
    const x = Math.round(Math.cos(a) * d);
    const z = Math.round(Math.sin(a) * d);
    const fit = suits(w, x, z);
    if (fit === 'no') continue;
    if (fit === 'dry' || treesInside(w, x, z, ARENA.radius).length < ARENA.minTrees) {
      fallback ??= [x, z];
      continue;
    }
    site = arenaAt(w, x, z);
  }
  site ??= arenaAt(w, ...(fallback ?? [ARENA.nearest, 0]));
  found.set(w.seed, site);
  return site;
}
