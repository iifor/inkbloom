import { BIOMES } from '@/content/biomes';
import type { Vec3 } from '@/engine/audio/synth';
import { hashAt, hashInts, unit } from '@/world/math/hash';
import { smoothstep } from '@/world/math/noise';
import { type Wilderness, WATER_LEVEL } from '@/world/wilderness/generator';
import { CURRENT_STEP, currentSound, waterCurrentsOf } from '@/world/wilderness/water-current';

const CELL = 48;
const CACHE_LIMIT = 192;
export const HEARING_RANGE = 88;

export type AmbienceSite = {
  readonly pos: Vec3;
} & ({ readonly kind: 'forest' | 'meadow' | 'water' } |
  { readonly kind: 'current'; readonly strength: number });

export class AmbienceSites {
  private readonly cache = new Map<string, readonly AmbienceSite[]>();

  constructor(private readonly world: Wilderness) {}

  near(x: number, z: number): AmbienceSite[] {
    const sites: AmbienceSite[] = [];
    for (let cx = Math.floor((x - HEARING_RANGE) / CELL); cx <= Math.floor((x + HEARING_RANGE) / CELL); cx++)
      for (
        let cz = Math.floor((z - HEARING_RANGE) / CELL);
        cz <= Math.floor((z + HEARING_RANGE) / CELL);
        cz++
      )
        sites.push(...this.inCell(cx, cz));
    return sites;
  }

  private inCell(cx: number, cz: number): readonly AmbienceSite[] {
    const key = `${cx},${cz}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const w = this.world;
    const roll = hashAt(w.seed, 'ambience-site', cx, cz);
    const x0 = cx * CELL,
      z0 = cz * CELL;
    const x = x0 + CELL * (0.16 + unit(roll) * 0.68);
    const z = z0 + CELL * (0.16 + unit(hashInts(roll, 1)) * 0.68);
    const y = w.terrainHeightAt(x, z);
    const kind = BIOMES[w.biomeAt(x, z)]?.key === 'forest' ? 'forest' : 'meadow';
    const sites: AmbienceSite[] = [];
    if (y > WATER_LEVEL + 0.3 && (kind === 'forest' || unit(hashInts(roll, 2)) < 0.64))
      sites.push({ kind, pos: { x, y, z } });

    // Probe the actual terrain so narrow streams and lakes both get sources at their banks.
    // Stagger the survey slightly to avoid lining the audio sources up on the terrain grid.
    let wet: Vec3 | undefined;
    let dry: Vec3 | undefined;
    let span = 25;
    const probes: Vec3[] = [];
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const px = x0 + 7 + i * 11 + (unit(hashInts(roll, 10 + i, j)) - 0.5) * 5;
        const pz = z0 + 7 + j * 11 + (unit(hashInts(roll, 11 + j, i)) - 0.5) * 5;
        const py = w.terrainHeightAt(px, pz);
        const p = { x: px, y: py, z: pz };
        for (const q of probes) {
          if (
            (py < WATER_LEVEL - 0.15 && q.y > WATER_LEVEL) ||
            (q.y < WATER_LEVEL - 0.15 && py > WATER_LEVEL)
          ) {
            const d = Math.hypot(px - q.x, pz - q.z);
            if (d < span) {
              [wet, dry] = py < WATER_LEVEL ? [p, q] : [q, p];
              span = d;
            }
          }
        }
        probes.push(p);
      }
    if (wet && dry) {
      // Approach the shoreline from both sides and place the source above the water.
      let shore: Vec3 = wet;
      let bank: Vec3 = dry;
      for (let i = 0; i < 5; i++) {
        const px = (shore.x + bank.x) / 2,
          pz = (shore.z + bank.z) / 2;
        const point = { x: px, y: w.terrainHeightAt(px, pz), z: pz };
        if (point.y < WATER_LEVEL) shore = point;
        else bank = point;
      }
      sites.push({ kind: 'water', pos: { x: shore.x, y: WATER_LEVEL + 0.16, z: shore.z } });
    }
    // A current has its own fixed emitter in the channel. A pond's shore can host
    // wildlife with no running-water emitter. Cells with entirely wet probes can
    // still host an emitter, for example in the middle of a wide river.
    const currents = waterCurrentsOf(w);
    const middle = CELL / 2;
    let current: AmbienceSite | undefined;
    let best = 0;
    for (let dz = 0; dz < CELL; dz += CURRENT_STEP)
      for (let dx = 0; dx < CELL; dx += CURRENT_STEP) {
        const px = x0 + dx, pz = z0 + dz;
        const v = currents.at(px, pz);
        const strength = currentSound(Math.hypot(v.x, v.z));
        const score = strength * (1 - Math.hypot(dx - middle, dz - middle) / (CELL * 2));
        if (score <= best) continue;
        best = score;
        current = { kind: 'current', pos: { x: px, y: WATER_LEVEL + 0.16, z: pz }, strength };
      }
    if (current) sites.push(current);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, sites);
    return sites;
  }
}

/** Web Audio's inverse-distance model, with a smooth outer fade to silence. */
export function ambienceGain(distance: number, near: number, far: number): number {
  const gain = near / Math.max(near, distance);
  return gain * (1 - smoothstep(far * 0.62, far, distance));
}
