// Things placed on a finished city skeleton: ink stains on the roads and one painting studio
// per chunk. Uses its own random stream, so tuning these never changes the buildings or the
// surface list (and never resets painting progress).
import { TUNING } from '@/content/tuning';
import { enemyIndex } from '@/content/enemies';
import { RESIDENT_NAMES } from '@/content/names';

const BLOT = enemyIndex('blot');
const SPITTER = enemyIndex('spitter');
import { hashInts } from '../math/hash';
import { Rng } from '../math/rng';
import { coloredRatio, type SurfaceInfo } from '../paint/surfaces';

export interface Stain {
  /** Metres, on a road. */
  readonly x: number;
  readonly z: number;
  readonly chunk: number;
  /** Visual radius in metres. */
  readonly size: number;
}

export interface StrongholdMonster {
  /** Index into ENEMIES. */
  readonly type: number;
  readonly x: number;
  readonly z: number;
  readonly chunk: number;
}

export interface ResidentHome {
  readonly building: number;
  readonly chunk: number;
  readonly name: string;
}

export interface Studio {
  readonly building: number;
  readonly chunk: number;
  /** Where the player stands to use it: just outside the door. */
  readonly door: { readonly x: number; readonly z: number };
}

/** The parts of a city that saves and patches are checked against. */
export interface CitySkeleton {
  /** Blocks per side. */
  readonly chunks: number;
  /** Where the city stands (see CityLayout). Saved flags are matched in the city's own metres,
   * so moving a city keeps its progress. */
  readonly ox?: number;
  readonly oz?: number;
  readonly surfaces: readonly SurfaceInfo[];
  readonly stains: readonly Stain[];
  readonly studios: readonly Studio[];
  /** Index of the studio that is open from the start (nearest the main gate), or -1. */
  readonly homeStudio: number;
  /** Monsters guarding each block. A block cannot be painted while any of its own stand. */
  readonly monsters: readonly StrongholdMonster[];
  readonly residents: readonly ResidentHome[];
}

interface FeatureInput {
  readonly seed: number;
  readonly n: number;
  /** Blocks per side. */
  readonly chunks: number;
  readonly cell: number;
  readonly roads: Uint8Array;
  /** River cells: no stains or guards there (the street over one is a bridge). */
  readonly water?: Uint8Array;
  readonly surfaces: readonly SurfaceInfo[];
  readonly buildings: readonly {
    readonly id: number;
    readonly x: number;
    readonly z: number;
    readonly hd: number;
    readonly angle: number;
    readonly roof: number;
  }[];
  readonly spawn: { readonly x: number; readonly z: number };
}

