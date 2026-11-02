// The only way saved world state changes. Systems build a Patch and call applyPatch; the
// result says whether it happened and why not. Multiplayer will send the same patches from
// guests to the host, which applies them and broadcasts the accepted ones.
import { PALETTE } from '@/content/palette';
import { type WorldState, cityStates } from './state';
import { DRAINED, ORIGINAL, graffiti, surfaceCost, type SurfaceInfo } from './paint/surfaces';

export type Patch =
  | { readonly kind: 'restore'; readonly city: string; readonly surface: number }
  | { readonly kind: 'paint'; readonly city: string; readonly surface: number; readonly color: number }
  | { readonly kind: 'drain'; readonly city: string; readonly surface: number }
  | {
      readonly kind: 'grant';
      readonly generic?: number;
      readonly colored?: readonly { readonly color: number; readonly amount: number }[];
      readonly unlock?: readonly number[];
    };

export type PatchResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PatchContext {
  /** Surfaces of a city skeleton, or null when the city is unknown. */
  surfacesOf(city: string): readonly SurfaceInfo[] | null;
}

const fail = (reason: string): PatchResult => ({ ok: false, reason });
const OK: PatchResult = { ok: true };

export function applyPatch(state: WorldState, patch: Patch, ctx: PatchContext): PatchResult {
  if (patch.kind === 'grant') {
    if (patch.generic) state.inventory.generic = Math.max(0, state.inventory.generic + patch.generic);
    for (const g of patch.colored ?? []) {
      if (!PALETTE[g.color]) return fail(`未知颜色 ${g.color}`);
      state.inventory.colored[g.color] = Math.max(0, (state.inventory.colored[g.color] ?? 0) + g.amount);
    }
    for (const c of patch.unlock ?? []) if (!state.unlocked.includes(c)) state.unlocked.push(c);
    return OK;
  }

  const infos = ctx.surfacesOf(patch.city);
  if (!infos) return fail('城市不存在');
  const info = infos[patch.surface];
  if (!info) return fail('表面不存在');
  const { states } = cityStates(state, patch.city, infos);
  const current = states[patch.surface]!;

  switch (patch.kind) {
    case 'drain':
      states[patch.surface] = DRAINED;
      return OK;
    case 'restore': {
      if (current === ORIGINAL) return fail('已经是原色');
      const cost = surfaceCost(info);
      if (state.inventory.generic < cost) return fail('通用颜料不足');
      state.inventory.generic -= cost;
      states[patch.surface] = ORIGINAL;
      return OK;
    }
    case 'paint': {
      const def = PALETTE[patch.color];
      if (!def?.paintable) return fail('这种颜色不能涂鸦');
      if (!state.unlocked.includes(patch.color)) return fail('还没有这支蜡笔');
      if (current === graffiti(patch.color)) return fail('已经是这个颜色');
      const cost = surfaceCost(info);
      if ((state.inventory.colored[patch.color] ?? 0) < cost) return fail(`${def.name}颜料不足`);
      state.inventory.colored[patch.color]! -= cost;
      states[patch.surface] = graffiti(patch.color);
      return OK;
    }
  }
}
