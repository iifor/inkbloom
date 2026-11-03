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
  readonly attack: MeleeAttack | SpitAttack;
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
] as const satisfies readonly EnemyDef[];

/** Index of an enemy type by key; throws on typos so content errors surface at load. */
export function enemyIndex(key: (typeof ENEMIES)[number]['key']): number {
  const i = ENEMIES.findIndex((e) => e.key === key);
  if (i < 0) throw new Error(`Unknown enemy: ${key}`);
  return i;
}
