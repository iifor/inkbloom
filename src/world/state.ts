// Everything about a world that is saved. Generated content (terrain, city skeletons) is not
// here because it is recomputed from the seed. Change this file only together with a bump of
// SAVE_VERSION and a note in docs/EXTENDING.md.
import { PALETTE, PAINTABLE, color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { BRUSH_TIERS } from '@/content/brush-tiers';
import { surfaceFingerprint } from './paint/surfaces';
import { type CitySkeleton, stainFingerprint } from './city/features';

export const SAVE_VERSION = 2;

export type SceneRef = { readonly kind: 'wild' } | { readonly kind: 'city'; readonly id: string };

export interface Inventory {
  /** Generic pigment, used by the restore brush. */
  generic: number;
  /** Coloured pigment by palette index, used by the graffiti brush. */
  colored: number[];
  /** Raw ink, refined into generic pigment at a studio. */
  ink: number;
  /** Index into BRUSH_TIERS. */
  brushTier: number;
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
  name: string;
  inventory: Inventory;
  /** Palette indices the player can graffiti with. */
  unlocked: number[];
  /** Per-city surface states, created when a city is first entered. */
  cities: Map<string, CitySave>;
  player: PlayerSave | null;
  /** Seconds of play in this world. Cooldowns use this, so nothing grows while offline. */
  clock: number;
  /** Wilderness source id -> clock time it was last harvested. */
  harvested: Map<string, number>;
}

export interface CitySave {
  /** surfaceFingerprint of the skeleton the states belong to; null for v1 saves. */
  fingerprint: number | null;
  states: Uint8Array;
  /** stainFingerprint of the stain list `stains` belongs to. */
  stainFingerprint: number | null;
  /** 1 per ink stain already soaked up. */
  stains: Uint8Array;
  /** Every block had colour at once; the city is restored for good. */
  completed: boolean;
}

export const STARTING_COLORS = [color('red'), color('blue'), color('yellow'), color('green')];

export function createWorldState(id: string, seed: number, name = '新世界'): WorldState {
  const colored = PALETTE.map(() => 0);
  for (const c of STARTING_COLORS) colored[c] = TUNING.brush.startingColored;
  return {
    version: SAVE_VERSION,
    id,
    seed,
    name,
    inventory: { generic: TUNING.brush.startingGeneric, colored, ink: 0, brushTier: 0 },
    unlocked: [...STARTING_COLORS],
    cities: new Map(),
    player: null,
    clock: 0,
    harvested: new Map(),
  };
}

/**
 * Saved state for a city, created all-drained on first use. Surface states and stain flags
 * are each checked against the skeleton they were made for: when generator code or content
 * changed a list, that part is replaced with a fresh array. `reset` reports a surface reset
 * (lost painting progress) so the caller can tell the player; stain resets are silent.
 */
export function cityStates(
  state: WorldState,
  cityId: string,
  skel: CitySkeleton,
): { states: Uint8Array; stains: Uint8Array; reset: boolean } {
  const fingerprint = surfaceFingerprint(skel.surfaces);
  const stainFp = stainFingerprint(skel.stains);
  let saved = state.cities.get(cityId);
  let reset = false;
  if (saved) {
    // v1 saves carry no fingerprint: adopt them when the surface count still matches
    if (saved.fingerprint === null && saved.states.length === skel.surfaces.length)
      saved.fingerprint = fingerprint;
    if (saved.fingerprint !== fingerprint) {
      saved.fingerprint = fingerprint;
      saved.states = new Uint8Array(skel.surfaces.length);
      saved.completed = false;
      reset = true;
    }
  } else {
    saved = {
      fingerprint,
      states: new Uint8Array(skel.surfaces.length),
      stainFingerprint: stainFp,
      stains: new Uint8Array(skel.stains.length),
      completed: false,
    };
    state.cities.set(cityId, saved);
  }
  if (saved.stainFingerprint !== stainFp) {
    saved.stainFingerprint = stainFp;
    saved.stains = new Uint8Array(skel.stains.length);
  }
  return { states: saved.states, stains: saved.stains, reset };
}

/** Whether a wilderness source can be harvested now. */
export function sourceReady(state: WorldState, id: string): boolean {
  const t = state.harvested.get(id);
  return t === undefined || state.clock - t >= TUNING.economy.regrowSeconds;
}

/** Share of coloured surfaces from saved state alone (no skeleton needed); 1 once restored. */
export function savedProgress(state: WorldState, cityId: string): number {
  const saved = state.cities.get(cityId);
  if (saved?.completed) return 1;
  if (!saved || saved.states.length === 0) return 0;
  let colored = 0;
  for (const s of saved.states) if (s !== 0) colored++;
  return colored / saved.states.length;
}

// ---- serialisation ----------------------------------------------------------------------

interface WorldJson {
  version: number;
  id: string;
  seed: number;
  name: string;
  inventory: Inventory;
  unlocked: number[];
  /** v2: { f, s, sf?, st? } (fingerprints and base64 bytes); v1: base64 states. */
  cities: Record<string, { f: number; s: string; sf?: number; st?: string; c?: 1 } | string>;
  player: PlayerSave | null;
  clock?: number;
  harvested?: Record<string, number>;
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
                ...(v.completed ? { c: 1 as const } : {}),
              },
            ],
      ),
    ),
    player: state.player,
    clock: state.clock,
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
  if (json.version !== 1 && json.version !== SAVE_VERSION)
    throw new SaveError(`不支持的存档版本 ${json.version}`);
  if (typeof json.id !== 'string' || !Number.isInteger(json.seed))
    throw new SaveError('存档缺少世界编号或种子');
  const colored = PALETTE.map((_, i) => Math.max(0, Math.floor(json.inventory?.colored?.[i] ?? 0)));
  return {
    version: SAVE_VERSION,
    id: json.id,
    seed: json.seed,
    name: String(json.name ?? '世界'),
    inventory: {
      generic: Math.max(0, Math.floor(json.inventory?.generic ?? 0)),
      colored,
      ink: Math.max(0, Math.floor(json.inventory?.ink ?? 0)),
      brushTier: Math.min(BRUSH_TIERS.length - 1, Math.max(0, Math.floor(json.inventory?.brushTier ?? 0))),
    },
    unlocked: (json.unlocked ?? []).filter((c) => PAINTABLE.includes(c)),
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
              },
            ],
      ),
    ),
    player: json.player ?? null,
    clock: Number.isFinite(json.clock) ? Math.max(0, json.clock!) : 0,
    harvested: new Map(
      Object.entries(json.harvested ?? {}).filter((e): e is [string, number] => Number.isFinite(e[1])),
    ),
  };
}
