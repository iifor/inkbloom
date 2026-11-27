// Everything about a world that is saved. Generated content (terrain, city skeletons) is not
// here because it is recomputed from the seed. Change this file only together with a bump of
// SAVE_VERSION and a note in docs/EXTENDING.md.
import { validTravelLeg, type TravelLeg } from './wilderness/travellers';
import { PALETTE, PAINTABLE, color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { BRUSH_TIERS } from '@/content/brush-tiers';
import { WEAPONS } from '@/content/weapons';
import { ORIGINAL, surfaceFingerprint } from './paint/surfaces';
import { startsPeaceful } from './city/origin';
import { type Growth, createGrowth, validGrowth } from './progression';
import { type CitySkeleton, monsterFingerprint, stainFingerprint } from './city/features';

import { TERRAIN_VERSION, type TerrainVersion } from './wilderness/terrain-version';

import { type InkSite, type InfectedPerson, validInkSite } from './infection';

export const SAVE_VERSION = 13;

export type SceneRef = { readonly kind: 'wild' } | { readonly kind: 'city'; readonly id: string };

export interface Inventory {
  /** Pigment, the one paint: the restore brush and the graffiti brush both spend it (the
   * crayons in `unlocked` decide which colours graffiti can be). */
  generic: number;
  /** Raw ink, refined into generic pigment at a studio. */
  ink: number;
  /** Index into BRUSH_TIERS. */
  brushTier: number;
  /** The paper plane, earned by restoring a first city. */
  glider: boolean;
  /** Weapon keys owned, in the order they were earned. */
  weapons: string[];
}

/** A teleport mark planted in the wilderness. */
export interface InkMark {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface PlayerSave {
  scene: SceneRef;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface WorldState {
  readonly version: typeof SAVE_VERSION;
  readonly id: string;
  readonly seed: number;
  readonly terrainVersion: TerrainVersion;
  name: string;
  inventory: Inventory;
  /** Palette indices the player can graffiti with. */
  unlocked: number[];
  /** Per-city surface states, created when a city is first entered. */
  cities: Map<string, CitySave>;
  travellerMemorySince: number;
  travellerLegs: Map<string, TravelLeg>;
  /** Pre-v4 towns retain the original 2/5-block footprints across clients and workers. */
  legacyTowns: string[];
  player: PlayerSave | null;
  /** Seconds of play in this world. Cooldowns use this, so nothing grows while offline. */
  clock: number;
  /** Extra environment seconds accumulated by time acceleration; never used for cooldowns. */
  calendarOffset: number;
  /** Wilderness source id -> clock time it was last harvested. */
  infectedAt: InkSite | null;
  infectedPeople: Map<string, InfectedPerson>;
  inkAreas: Map<string, InkSite>;
  harvested: Map<string, number>;
  /** At most one drop at a time; dying again loses the old one. */
  drop: InkDrop | null;
  /** Wilderness monster id -> clock time it was defeated. */
  hunted: Map<string, number>;
  /** Ink well id -> clock time it was cleansed (for good: it never seeps again). */
  cleansed: Map<string, number>;
  growth: Growth;
  /** Ruins already found, by id. */
  discovered: string[];
  marks: InkMark[];
  /** Counter for mark ids. */
  nextMark: number;
}

export interface CitySave {
  /** surfaceFingerprint of the skeleton the states belong to; null for v1 saves. */
  fingerprint: number | null;
  states: Uint8Array;
  /** stainFingerprint of the stain list `stains` belongs to. */
  stainFingerprint: number | null;
  /** 1 per ink stain already soaked up. */
  stains: Uint8Array;
  /** Liberated through its altar or through colouring every block; restored for good. */
  completed: boolean;
  /** World play time of the first restoration, shared by all returning households. */
  restoredAt: number | null;
  /** Naturally unpolluted, not a restoration by the player. False for existing v1/v2 towns. */
  peaceful: boolean;
  /** monsterFingerprint of the stronghold list `defeated` belongs to. */
  monsterFingerprint: number | null;
  /** 1 per stronghold monster already defeated. */
  defeated: Uint8Array;
  /** Bit per defeated altar garrison guard; separate from the unchanged street-guard list. */
  altarGuards?: number;
  /** 1 per block that has ever been coloured (pays its experience and milestones once). */
  coloredOnce: Uint8Array;
  /** Per block: clock time its studio stock counts from once 繁荣, or -1. */
  stockFrom: number[];
  /** The city's ink tide timers. Written in place by the tide every frame it runs. */
  tide: TideSave;
}

/**
 * An ink tide's timers, as seconds of play in this city still to go. Counting down only while
 * the player is in the city means a tide waits (rather than resolving) while they are away.
 */
export interface TideSave {
  /** Until the next wave is announced (when none is under way). */
  nextIn: number;
  wave: TideWaveSave | null;
}

export interface TideWaveSave {
  chunk: number;
  /** Side it enters through, 0..3. */
  from: number;
  /** Until the curtain starts moving; 0 once it has. */
  startsIn: number;
  /** Until the wave ends. */
  endsIn: number;
  /** Metres the curtain has advanced into the block. */
  front: number;
}

export const newTide = (): TideSave => ({ nextIn: TUNING.tide.firstDelay, wave: null });

function validTide(t: unknown): TideSave {
  const j = t as { n?: unknown; w?: unknown[] } | null | undefined;
  const nextIn = typeof j?.n === 'number' && Number.isFinite(j.n) ? Math.max(0, j.n) : TUNING.tide.firstDelay;
  const w =
    Array.isArray(j?.w) && j.w.length === 5 && j.w.every((x) => typeof x === 'number' && Number.isFinite(x))
      ? (j.w as number[])
      : null;
  return {
    nextIn,
    wave: w
      ? {
          chunk: w[0]! | 0,
          from: w[1]! | 0,
          startsIn: Math.max(0, w[2]!),
          endsIn: Math.max(0, w[3]!),
          front: Math.max(0, w[4]!),
        }
      : null,
  };
}

/** Ink dropped on death, waiting where the player fell. */
export interface InkDrop {
  scene: SceneRef;
  x: number;
  y: number;
  z: number;
  ink: number;
}

export const STARTING_COLORS = [color('red'), color('blue'), color('yellow'), color('green')];

export function createWorldState(id: string, seed: number, name = '新世界'): WorldState {
  return {
    version: SAVE_VERSION,
    terrainVersion: TERRAIN_VERSION,
    id,
    seed,
    name,
    inventory: {
      generic: TUNING.brush.startingGeneric,
      ink: 0,
      brushTier: 0,
      glider: false,
      weapons: WEAPONS.filter((w) => w.unlock.kind === 'start').map((w) => w.key),
    },
    unlocked: [...STARTING_COLORS],
    cities: new Map(),
    travellerMemorySince: 0,
    travellerLegs: new Map(),
    legacyTowns: [],
    player: null,
    clock: 0,
    calendarOffset: 0,
    infectedAt: null,
    infectedPeople: new Map(),
    inkAreas: new Map(),
    harvested: new Map(),
    drop: null,
    hunted: new Map(),
    cleansed: new Map(),
    growth: createGrowth(),
    discovered: [],
    marks: [],
    nextMark: 1,
  };
}

/**
 * Saved state for a city, created according to its origin on first use. Surface states and stain flags
 * are each checked against the skeleton they were made for: when generator code or content
 * changed a list, that part is replaced with a fresh array. `reset` reports a surface reset
 * (lost painting progress) so the caller can tell the player; stain resets are silent.
 */
export function cityStates(
  state: WorldState,
  cityId: string,
  skel: CitySkeleton,
): {
  states: Uint8Array;
  stains: Uint8Array;
  defeated: Uint8Array;
  coloredOnce: Uint8Array;
  tide: TideSave;
  reset: boolean;
} {
  const fingerprint = surfaceFingerprint(skel.surfaces);
  const stainFp = stainFingerprint(skel.stains, skel.ox, skel.oz);
  const monsterFp = monsterFingerprint(skel.monsters, skel.ox, skel.oz);
  let saved = state.cities.get(cityId);
  let reset = false;
  if (saved) {
    // v1 saves carry no fingerprint: adopt them when the surface count still matches
    if (saved.fingerprint === null && saved.states.length === skel.surfaces.length)
      saved.fingerprint = fingerprint;
    if (saved.fingerprint !== fingerprint) {
      saved.fingerprint = fingerprint;
      saved.states = new Uint8Array(skel.surfaces.length).fill(saved.peaceful ? ORIGINAL : 0);
      saved.completed = false;
      saved.altarGuards = 0;
      saved.restoredAt = null;
      saved.coloredOnce = new Uint8Array(skel.chunks * skel.chunks).fill(saved.peaceful ? 1 : 0);
      saved.stockFrom = new Array<number>(skel.chunks * skel.chunks).fill(-1);
      // block numbers may mean other blocks now
      saved.tide = newTide();
      reset = true;
    }
  } else {
    const peaceful = startsPeaceful(state.seed, cityId);
    saved = {
      fingerprint,
      states: new Uint8Array(skel.surfaces.length).fill(peaceful ? ORIGINAL : 0),
      stainFingerprint: stainFp,
      stains: new Uint8Array(skel.stains.length).fill(peaceful ? 1 : 0),
      completed: false,
      restoredAt: null,
      peaceful,
      monsterFingerprint: monsterFp,
      defeated: new Uint8Array(skel.monsters.length).fill(peaceful ? 1 : 0),
      altarGuards: 0,
      coloredOnce: new Uint8Array(skel.chunks * skel.chunks).fill(peaceful ? 1 : 0),
      stockFrom: new Array<number>(skel.chunks * skel.chunks).fill(-1),
      tide: newTide(),
    };
    state.cities.set(cityId, saved);
  }
  if (saved.stainFingerprint !== stainFp) {
    saved.stainFingerprint = stainFp;
    saved.stains = new Uint8Array(skel.stains.length).fill(saved.peaceful ? 1 : 0);
  }
  if (saved.monsterFingerprint !== monsterFp) {
    const previous = saved.defeated;
    const defeated = new Uint8Array(skel.monsters.length).fill(saved.peaceful ? 1 : 0);
    if (
      previous.length < defeated.length &&
      saved.monsterFingerprint ===
        monsterFingerprint(skel.monsters.slice(0, previous.length), skel.ox, skel.oz)
    ) {
      defeated.set(previous);
      const cleared = new Set(skel.monsters.slice(0, previous.length).map((m) => m.chunk));
      for (let i = 0; i < previous.length; i++) if (!previous[i]) cleared.delete(skel.monsters[i]!.chunk);
      for (let i = previous.length; i < defeated.length; i++)
        defeated[i] =
          saved.peaceful ||
          saved.completed ||
          cleared.has(skel.monsters[i]!.chunk) ||
          saved.coloredOnce[skel.monsters[i]!.chunk] === 1
            ? 1
            : 0;
    }
    saved.monsterFingerprint = monsterFp;
    saved.defeated = defeated;
  }
  if (saved.stockFrom.length !== skel.chunks * skel.chunks)
    saved.stockFrom = new Array<number>(skel.chunks * skel.chunks).fill(-1);
  if (saved.coloredOnce.length !== skel.chunks * skel.chunks)
    saved.coloredOnce = new Uint8Array(skel.chunks * skel.chunks).fill(saved.peaceful ? 1 : 0);
  const w = saved.tide.wave;
  if (w && (w.chunk < 0 || w.chunk >= skel.chunks * skel.chunks || w.from < 0 || w.from > 3))
    saved.tide.wave = null;
  return {
    states: saved.states,
    stains: saved.stains,
    defeated: saved.defeated,
    coloredOnce: saved.coloredOnce,
    tide: saved.tide,
    reset,
  };
}

/** Whether a defeated wilderness monster has come back. */
export function wildMonsterBack(state: WorldState, id: string): boolean {
  const t = state.hunted.get(id);
  return t === undefined || state.clock - t >= TUNING.combat.wildRespawnSeconds;
}

/** Whether a wilderness source can be harvested now. */
export function sourceReady(state: WorldState, id: string): boolean {
  const t = state.harvested.get(id);
  return t === undefined || state.clock - t >= TUNING.economy.regrowSeconds;
}

/** A saved origin takes precedence, including an old village's explicit non-peaceful origin. */
export function peacefulVillage(state: WorldState, cityId: string): boolean {
  return state.cities.get(cityId)?.peaceful ?? startsPeaceful(state.seed, cityId);
}

/** Share of coloured surfaces; peaceful villages have no pollution even before their first visit. */
export function savedProgress(state: WorldState, cityId: string): number {
  const saved = state.cities.get(cityId);
  if (saved?.completed || peacefulVillage(state, cityId)) return 1;
  if (!saved || saved.states.length === 0) return 0;
  let colored = 0;
  for (const s of saved.states) if (s !== 0) colored++;
  return colored / saved.states.length;
}

// ---- serialisation ----------------------------------------------------------------------

interface WorldJson {
  terrainVersion?: TerrainVersion;
  legacyTowns?: string[];
  version: number;
  id: string;
  seed: number;
  name: string;
  /** `colored` (pigment per colour) only in saves from before pigment was one paint. */
  inventory: Inventory & { colored?: number[] };
  unlocked: number[];
  /** v2: { f, s, sf?, st? } (fingerprints and base64 bytes); v1: base64 states. */
  cities: Record<
    string,
    | {
        f: number;
        s: string;
        sf?: number;
        st?: string;
        c?: 1;
        restoredAt?: number;
        p?: 1;
        mf?: number;
        d?: string;
        ag?: number;
        co?: string;
        sk?: number[];
        /** Tide: n = nextIn, w = [chunk, from, startsIn, endsIn, front]. */
        td?: { n: number; w?: number[] };
      }
    | string
  >;
  player: PlayerSave | null;
  clock?: number;
  calendarOffset?: number;
  travellerMemorySince?: number;
  travellerLegs?: Record<string, TravelLeg>;
  harvested?: Record<string, number>;
  drop?: InkDrop | null;
  infectedAt?: InkSite | null;
  infectedPeople?: Record<string, InfectedPerson>;
  inkAreas?: Record<string, InkSite>;
  hunted?: Record<string, number>;
  cleansed?: Record<string, number>;
  growth?: Growth;
  discovered?: string[];
  marks?: InkMark[];
  nextMark?: number;
}

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
};
const fromBase64 = (text: string): Uint8Array => {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export function serializeWorld(state: WorldState): string {
  const json: WorldJson = {
    version: state.version,
    terrainVersion: state.terrainVersion,
    id: state.id,
    seed: state.seed,
    name: state.name,
    inventory: state.inventory,
    unlocked: state.unlocked,
    cities: Object.fromEntries(
      [...state.cities].map(([k, v]) =>
        v.fingerprint === null
          ? [k, toBase64(v.states)]
          : [
              k,
              {
                f: v.fingerprint,
                s: toBase64(v.states),
                ...(v.stainFingerprint === null ? {} : { sf: v.stainFingerprint, st: toBase64(v.stains) }),
                ...(v.completed ? { c: 1 as const, restoredAt: v.restoredAt ?? state.clock } : {}),
                ...(v.peaceful ? { p: 1 as const } : {}),
                ...(v.monsterFingerprint === null
                  ? {}
                  : { mf: v.monsterFingerprint, d: toBase64(v.defeated) }),
                co: toBase64(v.coloredOnce),
                ...(v.altarGuards ? { ag: v.altarGuards } : {}),
                sk: v.stockFrom,
                td: {
                  n: Math.round(v.tide.nextIn * 10) / 10,
                  ...(v.tide.wave
                    ? {
                        w: [
                          v.tide.wave.chunk,
                          v.tide.wave.from,
                          v.tide.wave.startsIn,
                          v.tide.wave.endsIn,
                          v.tide.wave.front,
                        ].map((x) => Math.round(x * 10) / 10),
                      }
                    : {}),
                },
              },
            ],
      ),
    ),
    travellerMemorySince: state.travellerMemorySince,
    travellerLegs: state.travellerLegs.size ? Object.fromEntries(state.travellerLegs) : undefined,
    legacyTowns: state.legacyTowns,
    player: state.player,
    clock: state.clock,
    calendarOffset: state.calendarOffset,
    drop: state.drop,
    infectedAt: state.infectedAt,
    infectedPeople: Object.fromEntries(state.infectedPeople),
    inkAreas: Object.fromEntries(state.inkAreas),
    hunted: Object.fromEntries([...state.hunted].filter(([id]) => !wildMonsterBack(state, id))),
    cleansed: Object.fromEntries(state.cleansed),
    growth: state.growth,
    discovered: state.discovered,
    marks: state.marks,
    nextMark: state.nextMark,
    // grown-back sources are the same as never harvested; drop them to keep saves small
    harvested: Object.fromEntries([...state.harvested].filter(([id]) => !sourceReady(state, id))),
  };
  return JSON.stringify(json);
}

export class SaveError extends Error {}

export function deserializeWorld(text: string): WorldState {
  let json: WorldJson;
  try {
    json = JSON.parse(text) as WorldJson;
  } catch (e) {
    throw new SaveError(`存档不是有效的 JSON：${(e as Error).message}`);
  }
  if (
    json.version !== 1 &&
    json.version !== 2 &&
    json.version !== 3 &&
    json.version !== 4 &&
    json.version !== 5 &&
    json.version !== 6 &&
    json.version !== 7 &&
    json.version !== 8 &&
    json.version !== 9 &&
    json.version !== 10 &&
    json.version !== 11 &&
    json.version !== 12 &&
    json.version !== SAVE_VERSION
  )
    throw new SaveError(`不支持的存档版本 ${json.version}`);
  if (json.version >= 6 && ![1, 2, 3, 4, 5, 6].some((version) => version === json.terrainVersion))
    throw new SaveError(`不支持的地形版本 ${json.terrainVersion}`);
  if (typeof json.id !== 'string' || !Number.isInteger(json.seed))
    throw new SaveError('存档缺少世界编号或种子');
  // saves from before pigment was one paint kept coloured pigment per colour: it all counts now
  const colored = (json.inventory?.colored ?? []).reduce(
    (a, x) => a + (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0),
    0,
  );
  const clock = Number.isFinite(json.clock) ? Math.max(0, json.clock!) : 0;
  return {
    version: SAVE_VERSION,
    terrainVersion: json.version < 6 ? 1 : json.terrainVersion!,
    id: json.id,
    legacyTowns:
      json.version < 4
        ? Object.keys(json.cities ?? {})
        : (json.legacyTowns ?? []).filter((id) => typeof id === 'string'),
    seed: json.seed,
    name: String(json.name ?? '世界'),
    inventory: {
      generic: Math.max(0, Math.floor(json.inventory?.generic ?? 0)) + colored,
      ink: Math.max(0, Math.floor(json.inventory?.ink ?? 0)),
      brushTier: Math.min(BRUSH_TIERS.length - 1, Math.max(0, Math.floor(json.inventory?.brushTier ?? 0))),
      glider: json.inventory?.glider === true,
      weapons: (json.inventory?.weapons ?? ['rifle']).filter((k) => WEAPONS.some((w) => w.key === k)),
    },
    unlocked: (json.unlocked ?? []).filter((c) => PAINTABLE.includes(c)),
    travellerMemorySince:
      json.version >= 10 && Number.isFinite(json.travellerMemorySince)
        ? Math.max(0, Math.min(clock, json.travellerMemorySince!))
        : clock,
    travellerLegs: new Map(Object.entries(json.travellerLegs ?? {}).filter(([, v]) => validTravelLeg(v))),
    cities: new Map(
      Object.entries(json.cities ?? {}).map(([k, v]): [string, CitySave] =>
        typeof v === 'string'
          ? [
              k,
              {
                fingerprint: null,
                states: fromBase64(v),
                stainFingerprint: null,
                stains: new Uint8Array(),
                completed: false,
                restoredAt: null,
                peaceful: false,
                monsterFingerprint: null,
                defeated: new Uint8Array(),
                coloredOnce: new Uint8Array(),
                stockFrom: [],
                tide: newTide(),
              },
            ]
          : [
              k,
              {
                fingerprint: Number.isInteger(v.f) ? v.f : null,
                states: fromBase64(v.s),
                stainFingerprint: Number.isInteger(v.sf) ? v.sf! : null,
                stains: v.st ? fromBase64(v.st) : new Uint8Array(),
                completed: v.c === 1,
                restoredAt:
                  v.c === 1 ? (Number.isFinite(v.restoredAt) ? Math.max(0, v.restoredAt!) : clock) : null,
                peaceful: json.version >= 3 && v.p === 1,
                monsterFingerprint: Number.isInteger(v.mf) ? v.mf! : null,
                defeated: v.d ? fromBase64(v.d) : new Uint8Array(),
                altarGuards: Number.isInteger(v.ag) && v.ag! >= 0 && v.ag! <= 7 ? v.ag : 0,
                coloredOnce: v.co ? fromBase64(v.co) : new Uint8Array(),
                stockFrom: Array.isArray(v.sk) ? v.sk.map((t) => (Number.isFinite(t) ? t : -1)) : [],
                tide: validTide(v.td),
              },
            ],
      ),
    ),
    player: json.player ?? null,
    clock,
    calendarOffset: Number.isFinite(json.calendarOffset) ? Math.max(0, json.calendarOffset!) : 0,
    harvested: new Map(
      Object.entries(json.harvested ?? {}).filter((e): e is [string, number] => Number.isFinite(e[1])),
    ),
    growth: validGrowth(json.growth),
    discovered: (json.discovered ?? []).filter((d) => typeof d === 'string'),
    marks: (json.marks ?? []).filter(
      (m) => typeof m?.id === 'string' && [m.x, m.y, m.z].every(Number.isFinite),
    ),
    nextMark: Number.isInteger(json.nextMark) ? json.nextMark! : 1,
    infectedAt: validInkSite(json.infectedAt) ? json.infectedAt : null,
    infectedPeople: new Map(Object.entries(json.infectedPeople ?? {}).filter(([,v]) => validInkSite(v))),
    inkAreas: new Map(Object.entries(json.inkAreas ?? {}).filter(([,v]) => validInkSite(v))),
    hunted: new Map(
      Object.entries(json.hunted ?? {}).filter((e): e is [string, number] => Number.isFinite(e[1])),
    ),
    cleansed: new Map(
      Object.entries(json.cleansed ?? {}).filter((e): e is [string, number] => Number.isFinite(e[1])),
    ),
    drop:
      json.drop && [json.drop.x, json.drop.y, json.drop.z, json.drop.ink].every(Number.isFinite)
        ? { ...json.drop, ink: Math.max(0, Math.floor(json.drop.ink)) }
        : null,
  };
}
