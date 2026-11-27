import { TUNING } from '@/content/tuning';
import { hashAt, hashInts, unit } from '../math/hash';
import { type Wilderness, WATER_LEVEL } from './generator';
import { pathsOf } from './paths';
import type { WildChunk } from './chunk';
import { springLevel } from './landmarks';
import { PIGMENT_SOURCES } from '@/content/pigment-sources';

export type AnimalSpecies =
  | 'fox'
  | 'cow'
  | 'donkey'
  | 'horse'
  | 'rabbit'
  | 'bird'
  | 'boar'
  | 'chick'
  | 'cat'
  | 'bee'
  | 'frog'
  | 'dog'
  | 'crab'
  | 'bat'
  | 'panda'
  | 'mushroom'
  | 'penguin'
  | 'berrybird'
  | 'springSpirit'
  | 'ridgeDragon'
  | 'fieldMouse'
  | 'grassSnake'
  | 'oreSpirit'
  | 'elderSpirit'
  | 'silkSpider'
  | 'ruinGhost';
export type OutdoorRole = 'gatherer' | 'ranger' | 'walker';
export interface LifeSite {
  readonly id: string;
  readonly seed: number;
  readonly x: number;
  readonly z: number;
  readonly kind: AnimalSpecies | OutdoorRole;
  readonly person: boolean;
  readonly count: number;
  /** Centre height of a flight path above a landmark. */
  readonly flightY?: number;
  readonly landmarkId?: string;
  readonly shelter?: { x: number; z: number };
}

