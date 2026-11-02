// The only way saved world state changes. Systems build a Patch and call applyPatch; the
// result says whether it happened and why not. Patches carry ids, never amounts: the rules
// here look the amounts up, so a guest in multiplayer cannot claim more than the rules give.
import { PALETTE } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { type CitySkeleton, studioOpen } from './city/features';
import { DRAINED, ORIGINAL, graffiti, surfaceCost } from './paint/surfaces';
import { type WorldState, cityStates, sourceReady } from './state';
import type { PigmentSource } from './wilderness/sources';

export type Patch =
  | { readonly kind: 'restore'; readonly city: string; readonly surface: number }
  | { readonly kind: 'paint'; readonly city: string; readonly surface: number; readonly color: number }
  | { readonly kind: 'drain'; readonly city: string; readonly surface: number }
  /** Soak up an ink stain in a city. */
  | { readonly kind: 'collect'; readonly city: string; readonly stain: number }
  /** Refine all held ink into generic pigment at a studio (index into skeleton.studios). */
  | { readonly kind: 'refine'; readonly city: string; readonly studio: number }
  /** Harvest a wilderness pigment source. */
  | { readonly kind: 'harvest'; readonly source: string }
  /** Pay pigment or ink for an action (pushing back an ink tide). Fails if short. */
  | { readonly kind: 'spend'; readonly generic?: number; readonly ink?: number }
  | {
      readonly kind: 'grant';
      readonly generic?: number;
      readonly ink?: number;
      readonly colored?: readonly { readonly color: number; readonly amount: number }[];
      readonly unlock?: readonly number[];
    };

export type PatchResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PatchContext {
  /** A city's skeleton, or null when the city is unknown. */
  cityOf(city: string): CitySkeleton | null;
  /** A wilderness pigment source by id, or null. */
  sourceOf(id: string): PigmentSource | null;
}

const fail = (reason: string): PatchResult => ({ ok: false, reason });
const OK: PatchResult = { ok: true };

export function applyPatch(state: WorldState, patch: Patch, ctx: PatchContext): PatchResult {
  const inv = state.inventory;
  switch (patch.kind) {
    case 'grant': {
      for (const g of patch.colored ?? []) if (!PALETTE[g.color]) return fail(`未知颜色 ${g.color}`);
      if (patch.generic) inv.generic = Math.max(0, inv.generic + patch.generic);
      if (patch.ink) inv.ink = Math.max(0, inv.ink + patch.ink);
      for (const g of patch.colored ?? [])
        inv.colored[g.color] = Math.max(0, (inv.colored[g.color] ?? 0) + g.amount);
      for (const c of patch.unlock ?? []) if (!state.unlocked.includes(c)) state.unlocked.push(c);
      return OK;
    }
    case 'spend': {
      const g = Math.max(0, patch.generic ?? 0);
      const k = Math.max(0, patch.ink ?? 0);
      if (inv.generic < g) return fail('通用颜料不足');
      if (inv.ink < k) return fail('墨不足');
      inv.generic -= g;
      inv.ink -= k;
      return OK;
    }
    case 'harvest': {
      const src = ctx.sourceOf(patch.source);
      if (!src) return fail('这里没有颜料');
      if (!sourceReady(state, src.id)) return fail('还没长回来');
      state.harvested.set(src.id, state.clock);
      inv.colored[src.color] = (inv.colored[src.color] ?? 0) + src.amount;
      inv.ink += src.ink;
      if (PALETTE[src.color]?.paintable && !state.unlocked.includes(src.color))
        state.unlocked.push(src.color);
      return OK;
    }
    default:
      break;
  }

  const skel = ctx.cityOf(patch.city);
  if (!skel) return fail('城市不存在');
  const { states, stains } = cityStates(state, patch.city, skel);

  switch (patch.kind) {
    case 'collect': {
      if (!skel.stains[patch.stain]) return fail('墨渍不存在');
      if (stains[patch.stain]) return fail('已经擦掉了');
      stains[patch.stain] = 1;
      inv.ink += TUNING.economy.inkPerStain;
      return OK;
    }
    case 'refine': {
      if (!skel.studios[patch.studio]) return fail('画室不存在');
      if (!studioOpen(skel, states, patch.studio)) return fail('画室还没开门');
      const made = Math.floor(inv.ink / TUNING.economy.inkPerGeneric);
      if (made === 0) return fail(`墨不够（需要 ${TUNING.economy.inkPerGeneric}）`);
      inv.ink -= made * TUNING.economy.inkPerGeneric;
      inv.generic += made;
      return OK;
    }
    default:
      break;
  }

  const info = skel.surfaces[patch.surface];
  if (!info) return fail('表面不存在');
  const current = states[patch.surface]!;
  switch (patch.kind) {
    case 'drain':
      states[patch.surface] = DRAINED;
      return OK;
    case 'restore': {
      if (current === ORIGINAL) return fail('已经是原色');
      const cost = surfaceCost(info);
      if (inv.generic < cost) return fail('通用颜料不足');
      inv.generic -= cost;
      states[patch.surface] = ORIGINAL;
      return OK;
    }
    case 'paint': {
      const def = PALETTE[patch.color];
      if (!def?.paintable) return fail('这种颜色不能涂鸦');
      if (!state.unlocked.includes(patch.color)) return fail('还没有这支蜡笔');
      if (current === graffiti(patch.color)) return fail('已经是这个颜色');
      const cost = surfaceCost(info);
      if ((inv.colored[patch.color] ?? 0) < cost) return fail(`${def.name}颜料不足`);
      inv.colored[patch.color]! -= cost;
      states[patch.surface] = graffiti(patch.color);
      return OK;
    }
  }
}
