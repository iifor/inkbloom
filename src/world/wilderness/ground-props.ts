import { BIOMES } from '@/content/biomes';
import { TUNING } from '@/content/tuning';
import { hashAt } from '../math/hash';
import { Rng } from '../math/rng';
import type { Tree } from './chunk';
import { WATER_LEVEL, type Wilderness } from './generator';
import { pathsOf } from './paths';

export type GroundPropKind = 'outcrop' | 'mossRock' | 'windfall' | 'stump' | 'shingle' | 'driftwood';
export interface GroundProp {
  kind: GroundPropKind;
  seed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Rise from the near end of the trunk to the far end. */
  rise: number;
}

export function groundPropsInChunk(
  w: Wilderness,
  cx: number,
  cz: number,
  trees: readonly Tree[],
  clear: (x: number, z: number) => boolean,
): GroundProp[] {
  const size = TUNING.world.chunkSize;
  const props: GroundProp[] = [];
  const paths = pathsOf(w);
  for (let iz = 0; iz < 4; iz++)
    for (let ix = 0; ix < 4; ix++) {
      const seed = hashAt(w.seed, 'ground-prop', cx * 4 + ix, cz * 4 + iz);
      const rng = new Rng(seed);
      if (!rng.chance(0.58)) continue;
      const x = (cx + (ix + rng.range(0.17, 0.83)) / 4) * size;
      const z = (cz + (iz + rng.range(0.17, 0.83)) / 4) * size;
      const y = w.heightAt(x, z);
      if (y < WATER_LEVEL - 0.12 || w.townAt(x, z, 6) || !clear(x, z)) continue;
      const road = paths.edgeDistance(x, z);
      if (road < 5 || trees.some((t) => Math.hypot(x - t.x, z - t.z) < (t.kind === 'great' ? 12 : 4)))
        continue;
      const nearWater =
        y < WATER_LEVEL + 2 &&
        [
          [8, 0],
          [-8, 0],
          [0, 8],
          [0, -8],
        ].some(([dx, dz]) => w.heightAt(x + dx!, z + dz!) < WATER_LEVEL);
      const biome = BIOMES[w.biomeAt(x, z)]!.key;
      const wooded = biome === 'forest' || trees.some((t) => Math.hypot(x - t.x, z - t.z) < 10);
      let kind: GroundPropKind;
      if (nearWater) kind = rng.chance(0.65) ? 'shingle' : 'driftwood';
      else if (y < WATER_LEVEL + 0.2) continue;
      else if (road < 25 && rng.chance(wooded ? 0.5 : 0.25)) kind = 'stump';
      else if (wooded) kind = rng.chance(0.48) ? 'windfall' : 'mossRock';
      else kind = 'outcrop';
      const scale = rng.range(0.72, 1.28);
      let yaw = rng.range(0, Math.PI * 2);
      if (kind === 'driftwood') {
        // Follow the bank contour; windfalls inland can point in any direction.
        const dx = w.heightAt(x + 2, z) - w.heightAt(x - 2, z);
        const dz = w.heightAt(x, z + 2) - w.heightAt(x, z - 2);
        yaw = Math.atan2(dz, -dx) + rng.range(-0.3, 0.3);
      }
      let rise = 0,
        base = y;
      if (kind === 'windfall' || kind === 'driftwood') {
        const dx = Math.sin(yaw) * 1.8 * scale,
          dz = Math.cos(yaw) * 1.8 * scale;
        const a = w.heightAt(x - dx, z - dz),
          b = w.heightAt(x + dx, z + dz);
        rise = b - a;
        base = (a + b) / 2;
        if (Math.abs(rise) > 1.4 || Math.abs(base - y) > 0.23 || Math.min(a, b) < WATER_LEVEL - 0.18)
          continue;
      }
      props.push({ kind, seed, x, y: base, z, yaw, scale, rise });
    }
  return props;
}

/** Solid inner footprint, in the same local frame as the mesh (length along z). */
export function propFootprint(p: GroundProp) {
  const s = p.scale;
  switch (p.kind) {
    case 'windfall':
    case 'driftwood':
      return { hw: 0.25 * s, hd: 1.78 * s };
    case 'outcrop':
    case 'mossRock':
      return { hw: 1.03 * s, hd: 0.77 * s };
    case 'stump':
      return { hw: 0.37 * s, hd: 0.37 * s };
    case 'shingle':
      return null;
  }
}