/** Use the props in the finished chunk, including the farm's actual gate and the painted flowers. */
export function habitatAnimals(w: Wilderness, chunk: WildChunk): LifeSite[] {
  const { cx, cz, farmstead: farm } = chunk;
  const sites: LifeSite[] = [];
  function add(
    kind: AnimalSpecies,
    x: number,
    z: number,
    count: number,
    flightY?: number,
    details?: Pick<LifeSite, 'landmarkId' | 'shelter'>,
  ) {
    const seed = hashAt(w.seed, kind, cx, cz);
    sites.push({
      id: `fauna:${cx},${cz}:${kind}`,
      seed,
      x,
      z,
      count,
      kind,
      person: false,
      flightY,
      ...details,
    });
  }
  if (farm) {
    const stock = (['cow', 'donkey', 'horse'] as const)[hashInts(farm.seed, 37) % 3]!;
    const penZ = farm.z + farm.front * (farm.hd - 4.2);
    for (const sign of [-1, 1]) {
      const penX = farm.x + sign * (farm.hw - 3.8);
      if (farm.buildings.some((b) => Math.abs(penX - b.x) < b.hw + 2 && Math.abs(penZ - b.z) < b.hd + 2))
        continue;
      if (lifeGround(w, penX, penZ, 1.5)) {
        add(stock, penX, penZ, 1);
        break;
      }
    }
    const gate = farm.z + farm.front * farm.hd;
    const side = farm.seed % 2 ? 1 : -1;
    add('chick', farm.x + side * 3, gate - farm.front * 2.6, 2 + (farm.seed % 3));
    // Both ends of the opening have a 1.08 m wooden post, including on stone-walled farms.
    add('cat', farm.x - side * 1.55, gate, 1);
    add('dog', farm.x + side * 3.5, gate + farm.front * 3, 1);
    const x = farm.x + side * (farm.hw - 2.4),
      z = gate + farm.front * 1.6;
    if (lifeGround(w, x, z, 1)) add('fieldMouse', x, z, 1, undefined, { shelter: { x: x - side * 2.7, z } });
  }
  const flowers = chunk.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'flowers');
  if (flowers) add('bee', flowers.x, flowers.z, 2 + (hashAt(w.seed, 'bees', cx, cz) % 2));
  function inside(x: number, z: number) {
    const size = chunk.cell * chunk.n;
    return x >= chunk.x0 + 2 && z >= chunk.z0 + 2 && x < chunk.x0 + size - 2 && z < chunk.z0 + size - 2;
  }
  for (const src of chunk.sources) {
    const kind = PIGMENT_SOURCES[src.kind]?.key;
    if (kind === 'ore') add('oreSpirit', src.x, src.z, 1, undefined, { landmarkId: src.id });
    if (kind === 'reeds') {
      for (const [dx, dz] of [
        [2.4, 0],
        [-2.4, 0],
        [0, 2.4],
        [0, -2.4],
      ] as const) {
        const x = src.x + dx,
          z = src.z + dz;
        if (
          inside(x, z) &&
          w.heightAt(x, z) > WATER_LEVEL + 0.25 &&
          Math.abs(w.heightAt(x, z) - src.y) < 0.7
        ) {
          add('grassSnake', x, z, 1, undefined, { shelter: { x: src.x, z: src.z } });
          break;
        }
      }
    }
  }
  const elder = chunk.trees.find((t) => t.kind === 'great');
  if (elder) add('elderSpirit', elder.x + elder.crown * 0.55, elder.z, 1);
  const stump = chunk.groundProps.find((p) => p.kind === 'stump');
  if (stump)
    add('silkSpider', stump.x + 0.95 * stump.scale, stump.z, 1, undefined, {
      shelter: { x: stump.x, z: stump.z },
    });
  for (const ruin of chunk.ruins) add('ruinGhost', ruin.x, ruin.z + 4, 1, undefined, { landmarkId: ruin.id });
  for (const spring of chunk.springs)
    add('springSpirit', spring.x, spring.z, 1, springLevel(spring, w) + 0.95);
  for (const lookout of chunk.lookouts)
    add('ridgeDragon', lookout.x, lookout.z, 1, w.heightAt(lookout.x, lookout.z) + 4.8);
  const berries = chunk.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'berries');
  if (berries) {
    const start = unit(hashAt(w.seed, 'berry-perch', cx, cz)) * Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const angle = start + (i * Math.PI) / 2;
      const x = berries.x + 2.4 * Math.sin(angle),
        z = berries.z + 2.4 * Math.cos(angle);
      if (!inside(x, z) || !lifeGround(w, x, z, 1)) continue;
      add('berrybird', x, z, 1);
      break;
    }
  }
  for (const bamboo of chunk.trees) {
    if (bamboo.kind !== 'bamboo') continue;
    const x = bamboo.x + bamboo.crown + 1.4,
      z = bamboo.z;
    if (!inside(x, z) || !lifeGround(w, x, z, 2)) continue;
    if (chunk.trees.some((t) => Math.hypot(t.x - x, t.z - z) < t.crown + 0.6)) continue;
    add('panda', x, z, 1);
    break;
  }
  for (const log of chunk.groundProps) {
    if (log.kind !== 'windfall' && log.kind !== 'stump') continue;
    const x = log.x + Math.cos(log.yaw) * 1.5,
      z = log.z - Math.sin(log.yaw) * 1.5;
    if (!inside(x, z) || !lifeGround(w, x, z, 1)) continue;
    add('mushroom', x, z, 1);
    break;
  }
  const forestSeed = hashAt(w.seed, 'night-flight', cx, cz);
  const foxSeed = hashAt(w.seed, 'fox-glade', cx, cz);
  if (chunk.trees.length >= 4 && unit(foxSeed) < 0.3) {
    for (const tree of chunk.trees.slice(0, 8)) {
      const x = tree.x + tree.crown + 2,
        z = tree.z;
      if (
        inside(x, z) &&
        lifeGround(w, x, z, 2) &&
        !chunk.trees.some((t) => Math.hypot(x - t.x, z - t.z) < 2)
      ) {
        add('fox', x, z, 1);
        break;
      }
    }
  }
  if (chunk.trees.length >= 5 && unit(forestSeed) < 0.48) {
    for (let i = 0; i < Math.min(chunk.trees.length, 12); i++) {
      const tree = chunk.trees[(forestSeed + i) % chunk.trees.length]!;
      const x = tree.x + tree.crown + 4,
        z = tree.z;
      const size = chunk.n * chunk.cell;
      if (x < chunk.x0 + 4 || x > chunk.x0 + size - 4 || z < chunk.z0 + 4 || z > chunk.z0 + size - 4)
        continue;
      if (!lifeGround(w, x, z, 3) || chunk.trees.some((t) => Math.hypot(t.x - x, t.z - z) < t.crown + 3.3))
        continue;
      add('bat', x, z, 1 + (forestSeed % 2));
      break;
    }
  }
  if (chunk.hasWater) {
    // Pick a dry shore cell sharing an edge with water; never place a frog in midstream.
    const { n, heights, cell } = chunk;
    const start = hashAt(w.seed, 'bank', cx, cz) % heights.length;
    const shells = chunk.sources.find((s) => PIGMENT_SOURCES[s.kind]?.key === 'shells');
    let frogPlaced = false;
    let crabBank: { x: number; z: number; distance: number } | undefined;
    for (let j = 0; j < heights.length; j++) {
      const i = (start + j) % heights.length,
        col = i % n,
        row = Math.floor(i / n);
      if (col === 0 || col === n - 1 || row === 0 || row === n - 1) continue;
      if (heights[i]! < WATER_LEVEL + 0.1 || heights[i]! > WATER_LEVEL + 1.6) continue;
      if (![i - 1, i + 1, i - n, i + n].some((k) => heights[k]! < WATER_LEVEL)) continue;
      const x = chunk.x0 + (col + 0.5) * cell,
        z = chunk.z0 + (row + 0.5) * cell;
      if (w.townAt(x, z, 3) || pathsOf(w).bridgeAt(x, z)) continue;
      if (!frogPlaced) {
        add('frog', x, z, 1 + (start % 2));
        // A second, dry cell inland leaves the amphibians the water's edge.
        for (const k of [i - n, i + n, i - 1, i + 1]) {
          const px = chunk.x0 + ((k % n) + 0.5) * cell,
            pz = chunk.z0 + (Math.floor(k / n) + 0.5) * cell;
          if (heights[k]! > WATER_LEVEL + 2.4 || !lifeGround(w, px, pz, 1) || pathsOf(w).bridgeAt(px, pz))
            continue;
          add('penguin', px, pz, 2);
          break;
        }
        frogPlaced = true;
        if (!shells) break;
      }
      if (shells && heights[i]! <= WATER_LEVEL + 0.9) {
        const distance = Math.hypot(x - shells.x, z - shells.z);
        if (distance < 20 && (!crabBank || distance < crabBank.distance)) crabBank = { x, z, distance };
      }
    }
    if (crabBank) add('crab', crabBank.x, crabBank.z, 1 + (start % 2));
  }
  return sites;
}

