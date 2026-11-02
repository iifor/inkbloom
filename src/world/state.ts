// Everything about a world that is saved. Generated content (terrain, city skeletons) is not
// here because it is recomputed from the seed. Change this file only together with a bump of
// SAVE_VERSION and a note in docs/EXTENDING.md.
import { PALETTE, PAINTABLE, color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { type SurfaceInfo, surfaceFingerprint } from './paint/surfaces';

export const SAVE_VERSION = 2;

export type SceneRef = { readonly kind: 'wild' } | { readonly kind: 'city'; readonly id: string };

export interface Inventory {
  /** Generic pigment, used by the restore brush. */
  generic: number;
  /** Coloured pigment by palette index, used by the graffiti brush. */
  colored: number[];
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
}

export interface CitySave {
  /** surfaceFingerprint of the skeleton the states belong to; null for v1 saves. */
  fingerprint: number | null;
  states: Uint8Array;
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
    inventory: { generic: TUNING.brush.startingGeneric, colored },
    unlocked: [...STARTING_COLORS],
    cities: new Map(),
    player: null,
  };
}

/**
 * Surface states for a city, created all-drained on first use. When the saved states were
 * made for a different skeleton (generator or content changed), they are replaced with a
 * fresh drained array and `reset` is true so the caller can tell the player.
 */
export function cityStates(
  state: WorldState,
  cityId: string,
  surfaces: readonly SurfaceInfo[],
): { states: Uint8Array; reset: boolean } {
  const fingerprint = surfaceFingerprint(surfaces);
  const saved = state.cities.get(cityId);
  if (saved) {
    // v1 saves carry no fingerprint: adopt them when the surface count still matches
    if (saved.fingerprint === null && saved.states.length === surfaces.length)
      saved.fingerprint = fingerprint;
    if (saved.fingerprint === fingerprint) return { states: saved.states, reset: false };
  }
  const fresh: CitySave = { fingerprint, states: new Uint8Array(surfaces.length) };
  state.cities.set(cityId, fresh);
  return { states: fresh.states, reset: saved !== undefined };
}

/** Share of coloured surfaces from saved state alone (no skeleton needed). */
export function savedProgress(state: WorldState, cityId: string): number {
  const saved = state.cities.get(cityId);
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
  /** v2: { f: fingerprint, s: base64 states }; v1: base64 states. */
  cities: Record<string, { f: number; s: string } | string>;
  player: PlayerSave | null;
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
        v.fingerprint === null ? [k, toBase64(v.states)] : [k, { f: v.fingerprint, s: toBase64(v.states) }],
      ),
    ),
    player: state.player,
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
    inventory: { generic: Math.max(0, Math.floor(json.inventory?.generic ?? 0)), colored },
    unlocked: (json.unlocked ?? []).filter((c) => PAINTABLE.includes(c)),
    cities: new Map(
      Object.entries(json.cities ?? {}).map(([k, v]): [string, CitySave] =>
        typeof v === 'string'
          ? [k, { fingerprint: null, states: fromBase64(v) }]
          : [k, { fingerprint: Number.isInteger(v.f) ? v.f : null, states: fromBase64(v.s) }],
      ),
    ),
    player: json.player ?? null,
  };
}
