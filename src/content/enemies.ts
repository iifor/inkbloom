// Ink monsters as data. Saves store the type index of stronghold monsters, so append new types
// at the end. AI behaviour is picked by `attack.kind`.
import { color } from './palette';

export interface MeleeAttack {
  readonly kind: 'melee';
  /** Bite reach in metres. */
  readonly range: number;
  readonly damage: number;
  /** Seconds between bites. */
  readonly cooldown: number;
}

export interface SpitAttack {
  readonly kind: 'spit';
  /** Keeps between these distances from the player. */
  readonly keepAway: readonly [number, number];
  /** Spits only within this distance. */
  readonly range: number;
  readonly damage: number;
  readonly cooldown: number;
  /** Projectile speed, metres per second. */
  readonly speed: number;
}

export interface LungeAttack {
  readonly kind: 'lunge';
  /** Crouches to spring once the player is this close (and in sight). */
  readonly range: number;
  readonly damage: number;
  readonly cooldown: number;
  /** Speed of the dash, metres per second; it runs on past where the player stood. */
  readonly dash: number;
}

export interface EnemyDef {
  readonly key: string;
  readonly name: string;
  readonly hp: number;
  /** Run speed, metres per second. */
  readonly speed: number;
  readonly halfWidth: number;
  readonly height: number;
  /** Notices the player within this distance (with line of sight). */
  readonly aggro: number;
  /** Ink dropped when defeated. design: 5 per monster */
  readonly ink: number;
  readonly attack: MeleeAttack | SpitAttack | LungeAttack;
  /** A hit must be at least this big to break its wind-up (破招); default `combat.feel.interruptMin`. */
  readonly poise?: number;
  /** A rare, tough monster: takes several times the hits of a common one. */
  readonly elite?: boolean;
  readonly body: number;
  readonly eyes: number;
}

export const ENEMIES = [
  {
    key: 'blot',
    name: '墨团',
    hp: 60,
    speed: 4.4,
    halfWidth: 0.45,
    height: 1.2,
    aggro: 22,
    ink: 5,
    attack: { kind: 'melee', range: 1.8, damage: 12, cooldown: 0.9 },
    body: color('ink'),
    eyes: color('red'),
  },
  {
    key: 'spitter',
    name: '墨吐',
    hp: 45,
    speed: 3.2,
    halfWidth: 0.4,
    height: 1.7,
    aggro: 28,
    ink: 6,
    attack: { kind: 'spit', keepAway: [9, 16], range: 26, damage: 10, cooldown: 2.2, speed: 18 },
    body: color('ink'),
    eyes: color('yellow'),
  },
  {
    // a blot that has swallowed a street's worth of colour: slow, heavy, only the sniper and
    // the launcher break its slam. Never in strongholds (saves fingerprint their types): it
    // roams the greyest wilderness and leads some ink tides
    key: 'giant',
    name: '墨巨',
    hp: 240,
    speed: 3.1,
    halfWidth: 0.85,
    height: 2.5,
    aggro: 24,
    ink: 20,
    attack: { kind: 'melee', range: 3, damage: 26, cooldown: 1.7 },
    poise: 50,
    elite: true,
    body: color('ink'),
    eyes: color('orange'),
  },
  {
    // a low, quick slick of ink that circles in, crouches, and springs straight through where
    // the player stood: step aside as it crouches. Wild and tide only, like the 墨巨
    key: 'weasel',
    name: '墨鼬',
    hp: 35,
    speed: 5.6,
    halfWidth: 0.35,
    height: 0.8,
    aggro: 26,
    ink: 4,
    attack: { kind: 'lunge', range: 7, damage: 14, cooldown: 2.6, dash: 15 },
    body: color('ink'),
    eyes: color('green'),
  },
] as const satisfies readonly EnemyDef[];

/** Index of an enemy type by key; throws on typos so content errors surface at load. */
export function enemyIndex(key: (typeof ENEMIES)[number]['key']): number {
  const i = ENEMIES.findIndex((e) => e.key === key);
  if (i < 0) throw new Error(`Unknown enemy: ${key}`);
  return i;
}