/** Flat, dry footing for an entire small group, not just its centre. */
export function lifeGround(w: Wilderness, x: number, z: number, radius = 5): boolean {
  const y = w.heightAt(x, z);
  if (y < WATER_LEVEL + 1 || w.townAt(x, z, 18)) return false;
  for (const [dx, dz] of [
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ]) {
    const h = w.heightAt(x + dx!, z + dz!);
    if (h < WATER_LEVEL + 0.6 || Math.abs(h - y) > radius * 0.3) return false;
  }
  return true;
}

/** Stable homes, independent of loading order and the viewer. Motion is local scenery. */
export function lifeInChunk(w: Wilderness, cx: number, cz: number): LifeSite[] {
  const size = TUNING.world.chunkSize;
  const seed = hashAt(w.seed, 'outdoor-life', cx, cz);
  const sites: LifeSite[] = [];
  const paths = pathsOf(w);
  if (unit(seed) < 0.8) {
    for (let a = 0; a < 12; a++) {
      const h = hashInts(seed, a, 1);
      const x = cx * size + 16 + unit(h) * (size - 32);
      const z = cz * size + 16 + unit(hashInts(h, 2)) * (size - 32);
      if (!lifeGround(w, x, z) || paths.edgeDistance(x, z) < 6) continue;
      const moisture = w.climate(x, z).moisture;
      const kind = moisture > 0.18 ? 'boar' : unit(hashInts(h, 3)) < 0.55 ? 'rabbit' : 'bird';
      sites.push({ id: `fauna:${cx},${cz}`, seed: h, x, z, kind, person: false, count: 2 + (h % 3) });
      break;
    }
  }
  // Along paths, but off the walking surface. One small outing per selected chunk.
  if (unit(hashInts(seed, 8)) < 0.65) {
    const trails = paths.trailsNear(cx * size, cz * size, (cx + 1) * size, (cz + 1) * size);
    for (const trail of trails) {
      for (let i = 2; i < trail.pts.length; i += 2) {
        const ax = trail.pts[i - 2]!,
          az = trail.pts[i - 1]!;
        const dx = trail.pts[i]! - ax,
          dz = trail.pts[i + 1]! - az;
        const length = Math.hypot(dx, dz);
        if (length < 1) continue;
        const h = hashInts(seed, i);
        const t = 0.2 + unit(h) * 0.6;
        const side = (h & 1 ? 1 : -1) * (trail.width / 2 + 5);
        const x = ax + dx * t - (dz / length) * side;
        const z = az + dz * t + (dx / length) * side;
        if (Math.floor(x / size) !== cx || Math.floor(z / size) !== cz) continue;
        if (!lifeGround(w, x, z, 7) || paths.bridgeAt(x, z)) continue;
        const kind = (['gatherer', 'ranger', 'walker'] as const)[h % 3]!;
        sites.push({ id: `outing:${cx},${cz}`, seed: h, x, z, kind, person: true, count: 1 });
        return sites;
      }
    }
  }
  return sites;
}