export function placeFeatures(c: FeatureInput): Omit<CitySkeleton, 'surfaces' | 'chunks'> {
  const { n, cell, roads } = c;
  const side = c.chunks;
  const chunkCells = n / side;
  const chunkOfCell = (ix: number, iz: number): number =>
    Math.min(side - 1, Math.floor(iz / chunkCells)) * side + Math.min(side - 1, Math.floor(ix / chunkCells));
  const rng = new Rng(hashInts(c.seed, 0x57a1));

  // ink stains: a fixed number of distinct road cells per chunk
  const roadCells: number[][] = Array.from({ length: side * side }, () => []);
  for (let iz = 2; iz < n - 2; iz++)
    for (let ix = 2; ix < n - 2; ix++)
      if (roads[iz * n + ix] !== 0 && !c.water?.[iz * n + ix])
        roadCells[chunkOfCell(ix, iz)]!.push(iz * n + ix);
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
  // strongholds: their own stream again, so changing monster tuning moves nothing else
  const mrng = new Rng(hashInts(c.seed, 0xe11e));
  const [lo, hi] =
    side <= TUNING.city.firstCityChunks ? TUNING.combat.stronghold.first : TUNING.combat.stronghold.other;
  const monsters: StrongholdMonster[] = [];
  roadCells.forEach((cells, chunk) => {
    if (!cells.length) return;
    const count = mrng.int(lo, hi);
    // gather around one post so a stronghold reads as a group
    const post = cells[Math.floor(mrng.next() * cells.length)]!;
    const near = cells
      .map((i) => ({ i, d: Math.hypot((i % n) - (post % n), Math.floor(i / n) - Math.floor(post / n)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(count * 3, 6));
    for (let k = 0; k < count; k++) {
      const i = near[Math.floor(mrng.next() * near.length)]!.i;
      monsters.push({
        type: mrng.chance(TUNING.combat.spitterChance) ? SPITTER : BLOT,
        x: ((i % n) + 0.5) * cell,
        z: (Math.floor(i / n) + 0.5) * cell,
        chunk,
      });
    }
  });
  // Preserve the original garrison slots outside the entry district.
  const spawnChunk = chunkOfCell(Math.floor(c.spawn.x / cell), Math.floor(c.spawn.z / cell));
  const residentsRng = new Rng(hashInts(c.seed, 0x5e95));
  const studioBuildings = new Set(studios.map((s) => s.building));
  const residents: ResidentHome[] = [];
  for (let chunk = 0; chunk < side * side; chunk++) {
    const homes = c.buildings.filter(
      (b) => c.surfaces[b.roof]!.chunk === chunk && !studioBuildings.has(b.id),
    );
    const want = residentsRng.int(1, 2);
    for (let k = 0; k < want && homes.length; k++) {
      const b = homes.splice(Math.floor(residentsRng.next() * homes.length), 1)[0]!;
      // Keep the stream aligned with existing worlds so the same people live in the same homes.
      for (let draw = 0; draw < 4; draw++) residentsRng.next();
      residents.push({ building: b.id, chunk, name: residentsRng.pick(RESIDENT_NAMES) });
    }
  }
  // Saved defeat bits address the original guards by index. Keep that prefix and fill
  // the remaining population with infected villagers on distinct, dry street cells.
  const guards = monsters.filter((m) => m.chunk !== spawnChunk);
  const density = new Rng(hashInts(c.seed, 0x7ede));
  const houses = c.buildings.length;
  const targetGuards = density.int(houses, Math.floor(houses * 1.5));
  const occupied = new Set(guards.map((m) => Math.floor(m.z / cell) * n + Math.floor(m.x / cell)));
  const streets = roadCells.flatMap((cells, chunk) => {
    if (side > 1 && chunk === spawnChunk) return [];
    return cells.filter(
      (i) =>
        !occupied.has(i) &&
        Math.hypot(((i % n) + 0.5) * cell - c.spawn.x, (Math.floor(i / n) + 0.5) * cell - c.spawn.z) > 12,
    );
  });
  guards.length = Math.min(guards.length, targetGuards);
  while (guards.length < targetGuards && streets.length) {
    const k = density.int(0, streets.length - 1);
    const i = streets[k]!;
    streets[k] = streets[streets.length - 1]!;
    streets.pop();
    const ix = i % n,
      iz = Math.floor(i / n);
    guards.push({
      x: (ix + 0.5) * cell,
      z: (iz + 0.5) * cell,
      chunk: chunkOfCell(ix, iz),
      type: density.chance(TUNING.combat.spitterChance) ? SPITTER : BLOT,
    });
  }

  // Populate households in rounds so people share houses without crowding a single doorway.
  const families = new Rng(hashInts(c.seed, 0x721c));
  const targetResidents = families.int(Math.ceil(houses * 1.2), Math.floor(houses * 2.1));
  const occupiedHomes = new Set(residents.map((r) => r.building));
  let homes = c.buildings.filter((b) => !studioBuildings.has(b.id));
  if (!homes.length) homes = [...c.buildings];
  let available = homes.filter((b) => !occupiedHomes.has(b.id));
  while (residents.length < targetResidents) {
    if (!available.length) available = [...homes];
    const k = families.int(0, available.length - 1);
    const b = available[k]!;
    available[k] = available[available.length - 1]!;
    available.pop();
    residents.push({ building: b.id, chunk: c.surfaces[b.roof]!.chunk, name: families.pick(RESIDENT_NAMES) });
  }
  return { stains, studios, homeStudio, monsters: guards, residents };
}

/** A point `out` metres in front of a building's door (the middle of its front, which faces
 * (sin angle, cos angle)). */
export function doorFront(
  b: { readonly x: number; readonly z: number; readonly hd: number; readonly angle: number },
  out: number,
): { x: number; z: number } {
  return { x: b.x + Math.sin(b.angle) * (b.hd + out), z: b.z + Math.cos(b.angle) * (b.hd + out) };
}

/** Whether a studio can be used: the home studio always, others once their chunk has colour. */
export function studioOpen(skel: CitySkeleton, states: Uint8Array, index: number): boolean {
  const s = skel.studios[index];
  if (!s) return false;
  if (index === skel.homeStudio) return true;
  return coloredRatio(states, skel.surfaces, s.chunk) >= TUNING.blocks.coloredAt;
}

/** Identifies a stain list so saved stain flags are dropped when the stains move. */
export function stainFingerprint(stains: readonly Stain[], ox = 0, oz = 0): number {
  let f = hashInts(0x57a1, stains.length);
  for (const s of stains) f = hashInts(f, Math.round((s.x - ox) * 10), Math.round((s.z - oz) * 10));
  return f;
}

/** Identifies a monster list so saved defeat flags are dropped when strongholds move. */
export function monsterFingerprint(monsters: readonly StrongholdMonster[], ox = 0, oz = 0): number {
  let f = hashInts(0xe11e, monsters.length);
  for (const m of monsters) f = hashInts(f, m.type, Math.round((m.x - ox) * 10), Math.round((m.z - oz) * 10));
  return f;
}

/** Monsters of a block's stronghold that are still standing. */
export function standingMonsters(skel: CitySkeleton, defeated: Uint8Array, chunk: number): number[] {
  return skel.monsters.flatMap((m, i) => (m.chunk === chunk && !defeated[i] ? [i] : []));
}
