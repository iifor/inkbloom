// The only way saved world state changes. Systems build a Patch and call applyPatch; the
// result says whether it happened and why not. Patches carry ids, never amounts: the rules
// here look the amounts up, so a guest in multiplayer cannot claim more than the rules give.
import { PALETTE } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { BRUSH_TIERS } from '@/content/brush-tiers';
import { type CitySkeleton, openRequests, recolorDone, standingMonsters, studioOpen } from './city/features';
import { REQUEST_RULES } from '@/content/requests';
import { blockStates } from './city/blocks';
import { DRAINED, ORIGINAL, coloredRatio, graffiti, surfaceCost, type SurfaceInfo } from './paint/surfaces';
import { type SceneRef, type WorldState, cityStates, sourceReady, wildMonsterBack } from './state';
import { ENEMIES } from '@/content/enemies';
import { ATTRIBUTES, MILESTONES, XP, type Attribute } from '@/content/progression';
import { PAINTABLE } from '@/content/palette';
import { levelOf, milestone } from './progression';
import { WEAPONS } from '@/content/weapons';
import type { PigmentSource } from './wilderness/sources';
import type { WildMonster } from './wilderness/wild-monsters';
import type { Ruin } from './wilderness/ruins';

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
  /** A stronghold monster was defeated: mark it and pay its ink. */
  | { readonly kind: 'defeat'; readonly city: string; readonly monster: number }
  /** A wilderness monster was defeated: pay its ink; it comes back after a while. */
  | { readonly kind: 'hunt'; readonly monster: string }
  /** The player died here: drop a share of held ink at this spot. */
  | {
      readonly kind: 'death';
      readonly scene: SceneRef;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    }
  /** Pick the dropped ink back up. */
  | { readonly kind: 'recover' }
  /** Reach a ruin: unlock its crayon (or take pigment if already known). */
  | { readonly kind: 'discover'; readonly ruin: string }
  /** Hand a resident their wish (a recolored house, or the pigment they asked for). */
  | { readonly kind: 'request'; readonly city: string; readonly request: number }
  /** Take the generic pigment a thriving block's studio has made. */
  | { readonly kind: 'collectStock'; readonly city: string; readonly studio: number }
  /** Plant an ink mark in the wilderness to travel back to. */
  | { readonly kind: 'mark'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'unmark'; readonly id: string }
  /** Spend an attribute point. */
  | { readonly kind: 'assign'; readonly attr: Attribute }
  /** An ink tide was held: pay the reward. */
  | { readonly kind: 'tideHeld'; readonly city: string }
  /** Buy the next brush tier. */
  | { readonly kind: 'upgrade'; readonly tool: 'brush' }
  /** Mark a city restored once every block has colour, and pay the reward. */
  | { readonly kind: 'complete'; readonly city: string }
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
  /** A wilderness monster by id as the land is now, or null. */
  wildMonsterOf(id: string): WildMonster | null;
  /** A ruin by id, or null. */
  ruinOf(id: string): Ruin | null;
}

const fail = (reason: string): PatchResult => ({ ok: false, reason });
const OK: PatchResult = { ok: true };

/** A block that is 有色 with every request done becomes 繁荣: its studio starts making pigment. */
function markThriving(
  state: WorldState,
  city: string,
  skel: CitySkeleton,
  states: Uint8Array,
  done: Uint8Array,
  chunk: number,
): void {
  const saved = state.cities.get(city)!;
  if ((saved.stockFrom[chunk] ?? -1) >= 0) return;
  if (coloredRatio(states, skel.surfaces, chunk) < TUNING.blocks.coloredAt) return;
  if (openRequests(skel, done, chunk).length) return;
  saved.stockFrom[chunk] = state.clock;
}

/** After a surface gains colour: the first time its block reaches 有色, pay experience and
 * the block milestones (first block ever; the city's 5th, 10th, ... block). */
