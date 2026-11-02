// Weapons as data. The weapon slot holds every weapon owned; Q/R (or the wheel) cycles them and
// G uses the current weapon's skill. Saves store weapon keys, so keys must never change.
// design: section 8 (tools replace classes; each weapon carries the old class skill)
import { color } from './palette';

export type WeaponKind = 'gun' | 'melee' | 'launcher';

export type Unlock =
  | { readonly kind: 'start' }
  | { readonly kind: 'milestone'; readonly id: string; readonly text: string }
  | { readonly kind: 'level'; readonly level: number; readonly text: string }
  | { readonly kind: 'restored'; readonly count: number; readonly text: string };

export interface SkillDef {
  readonly name: string;
  readonly cooldown: number;
  readonly help: string;
}

/** How a shot looks and feels in hand. Pure presentation: no effect on damage or aim. */
export interface ShotLook {
  /** Muzzle position in the viewmodel's own space (metres). */
  readonly muzzle: readonly [number, number, number];
  /** Muzzle flash size; 0 for none. */
  readonly flash: number;
  /** Viewmodel kick per shot (1 = rifle). */
  readonly recoil: number;
  /** The visible bullet, flying from the muzzle to where the shot landed. Hits are instant. */
  readonly tracer?: {
    /** Metres per second; slower reads as heavier and is easier to see. */
    readonly speed: number;
    /** Streak length and thickness, metres. */
    readonly length: number;
    readonly width: number;
    readonly color: number;
  };
}

export interface WeaponDef {
  readonly key: string;
  readonly name: string;
  readonly kind: WeaponKind;
  readonly damage: number;
  /** Seconds between attacks. */
  readonly interval: number;
  /** 0 = no magazine (melee). */
  readonly magazine: number;
  readonly reload: number;
  readonly range: number;
  readonly spread: number;
  /** Launcher: blast radius. Melee: half-angle of the swing, radians. */
  readonly area: number;
  readonly skill: SkillDef;
  readonly unlock: Unlock;
  /** Viewmodel: main and accent colours. */
  readonly look: readonly [number, number];
  readonly shot?: ShotLook;
}

export const WEAPONS = [
  {
    key: 'rifle',
    name: '步枪',
    kind: 'gun',
    damage: 20,
    interval: 0.11,
    magazine: 24,
    reload: 1.3,
    range: 120,
    spread: 0.012,
    area: 0,
    skill: { name: '战术闪避', cooldown: 7, help: '向移动方向闪避，得到 4 秒护盾' },
    unlock: { kind: 'start' },
    look: [color('charcoal'), color('brown')],
    shot: {
      muzzle: [0, 0.003, -0.63],
      flash: 1,
      recoil: 1,
      tracer: { speed: 320, length: 3.5, width: 0.02, color: color('yellow') },
    },
  },
  {
    key: 'katana',
    name: '武士刀',
    kind: 'melee',
    damage: 38,
    interval: 0.42,
    magazine: 0,
    reload: 0,
    range: 2.8,
    spread: 0,
    area: 0.9,
    skill: { name: '突进斩', cooldown: 6, help: '向前冲 9 米，斩过路上的墨怪' },
    unlock: { kind: 'milestone', id: 'first-block', text: '第一次让街区有色' },
    look: [color('cream'), color('red')],
  },
  {
    key: 'sniper',
    name: '狙击枪',
    kind: 'gun',
    damage: 90,
    interval: 1.1,
    magazine: 5,
    reload: 2,
    range: 220,
    spread: 0.001,
    area: 0,
    skill: { name: '专注射击', cooldown: 10, help: '4 秒内伤害 ×1.5，视野拉近' },
    unlock: { kind: 'level', level: 3, text: '升到 3 级' },
    look: [color('teal'), color('charcoal')],
    shot: {
      muzzle: [0, 0.004, -0.96],
      flash: 1.7,
      recoil: 2.6,
      tracer: { speed: 520, length: 9, width: 0.03, color: color('cream') },
    },
  },
  {
    key: 'launcher',
    name: '榴弹炮',
    kind: 'launcher',
    damage: 55,
    interval: 1,
    magazine: 4,
    reload: 2.2,
    range: 60,
    spread: 0,
    area: 4.5,
    skill: { name: '蓄力炮击', cooldown: 10, help: '一发大炮弹，范围和伤害翻倍' },
    unlock: { kind: 'milestone', id: 'first-tide', text: '第一次守住墨潮' },
    look: [color('orange'), color('charcoal')],
    shot: { muzzle: [0, -0.01, -0.62], flash: 2.2, recoil: 2.2 },
  },
  {
    key: 'staff',
    name: '墨能法杖',
    kind: 'gun',
    damage: 36,
    interval: 0.45,
    magazine: 0,
    reload: 0,
    range: 80,
    spread: 0.004,
    area: 0,
    skill: { name: '墨能法阵', cooldown: 8, help: '在准星处放一个 4 秒的法阵，持续伤害' },
    unlock: { kind: 'restored', count: 1, text: '恢复第一座城' },
    look: [color('purple'), color('yellow')],
    shot: {
      muzzle: [0, -0.27, -0.33],
      flash: 0.9,
      recoil: 0.5,
      tracer: { speed: 140, length: 1.6, width: 0.07, color: color('purple') },
    },
  },
] as const satisfies readonly WeaponDef[];

export type WeaponKey = (typeof WEAPONS)[number]['key'];
