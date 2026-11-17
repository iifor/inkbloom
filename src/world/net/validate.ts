// What a client may ask for, checked field by field before the rules see it. applyPatch was
// written for patches the game itself builds, so it trusts their shapes: a string where an index
// belongs, NaN where an amount belongs, or an Array method name as an index would get through
// it. Every patch from the network is rebuilt here from known fields only (so nothing extra is
// stored or passed on), or refused.
import { ATTRIBUTES } from '@/content/progression';
import { PALETTE } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import type { Patch } from '../patch';
import type { SceneRef } from '../state';

/** Largest index into any per-town list (surfaces, stains, monsters, requests, studios). */
const MAX_INDEX = 100_000;
/** Largest amount a `spend` may name. */
const MAX_AMOUNT = 100_000;
/** Coordinates beyond this are not in any world anyone walks. */
const MAX_COORD = 1_000_000;

const CITY = /^c-?\d{1,6}_-?\d{1,6}$/;
/** A pigment source or wilderness monster: its chunk, then its number there ("cx,cz:k"). */
const WILD_ID = /^-?\d{1,6},-?\d{1,6}:\d{1,4}$/;
/** A ruin: its cell on the ruin grid ("r<gx>_<gz>"). */
const RUIN_ID = /^r-?\d{1,5}_-?\d{1,5}$/;
const MARK_ID = /^[\w-]{1,24}$/;

const isIndex = (v: unknown, max = MAX_INDEX): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < max;
const isCoord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
const isAmount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT;

export function validScene(v: unknown): SceneRef | null {
  const s = v as { kind?: unknown; id?: unknown } | null;
  if (s?.kind === 'wild') return { kind: 'wild' };
  if (s?.kind === 'city' && typeof s.id === 'string' && CITY.test(s.id)) return { kind: 'city', id: s.id };
  return null;
}

export const validCity = (v: unknown): v is string => typeof v === 'string' && CITY.test(v);

/**
 * Roughly where in the world a patch acts (a town's chunk, a source's or monster's chunk, a
 * ruin's cell), or null for patches about the player's own things. The server only judges
 * patches near the player who sent them, so nobody can make it work out far-off places.
 */
export function placeOf(patch: Patch): { x: number; z: number } | null {
  const size = TUNING.world.chunkSize;
  const chunk = (cx: string, cz: string): { x: number; z: number } => ({
    x: (Number(cx) + 0.5) * size,
    z: (Number(cz) + 0.5) * size,
  });
  if ('city' in patch) {
    const m = /^c(-?\d+)_(-?\d+)$/.exec(patch.city);
    return m ? chunk(m[1]!, m[2]!) : null;
  }
  const wild = patch.kind === 'harvest' ? patch.source : patch.kind === 'hunt' ? patch.monster : null;
  if (wild) {
    const m = /^(-?\d+),(-?\d+):/.exec(wild);
    return m ? chunk(m[1]!, m[2]!) : null;
  }
  if (patch.kind === 'discover') {
    const m = /^r(-?\d+)_(-?\d+)$/.exec(patch.ruin);
    const span = TUNING.structures.ruinGrid * size;
    return m ? { x: (Number(m[1]) + 0.5) * span, z: (Number(m[2]) + 0.5) * span } : null;
  }
  return null;
}

/** A patch a client may send, rebuilt from its known fields; null when anything is off. */
export function validPatch(raw: unknown): Patch | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return null;
  switch (p.kind) {
    case 'restore':
    case 'drain':
      return validCity(p.city) && isIndex(p.surface)
        ? { kind: p.kind, city: p.city, surface: p.surface }
        : null;
    case 'paint':
      return validCity(p.city) &&
        isIndex(p.surface) &&
        isIndex(p.color, PALETTE.length) &&
        PALETTE[p.color]!.paintable
        ? { kind: 'paint', city: p.city, surface: p.surface, color: p.color }
        : null;
    case 'collect':
      return validCity(p.city) && isIndex(p.stain) ? { kind: 'collect', city: p.city, stain: p.stain } : null;
    case 'refine':
    case 'collectStock':
      return validCity(p.city) && isIndex(p.studio) ? { kind: p.kind, city: p.city, studio: p.studio } : null;
    case 'defeat':
      return validCity(p.city) && isIndex(p.monster)
        ? { kind: 'defeat', city: p.city, monster: p.monster }
        : null;
    case 'request':
      return validCity(p.city) && isIndex(p.request)
        ? { kind: 'request', city: p.city, request: p.request }
        : null;
    case 'complete':
    case 'tideHeld':
      return validCity(p.city) ? { kind: p.kind, city: p.city } : null;
    case 'harvest':
      return typeof p.source === 'string' && WILD_ID.test(p.source)
        ? { kind: 'harvest', source: p.source }
        : null;
    case 'hunt':
      return typeof p.monster === 'string' && WILD_ID.test(p.monster)
        ? { kind: 'hunt', monster: p.monster }
        : null;
    case 'discover':
      return typeof p.ruin === 'string' && RUIN_ID.test(p.ruin) ? { kind: 'discover', ruin: p.ruin } : null;
    case 'death': {
      const scene = validScene(p.scene);
      return scene && isCoord(p.x) && isCoord(p.y) && isCoord(p.z)
        ? { kind: 'death', scene, x: p.x, y: p.y, z: p.z }
        : null;
    }
    case 'recover':
      return { kind: 'recover' };
    case 'mark':
      return isCoord(p.x) && isCoord(p.y) && isCoord(p.z) ? { kind: 'mark', x: p.x, y: p.y, z: p.z } : null;
    case 'unmark':
      return typeof p.id === 'string' && MARK_ID.test(p.id) ? { kind: 'unmark', id: p.id } : null;
    case 'assign':
      return ATTRIBUTES.some((a) => a.key === p.attr)
        ? { kind: 'assign', attr: p.attr as (typeof ATTRIBUTES)[number]['key'] }
        : null;
    case 'upgrade':
      return p.tool === 'brush' ? { kind: 'upgrade', tool: 'brush' } : null;
    case 'spend': {
      const generic = p.generic === undefined ? 0 : p.generic;
      const ink = p.ink === undefined ? 0 : p.ink;
      return isAmount(generic) && isAmount(ink) ? { kind: 'spend', generic, ink } : null;
    }
    // 'grant' hands things out without earning them: never from a client
    default:
      return null;
  }
}