function blockMilestones(
  state: WorldState,
  city: string,
  surfaces: readonly SurfaceInfo[],
  states: Uint8Array,
  coloredOnce: Uint8Array,
  chunk: number,
): void {
  if (coloredOnce[chunk] || coloredRatio(states, surfaces, chunk) < TUNING.blocks.coloredAt) return;
  coloredOnce[chunk] = 1;
  const g = state.growth;
  g.xp += XP.blockColored;
  milestone(g, 'first-block', MILESTONES.firstBlockColored);
  const count = coloredOnce.reduce((a, b) => a + b, 0);
  if ((MILESTONES.cityBlocks as readonly number[]).includes(count))
    milestone(g, `city:${city}:blocks:${count}`, MILESTONES.cityBlocksPoint);
}

export function applyPatch(state: WorldState, patch: Patch, ctx: PatchContext): PatchResult {
  const r = applyRules(state, patch, ctx);
  if (r.ok) unlockWeapons(state);
  return r;
}

/** Weapons whose unlock condition is met now and are not owned yet; adds them. */
export function unlockWeapons(state: WorldState): string[] {
  const restored = [...state.cities.values()].filter((c) => c.completed).length;
  const level = levelOf(state.growth.xp);
  const fresh: string[] = [];
  for (const w of WEAPONS) {
    if (state.inventory.weapons.includes(w.key)) continue;
    const u = w.unlock;
    const met =
      u.kind === 'start' ||
      (u.kind === 'milestone' && state.growth.milestones.includes(u.id)) ||
      (u.kind === 'level' && level >= u.level) ||
      (u.kind === 'restored' && restored >= u.count);
    if (met) fresh.push(w.key);
  }
  state.inventory.weapons.push(...fresh);
  return fresh;
}

