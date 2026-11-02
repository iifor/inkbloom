// Experience, levels, attribute points and the stats they add up to. Pure; changed only from
// applyPatch, so growth always matches what the player actually did.
import { ATTRIBUTES, LEVEL_XP, MAX_LEVEL, PER_LEVEL, type Attribute } from '@/content/progression';
import { TUNING } from '@/content/tuning';

export interface Growth {
  xp: number;
  /** Unspent attribute points. */
  points: number;
  /** Points spent per attribute. */
  attrs: Record<Attribute, number>;
  /** Milestones already paid, by id, so each pays once. */
  milestones: string[];
}

export function createGrowth(): Growth {
  return { xp: 0, points: 0, attrs: { health: 0, weapon: 0, skill: 0, armor: 0 }, milestones: [] };
}

export function levelOf(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= LEVEL_XP[level]!) level++;
  return level;
}

/** Progress inside the current level, for the HUD. `need` is 0 at the top level. */
export function levelProgress(xp: number): { level: number; into: number; need: number } {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0 };
  const base = LEVEL_XP[level - 1]!;
  return { level, into: xp - base, need: LEVEL_XP[level]! - base };
}

/** Pay a milestone once. Returns whether it was new. */
export function milestone(g: Growth, id: string, points: number): boolean {
  if (g.milestones.includes(id)) return false;
  g.milestones.push(id);
  g.points += points;
  return true;
}

export interface Stats {
  readonly maxHp: number;
  /** Percent; 100 = base. */
  readonly weapon: number;
  readonly skill: number;
  readonly armor: number;
}

export function stats(g: Growth): Stats {
  const per = (k: Attribute): number => ATTRIBUTES.find((a) => a.key === k)!.per * g.attrs[k];
  const levels = levelOf(g.xp) - 1;
  return {
    maxHp: TUNING.combat.playerHp + levels * PER_LEVEL.health + per('health'),
    weapon: 100 + levels * PER_LEVEL.weapon + per('weapon'),
    skill: 100 + per('skill'),
    armor: per('armor'),
  };
}

/** Damage after armour. design: reduction = armour / (max health + armour) */
export function afterArmor(amount: number, s: Stats): number {
  return amount * (1 - s.armor / (s.maxHp + s.armor));
}

export function validGrowth(raw: unknown): Growth {
  const g = createGrowth();
  if (!raw || typeof raw !== 'object') return g;
  const r = raw as Partial<Growth>;
  const n = (v: unknown): number => (Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0);
  g.xp = n(r.xp);
  g.points = n(r.points);
  for (const a of ATTRIBUTES) g.attrs[a.key] = n(r.attrs?.[a.key]);
  g.milestones = Array.isArray(r.milestones) ? r.milestones.filter((m) => typeof m === 'string') : [];
  return g;
}
