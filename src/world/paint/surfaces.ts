// A surface is the unit of colour: one wall face, roof, door or patch of ground. Its original
// colour is part of the generated skeleton and never changes; the save only stores one byte
// of current state per surface.
import { TUNING } from '@/content/tuning';
import { hashInts } from '../math/hash';

export const DRAINED = 0;
export const ORIGINAL = 1;
export const GRAFFITI_BASE = 2;

export const graffiti = (color: number): number => GRAFFITI_BASE + color;
export const isColored = (state: number): boolean => state !== DRAINED;

export type SurfaceKind = 'wall' | 'roof' | 'door' | 'ground';

export interface SurfaceInfo {
  readonly kind: SurfaceKind;
  /** Index of the city chunk the surface belongs to, for per-chunk progress. */
  readonly chunk: number;
  /** Original colour (palette index). */
  readonly color: number;
  /** Square metres. Large surfaces cost more pigment. */
  readonly area: number;
  /** Centre in city-local metres, for effects that sweep across a chunk. */
  readonly x: number;
  readonly z: number;
}

/** The colour a surface shows for a given state, or null when drained. */
export function shownColor(info: SurfaceInfo, state: number): number | null {
  if (state === DRAINED) return null;
  if (state === ORIGINAL) return info.color;
  return state - GRAFFITI_BASE;
}

export function surfaceCost(info: SurfaceInfo): number {
  return info.area >= TUNING.brush.largeSurfaceArea ? 2 : 1;
}

const KIND_CODE: Record<SurfaceKind, number> = { wall: 1, roof: 2, door: 3, ground: 4 };
const fingerprints = new WeakMap<readonly SurfaceInfo[], number>();

/**
 * Identifies a skeleton's surface list. Saved states are only valid against the skeleton
 * they were made for: if generator code or content changes the list, the fingerprint
 * changes and the save is reset instead of painting colours onto the wrong surfaces.
 * Original colours are left out on purpose, so palette tweaks keep progress.
 */
export function surfaceFingerprint(infos: readonly SurfaceInfo[]): number {
  let f = fingerprints.get(infos);
  if (f !== undefined) return f;
  f = hashInts(0x5eed, infos.length);
  for (const s of infos) f = hashInts(f, KIND_CODE[s.kind], s.chunk, Math.round(s.area * 10));
  fingerprints.set(infos, f);
  return f;
}

/** Fraction of surfaces with any colour, optionally limited to one chunk. */
export function coloredRatio(states: Uint8Array, infos: readonly SurfaceInfo[], chunk?: number): number {
  let total = 0;
  let colored = 0;
  for (let i = 0; i < infos.length; i++) {
    if (chunk !== undefined && infos[i]!.chunk !== chunk) continue;
    total++;
    if (isColored(states[i]!)) colored++;
  }
  return total === 0 ? 0 : colored / total;
}
