// Step 5 of a town's layout: the land left over between the streets becomes yards, paintable
// ground cut into patches per district, with trees spread over them and, near the square, the
// town's great old tree.
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { hashInts } from '../math/hash';
import { Rng } from '../math/rng';
import type { Tree } from '../wilderness/chunk';
import type { Square } from './gates';
import type { Building } from './houses';
import { DX, DZ, ROAD_NONE, type Site } from './site';

/** Yard trees stand at least this far apart, metres. */
const TREE_SPACING = 9;
/** The town's great old tree near the square: its height and spread, metres. */
const TOWN_GREAT = { height: 14, crown: 7 } as const;

/** Open land between the streets, one region per district so no yard spans two of them.
 * `blockOf` is the yard region id + 1 per cell (0 = street or wall), `groundOf` its paintable
 * ground surface or -1. */
export function fillYards(
  site: Site,
  roads: Uint8Array,
  buildingOf: Uint16Array,
): { blockOf: Uint16Array; groundOf: Int32Array } {
  const { n, cell, rng, idx, inside, water } = site;
  const blockOf = new Uint16Array(n * n);
  const groundOf = new Int32Array(n * n).fill(-1);
  const district = (i: number): number =>
    site.chunkOf(((i % n) + 0.5) * cell, (Math.floor(i / n) + 0.5) * cell);
  const yardColors = [color('grass'), color('sand'), color('green')];
  let regions = 0;
  for (let i0 = 0; i0 < n * n; i0++) {
    if (blockOf[i0] !== 0 || roads[i0] !== ROAD_NONE || water[i0] || !inside(i0 % n, Math.floor(i0 / n)))
      continue;
    const region = ++regions;
    const cells: number[] = [];
    const stack = [i0];
    blockOf[i0] = region;
    while (stack.length) {
      const j = stack.pop()!;
      cells.push(j);
      const x = j % n;
      const z = (j - x) / n;
      for (let d = 0; d < 4; d++) {
        const x2 = x + DX[d]!;
        const z2 = z + DZ[d]!;
        if (!inside(x2, z2)) continue;
        const k = idx(x2, z2);
        if (roads[k] === ROAD_NONE && !water[k] && blockOf[k] === 0 && district(k) === district(j)) {
          blockOf[k] = region;
          stack.push(k);
        }
      }
    }
    // the open part, cut into patches, each its own surface
    const patches = new Map<number, number[]>();
    for (const j of cells) {
      if (buildingOf[j] !== 0) continue;
      const key =
        Math.floor((j % n) / TUNING.city.yardPatch) * 1000 +
        Math.floor(Math.floor(j / n) / TUNING.city.yardPatch);
      let list = patches.get(key);
      if (!list) patches.set(key, (list = []));
      list.push(j);
    }
    const yardColor = rng.pick(yardColors);
    for (const key of [...patches.keys()].sort((a, b) => a - b)) {
      const list = patches.get(key)!;
      // a sliver left between houses stays plain ground
      if (list.length < 3) continue;
      let sx = 0;
      let sz = 0;
      for (const j of list) {
        sx += ((j % n) + 0.5) * cell;
        sz += (Math.floor(j / n) + 0.5) * cell;
      }
      const surface = site.addSurface(
        'ground',
        district(list[0]!),
        yardColor,
        list.length * cell * cell,
        sx / list.length,
        sz / list.length,
      );
      for (const j of list) groundOf[j] = surface;
    }
  }
  return { blockOf, groundOf };
}

/** Trees in the yards, spread out evenly (Poisson-disk: a dart lands only where no tree is
 * within the spacing), clear of houses, streets and the river; the one nearest the square with
 * room to spread becomes the town's great old tree. */
export function plantYardTrees(
  site: Site,
  roads: Uint8Array,
  blockOf: Uint16Array,
  buildingOf: Uint16Array,
  buildings: readonly Building[],
  square: Square,
): Tree[] {
  const { n, cell, size, idx } = site;
  const trees: Tree[] = [];
  const treeRng = new Rng(hashInts(site.seed, 0x7ee5));
  const spacing2 = TREE_SPACING * TREE_SPACING;
  for (let tries = 0; tries < ((size * size) / spacing2) * 2; tries++) {
    const x = treeRng.range(cell, size - cell);
    const z = treeRng.range(cell, size - cell);
    const ix = Math.floor(x / cell);
    const iz = Math.floor(z / cell);
    if (blockOf[idx(ix, iz)] === 0 || site.nearWater(ix, iz, 1)) continue;
    // a cell clear of houses and streets all round
    let clear = true;
    for (let dz = -1; dz <= 1 && clear; dz++)
      for (let dx = -1; dx <= 1 && clear; dx++) {
        const j = idx(Math.min(n - 1, Math.max(0, ix + dx)), Math.min(n - 1, Math.max(0, iz + dz)));
        if (buildingOf[j] !== 0 || roads[j] !== ROAD_NONE) clear = false;
      }
    if (!clear || trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < spacing2)) continue;
    if (!treeRng.chance(0.55)) continue;
    trees.push({
      x,
      z,
      y: site.ground(x, z) - 0.2,
      height: treeRng.range(4.5, 7.5),
      crown: treeRng.range(1.5, 2.4),
      color: treeRng.chance(0.6) ? color('leaf') : color('canopy'),
    });
  }

  // the yard tree nearest the square with room to spread becomes the town's great old tree
  let greatAt = -1;
  let greatD = Infinity;
  trees.forEach((t, i) => {
    const d = Math.hypot(t.x - square.x, t.z - square.z);
    if (d >= greatD || d < square.r + TOWN_GREAT.crown) return;
    const room = buildings.every(
      (b) => Math.hypot(b.x - t.x, b.z - t.z) - Math.hypot(b.hw, b.hd) > TOWN_GREAT.crown - 1,
    );
    if (!room) return;
    greatAt = i;
    greatD = d;
  });
  if (greatAt >= 0) {
    const t = trees[greatAt]!;
    // its spread takes the place of the yard trees under it
    for (let i = trees.length - 1; i >= 0; i--)
      if (i !== greatAt && Math.hypot(trees[i]!.x - t.x, trees[i]!.z - t.z) < TOWN_GREAT.crown + 2)
        trees.splice(i, 1);
    trees[trees.indexOf(t)] = { ...t, height: TOWN_GREAT.height, crown: TOWN_GREAT.crown, kind: 'great' };
  }
  return trees;
}
