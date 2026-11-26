import { enemyIndex } from '@/content/enemies';
import type { CitySkeleton } from './features';
import type { CitySave } from '../state';

/** The garrison is separate from street guards, so old monster ids and saves stay valid. */
export const ALTAR_GUARDS = [enemyIndex('giant'), enemyIndex('blot'), enemyIndex('spitter')] as const;
export const ALTAR_CAPTURED = (1 << ALTAR_GUARDS.length) - 1;
export const ALTAR_REPAIR_SECONDS = 3;

export function liberation(skel: CitySkeleton, saved: Pick<CitySave, 'defeated' | 'altarGuards'>) {
  const total = skel.monsters.length;
  let defeated = 0;
  for (let i = 0; i < total; i++) if (saved.defeated[i] === 1) defeated++;
  const required = Math.ceil(total / 2);
  const guards = saved.altarGuards ?? 0;
  const remaining = ALTAR_GUARDS.filter((_, i) => !(guards & (1 << i))).length;
  return {
    total,
    defeated,
    required,
    unlocked: defeated >= required,
    remaining,
    captured: guards === ALTAR_CAPTURED,
  };
}
