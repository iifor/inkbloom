// Ink wells (墨泉): ink seeping up out of the ground in the grey land round a town that has not
// been restored. Where they are is a pure function of (seed, chunk), like the pigment sources;
// whether one is seeping depends on how drained the land is, like the wild monsters, and once
// the town's colour comes back it dries up by itself. While it seeps a few monsters guard it.
// With its guards down a player can cleanse it (a `cleanse` patch): it runs clear for good and
// the colour comes back round it, even while the town is still grey.
import { enemyIndex } from '@/content/enemies';
import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { springsNear } from './landmarks';
import { pathsOf } from './paths';
import { ruinsInChunk } from './ruins';
import { sourcesInChunk } from './sources';
import type { WildMonster } from './wild-monsters';

export interface InkWell {
  /** `w<cx>_<cz>`: the chunk it is in. */
  readonly id: string;
  readonly cx: number;
  readonly cz: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
}

/** A guard's number in its chunk's monster ids (`cx,cz:k`), clear of the chunk's own monsters. */
export const GUARD_BASE = 50;

const cache = new WeakMap<Wilderness, Map<string, InkWell | null>>();

/** What `of` gives for a chunk and the eight round it. */
function near9<T>(cx: number, cz: number, of: (cx: number, cz: number) => readonly T[]): T[] {
  const out: T[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push(...of(cx + dx, cz + dz));
  return out;
}

/** The ink well in a chunk, if it has one: in the drained ring round a town, on open ground. */
export function inkWellInChunk(w: Wilderness, cx: number, cz: number): InkWell | null {
  let m = cache.get(w);
  if (!m) cache.set(w, (m = new Map()));
  const key = `${cx},${cz}`;
  if (!m.has(key)) m.set(key, findWell(w, cx, cz));
  return m.get(key)!;
}

function findWell(w: Wilderness, cx: number, cz: number): InkWell | null {
  const W = TUNING.combat.wells;
  const h0 = hashAt(w.seed, 'ink-well', cx, cz);
  if (unit(h0) >= W.chance) return null;
  const size = TUNING.world.chunkSize;
  for (let a = 0; a < 8; a++) {
    const h = hashAt(w.seed, 'ink-well-spot', cx, cz, a);
    const x = cx * size + 16 + unit(h) * (size - 32);
    const z = cz * size + 16 + unit(hashInts(h, 1)) * (size - 32);
    // close enough to a town to lie in its grey, not in or right by it
    const wall = Math.min(
      ...w
        .entrancesNear(x, z, 1)
        .map((e) =>
          Math.hypot(
            Math.max(Math.abs(x - e.x) - e.size / 2, 0),
            Math.max(Math.abs(z - e.z) - e.size / 2, 0),
          ),
        ),
    );
    if (!(wall > 30 && wall < TUNING.drain.innerRadius + 50)) continue;
    const y = w.terrainHeightAt(x, z);
    if (y < WATER_LEVEL + 1) continue;
    if (Math.hypot(w.terrainHeightAt(x + 4, z) - y, w.terrainHeightAt(x, z + 4) - y) > 1.5) continue;
    if (pathsOf(w).edgeDistance(x, z) < 6) continue;
    // clear of the chunk's ruins and pigment sources, and of hot springs
    if (near9(cx, cz, (ax, az) => ruinsInChunk(w, ax, az)).some((r) => Math.hypot(r.x - x, r.z - z) < 25))
      continue;
    if (sourcesInChunk(w, cx, cz).some((s) => Math.hypot(s.x - x, s.z - z) < 10)) continue;
    if (springsNear(w, x, z, 20).length) continue;
    return { id: `w${cx}_${cz}`, cx, cz, x, y: w.heightAt(x, z), z, seed: h };
  }
  return null;
}

/** An ink well by id, or null. */
export function inkWellById(w: Wilderness, id: string): InkWell | null {
  const m = /^w(-?\d+)_(-?\d+)$/.exec(id);
  if (!m) return null;
  const well = inkWellInChunk(w, Number(m[1]), Number(m[2]));
  return well?.id === id ? well : null;
}

/** The well a guard keeps (its id), if `monster` is a guard's id. */
export function wellOfGuard(monster: string): string | null {
  const m = /^(-?\d+),(-?\d+):(\d+)$/.exec(monster);
  return m && Number(m[3]) >= GUARD_BASE && Number(m[3]) < 100 ? `w${m[1]}_${m[2]}` : null;
}

/** Whether ink still seeps from a well where the land is this saturated (0 grey .. 1 colour). */
export const wellSeeping = (saturation: number): boolean => saturation < TUNING.combat.wild.greyBelow;

/** The monsters guarding a seeping well, in a ring round it; none once it is dry or cleansed. */
export function wellGuards(
  w: Wilderness,
  well: InkWell,
  saturation: number,
  cleansed = false,
): WildMonster[] {
  if (cleansed || !wellSeeping(saturation)) return [];
  const [lo, hi] = TUNING.combat.wells.guards;
  const count = lo + Math.floor(unit(hashInts(well.seed, 7)) * (hi - lo + 1));
  const out: WildMonster[] = [];
  for (let k = 0; k < count; k++) {
    const a = ((k + unit(hashInts(well.seed, 10 + k)) * 0.5) / count) * Math.PI * 2;
    const r = 5 + 3 * unit(hashInts(well.seed, 20 + k));
    let x = well.x + Math.cos(a) * r;
    let z = well.z + Math.sin(a) * r;
    if (w.heightAt(x, z) <= WATER_LEVEL + 0.5)
      [x, z] = [well.x + Math.cos(a) * 2.5, well.z + Math.sin(a) * 2.5];
    // no giants: a chunk has at most one, and that is its own (wild-monsters.ts)
    const kind = unit(hashInts(well.seed, 30 + k));
    const type = kind < 0.4 ? enemyIndex('spitter') : kind < 0.7 ? enemyIndex('weasel') : enemyIndex('blot');
    out.push({ id: `${well.cx},${well.cz}:${GUARD_BASE + k}`, type, x, y: w.heightAt(x, z), z });
  }
  return out;
}

/** Ink wells in chunks within `reach` metres of (x, z). */
export function inkWellsNear(w: Wilderness, x: number, z: number, reach: number): InkWell[] {
  const size = TUNING.world.chunkSize;
  const out: InkWell[] = [];
  for (let cx = Math.floor((x - reach) / size); cx <= Math.floor((x + reach) / size); cx++)
    for (let cz = Math.floor((z - reach) / size); cz <= Math.floor((z + reach) / size); cz++) {
      const well = inkWellInChunk(w, cx, cz);
      if (well && Math.hypot(well.x - x, well.z - z) <= reach) out.push(well);
    }
  return out;
}

/** The cleansed wells whose colour reaches (x, z), as `saturationAt` takes them. */
export function cleansedNear(
  w: Wilderness,
  x: number,
  z: number,
  cleansed: ReadonlyMap<string, number>,
): { x: number; z: number; r: number }[] {
  const r = TUNING.combat.wells.bloom;
  if (!cleansed.size) return [];
  return inkWellsNear(w, x, z, r)
    .filter((well) => cleansed.has(well.id))
    .map((well) => ({ x: well.x, z: well.z, r }));
}
