// Things placed on a finished city skeleton: ink stains on the roads and one painting studio
// per chunk. Uses its own random stream, so tuning these never changes the buildings or the
// surface list (and never resets painting progress).
import { TUNING } from '@/content/tuning';
import { hashInts } from '../math/hash';
import { Rng } from '../math/rng';
import { coloredRatio, type SurfaceInfo } from '../paint/surfaces';

export interface Stain {
  /** Metres, city-local, on a road. */
  readonly x: number;
  readonly z: number;
  readonly chunk: number;
  /** Visual radius in metres. */
  readonly size: number;
}

export interface Studio {
  readonly building: number;
  readonly chunk: number;
  /** Where the player stands to use it: just outside the door. */
  readonly door: { readonly x: number; readonly z: number };
}

/** The parts of a city that saves and patches are checked against. */
export interface CitySkeleton {
  readonly surfaces: readonly SurfaceInfo[];
  readonly stains: readonly Stain[];
  readonly studios: readonly Studio[];
  /** Index of the studio that is open from the start (nearest the main gate), or -1. */
  readonly homeStudio: number;
}

interface FeatureInput {
  readonly seed: number;
  readonly n: number;
  readonly cell: number;
  readonly roads: Uint8Array;
  readonly surfaces: readonly SurfaceInfo[];
  readonly buildings: readonly {
    readonly id: number;
    readonly x0: number;
    readonly z0: number;
    readonly x1: number;
    readonly z1: number;
    readonly doorFace: 'px' | 'nx' | 'pz' | 'nz';
    readonly doorAt: number;
    readonly roof: number;
  }[];
  readonly spawn: { readonly x: number; readonly z: number };
}

export function placeFeatures(c: FeatureInput): Omit<CitySkeleton, 'surfaces'> {
  const { n, cell, roads } = c;
  const side = TUNING.city.chunks;
  const chunkCells = n / side;
  const chunkOfCell = (ix: number, iz: number): number =>
    Math.min(side - 1, Math.floor(iz / chunkCells)) * side + Math.min(side - 1, Math.floor(ix / chunkCells));
  const rng = new Rng(hashInts(c.seed, 0x57a1));

  // ink stains: a fixed number of distinct road cells per chunk
  const roadCells: number[][] = Array.from({ length: side * side }, () => []);
  for (let iz = 2; iz < n - 2; iz++)
    for (let ix = 2; ix < n - 2; ix++)
      if (roads[iz * n + ix] !== 0) roadCells[chunkOfCell(ix, iz)]!.push(iz * n + ix);
  const stains: Stain[] = [];
  roadCells.forEach((cells, chunk) => {
    const pool = [...cells];
    for (let k = 0; k < TUNING.economy.stainsPerChunk && pool.length; k++) {
      const i = pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!;
      const ix = i % n;
      const iz = (i - ix) / n;
      stains.push({
        x: (ix + 0.2 + 0.6 * rng.next()) * cell,
        z: (iz + 0.2 + 0.6 * rng.next()) * cell,
        chunk,
        size: 0.8 + 0.7 * rng.next(),
      });
    }
  });

  // studios: per chunk, the building whose door is nearest the chunk centre
  const per = (n * cell) / side;
  const studios: Studio[] = [];
  for (let chunk = 0; chunk < side * side; chunk++) {
    const ccx = ((chunk % side) + 0.5) * per;
    const ccz = (Math.floor(chunk / side) + 0.5) * per;
    let best: Studio | null = null;
    let bestD = Infinity;
    for (const b of c.buildings) {
      if (c.surfaces[b.roof]!.chunk !== chunk) continue;
      const door = doorFront(b, 1.6);
      const d = Math.hypot(door.x - ccx, door.z - ccz);
      if (d < bestD) {
        bestD = d;
        best = { building: b.id, chunk, door };
      }
    }
    if (best) studios.push(best);
  }
  let homeStudio = -1;
  let homeD = Infinity;
  studios.forEach((s, i) => {
    const d = Math.hypot(s.door.x - c.spawn.x, s.door.z - c.spawn.z);
    if (d < homeD) {
      homeD = d;
      homeStudio = i;
    }
  });
  return { stains, studios, homeStudio };
}

/** A point `out` metres in front of a building's door. */
export function doorFront(
  b: { x0: number; z0: number; x1: number; z1: number; doorFace: 'px' | 'nx' | 'pz' | 'nz'; doorAt: number },
  out: number,
): { x: number; z: number } {
  switch (b.doorFace) {
    case 'px':
      return { x: b.x1 + out, z: b.doorAt };
    case 'nx':
      return { x: b.x0 - out, z: b.doorAt };
    case 'pz':
      return { x: b.doorAt, z: b.z1 + out };
    case 'nz':
      return { x: b.doorAt, z: b.z0 - out };
  }
}

/** Whether a studio can be used: the home studio always, others once their chunk has colour. */
export function studioOpen(skel: CitySkeleton, states: Uint8Array, index: number): boolean {
  const s = skel.studios[index];
  if (!s) return false;
  if (index === skel.homeStudio) return true;
  return coloredRatio(states, skel.surfaces, s.chunk) >= TUNING.blocks.coloredAt;
}

/** Identifies a stain list so saved stain flags are dropped when the stains move. */
export function stainFingerprint(stains: readonly Stain[]): number {
  let f = hashInts(0x57a1, stains.length);
  for (const s of stains) f = hashInts(f, Math.round(s.x * 10), Math.round(s.z * 10));
  return f;
}