function applyRules(state: WorldState, patch: Patch, ctx: PatchContext): PatchResult {
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
    case 'upgrade': {
      const next = BRUSH_TIERS[inv.brushTier + 1];
      if (!next?.cost) return fail('笔刷已经是最好的了');
      if (inv.generic < next.cost.generic) return fail(`通用颜料不够（需要 ${next.cost.generic}）`);
      if (inv.ink < next.cost.ink) return fail(`墨不够（需要 ${next.cost.ink}）`);
      inv.generic -= next.cost.generic;
      inv.ink -= next.cost.ink;
      inv.brushTier += 1;
      return OK;
    }
    case 'hunt': {
      const m = ctx.wildMonsterOf(patch.monster);
      if (!m) return fail('这里没有墨怪');
      if (!wildMonsterBack(state, m.id)) return fail('已经打败了');
      state.hunted.set(m.id, state.clock);
      inv.ink += ENEMIES[m.type]?.ink ?? 0;
      state.growth.xp += XP.monster;
      return OK;
    }
    case 'death': {
      const lost = Math.floor(inv.ink * TUNING.combat.deathInkShare);
      inv.ink -= lost;
      state.drop = { scene: patch.scene, x: patch.x, y: patch.y, z: patch.z, ink: lost };
      return OK;
    }
    case 'recover': {
      if (!state.drop) return fail('没有掉落的墨');
      inv.ink += state.drop.ink;
      state.drop = null;
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
    case 'discover': {
      const r = ctx.ruinOf(patch.ruin);
      if (!r) return fail('这里没有遗迹');
      if (state.discovered.includes(r.id)) return fail('已经找到过了');
      state.discovered.push(r.id);
      state.growth.xp += XP.ruinFound;
      if (!state.unlocked.includes(r.color)) state.unlocked.push(r.color);
      else inv.colored[r.color] = (inv.colored[r.color] ?? 0) + TUNING.structures.ruinPigment;
      if (PAINTABLE.every((c) => state.unlocked.includes(c)))
        milestone(state.growth, 'all-colors', MILESTONES.allColors);
      return OK;
    }
    case 'mark': {
      if (state.marks.length >= TUNING.marks.max)
        return fail(`最多 ${TUNING.marks.max} 个墨迹标记（右键收回一个）`);
      if (inv.generic < TUNING.marks.cost) return fail(`通用颜料不够（要 ${TUNING.marks.cost}）`);
      inv.generic -= TUNING.marks.cost;
      state.marks.push({ id: `m${state.nextMark++}`, x: patch.x, y: patch.y, z: patch.z });
      return OK;
    }
    case 'unmark': {
      const i = state.marks.findIndex((m) => m.id === patch.id);
      if (i < 0) return fail('没有这个标记');
      state.marks.splice(i, 1);
      return OK;
    }
    case 'assign': {
      if (!ATTRIBUTES.some((a) => a.key === patch.attr)) return fail('没有这个属性');
      if (state.growth.points < 1) return fail('没有属性点');
      state.growth.points -= 1;
      state.growth.attrs[patch.attr] += 1;
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
      if (PAINTABLE.every((c) => state.unlocked.includes(c)))
        milestone(state.growth, 'all-colors', MILESTONES.allColors);
      return OK;
    }
    default:
      break;
  }

  const skel = ctx.cityOf(patch.city);
  if (!skel) return fail('城市不存在');
  const { states, stains, defeated, coloredOnce, requestsDone } = cityStates(state, patch.city, skel);

  switch (patch.kind) {
    case 'complete': {
      const saved = state.cities.get(patch.city)!;
      if (saved.completed) return fail('这座城已经恢复了');
      const blocks = blockStates(states, skel.surfaces, skel.chunks);
      if (!blocks.every((b) => b === 'colored' || b === 'thriving')) return fail('还有街区没有颜色');
      saved.completed = true;
      inv.generic += TUNING.city.completeReward.generic;
      inv.ink += TUNING.city.completeReward.ink;
      state.growth.xp += XP.cityRestored;
      milestone(state.growth, `city:${patch.city}:restored`, MILESTONES.cityRestored);
      inv.glider = true;
      return OK;
    }
    case 'tideHeld': {
      inv.generic += TUNING.tide.reward.generic;
      inv.ink += TUNING.tide.reward.ink;
      state.growth.xp += XP.tideHeld;
      milestone(state.growth, 'first-tide', MILESTONES.firstTideHeld);
      return OK;
    }
    case 'defeat': {
      const m = skel.monsters[patch.monster];
      if (!m) return fail('没有这只墨怪');
      if (defeated[patch.monster]) return fail('已经打败了');
      defeated[patch.monster] = 1;
      inv.ink += ENEMIES[m.type]?.ink ?? 0;
      state.growth.xp += XP.monster;
      return OK;
    }
    case 'request': {
      const r = skel.requests[patch.request];
      if (!r) return fail('没有这个心愿');
      if (requestsDone[patch.request]) return fail('已经完成了');
      if (r.kind === 'recolor') {
        if (!recolorDone(r, states)) return fail('四面墙还没都涂成想要的颜色');
      } else {
        if ((inv.colored[r.color] ?? 0) < r.count)
          return fail(`${PALETTE[r.color]!.name}颜料不够（要 ${r.count}）`);
        inv.colored[r.color]! -= r.count;
      }
      requestsDone[patch.request] = 1;
      inv.generic += REQUEST_RULES.reward.generic;
      inv.ink += REQUEST_RULES.reward.ink;
      state.growth.xp += XP.request;
      markThriving(state, patch.city, skel, states, requestsDone, r.chunk);
      return OK;
    }
    case 'collectStock': {
      const s = skel.studios[patch.studio];
      if (!s) return fail('画室不存在');
      const saved = state.cities.get(patch.city)!;
      const from = saved.stockFrom[s.chunk] ?? -1;
      if (from < 0) return fail('这个街区还没有繁荣');
      const period = TUNING.economy.studioStockSeconds;
      const made = Math.min(TUNING.economy.studioStockCap, Math.floor((state.clock - from) / period));
      if (made < 1) return fail('还没有新的颜料');
      inv.generic += made;
      saved.stockFrom[s.chunk] = made >= TUNING.economy.studioStockCap ? state.clock : from + made * period;
      return OK;
    }
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
  if (patch.kind !== 'drain' && standingMonsters(skel, defeated, info.chunk).length)
    return fail('这个街区还有墨怪，先赶走它们');
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
      if (current === DRAINED) state.growth.xp += XP.surface;
      blockMilestones(state, patch.city, skel.surfaces, states, coloredOnce, info.chunk);
      markThriving(state, patch.city, skel, states, requestsDone, info.chunk);
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
      if (current === DRAINED) state.growth.xp += XP.surface;
      blockMilestones(state, patch.city, skel.surfaces, states, coloredOnce, info.chunk);
      markThriving(state, patch.city, skel, states, requestsDone, info.chunk);
      return OK;
    }
  }
}
