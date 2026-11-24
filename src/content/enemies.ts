// Ink monsters as data. Saves store the type index of stronghold monsters, so append new types
// at the end. AI behaviour is picked by `attack.kind`.
import { WILD_MODELS } from './wild-models';
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
  /** Forward extent of an elongated creature, from its centre to either end. */
  readonly halfLength?: number;
  /** Lowest hittable point above the physics body’s feet, in metres. */
  readonly hitBottom?: number;
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
  {
    key: 'frog',
    name: '墨蛙',
    hp: 40,
    speed: 3.6,
    halfWidth: 0.78,
    height: 0.66,
    aggro: 20,
    ink: 5,
    attack: { kind: 'lunge', range: 6, damage: 12, cooldown: 2.8, dash: 12 },
    body: color('ink'),
    eyes: color('green'),
  },
  {
    key: 'rat',
    name: '墨鼠',
    hp: 30,
    speed: 5.1,
    halfWidth: 0.34,
    height: 0.7,
    aggro: 20,
    ink: 4,
    attack: { kind: 'melee', range: 1.5, damage: 8, cooldown: 0.8 },
    body: color('ink'),
    eyes: color('pink'),
  },
  {
    key: 'snake',
    name: '墨蛇',
    hp: 40,
    speed: 3.3,
    halfWidth: 0.32,
    height: 1.12,
    aggro: 20,
    ink: 5,
    attack: { kind: 'melee', range: 1.7, damage: 12, cooldown: 1.3 },
    body: color('ink'),
    eyes: color('green'),
  },
  {
    key: 'snake-angry',
    name: '怒墨蛇',
    hp: 55,
    speed: 4,
    halfWidth: 0.34,
    height: 1.22,
    aggro: 24,
    ink: 6,
    attack: { kind: 'lunge', range: 5, damage: 14, cooldown: 2.6, dash: 12 },
    body: color('ink'),
    eyes: color('red'),
  },
  {
    key: 'spider',
    name: '墨蛛',
    hp: 38,
    speed: 4.5,
    halfWidth: 0.74,
    height: 0.6,
    aggro: 22,
    ink: 5,
    attack: { kind: 'melee', range: 1.7, damage: 10, cooldown: 1 },
    body: color('ink'),
    eyes: color('purple'),
  },
  {
    key: 'wasp',
    name: '墨蜂',
    hp: 32,
    speed: 4.8,
    halfWidth: 0.44,
    height: 1.2,
    aggro: 23,
    ink: 5,
    attack: { kind: 'lunge', range: 5.5, damage: 11, cooldown: 2.3, dash: 13 },
    body: color('ink'),
    eyes: color('yellow'),
  },
  {
    key: 'star-mote',
    name: '墨星幼体',
    hp: 28,
    speed: 5.2,
    halfWidth: 0.31,
    height: 0.72,
    hitBottom: 0.16,
    aggro: 22,
    ink: 4,
    attack: { kind: 'lunge', range: 4, damage: 8, cooldown: 2.1, dash: 12 },
    body: color('ink'),
    eyes: color('sky'),
  },
  {
    key: 'star-orb',
    name: '墨星浮球',
    hp: 44,
    speed: 3.7,
    halfWidth: 0.4,
    height: 1.05,
    hitBottom: 0.24,
    aggro: 23,
    ink: 5,
    attack: { kind: 'melee', range: 1.65, damage: 11, cooldown: 1.1 },
    body: color('ink'),
    eyes: color('teal'),
  },
  {
    key: 'star-wing',
    name: '墨星飞翼',
    hp: 36,
    speed: 5.1,
    halfWidth: 0.53,
    height: 1.24,
    hitBottom: 0.3,
    aggro: 24,
    ink: 5,
    attack: { kind: 'lunge', range: 5.5, damage: 12, cooldown: 2.5, dash: 13 },
    body: color('ink'),
    eyes: color('purple'),
  },
  {
    key: 'star-brute',
    name: '墨星重兽',
    hp: 95,
    speed: 3.2,
    halfWidth: 0.59,
    height: 1.8,
    aggro: 22,
    ink: 9,
    attack: { kind: 'melee', range: 2.1, damage: 16, cooldown: 1.5 },
    body: color('ink'),
    eyes: color('orange'),
  },
  ...WILD_MODELS.map((model) => {
    const bulky =
      model.key.startsWith('big/') ||
      ('halfLength' in model && model.height >= 1.5) ||
      model.key === 'outbreak/Zombie_Chubby' ||
      model.key === 'cube/Giant' ||
      model.key === 'cube/Yeti' ||
      model.key === 'cyber/Enemy_Large';
    const ranged =
      model.key === 'skeleton/Skeleton_Mage' || model.key === 'blob/Wizard' || model.key === 'cube/Wizard';
    const lunges =
      'hitBottom' in model ||
      model.key === 'skeleton/Skeleton_Rogue' ||
      model.key === 'dinosaurs/Velociraptor';
    const attack: EnemyDef['attack'] = ranged
      ? { kind: 'spit', keepAway: [6, 12], range: 20, damage: 10, cooldown: 2.1, speed: 15 }
      : lunges
        ? { kind: 'lunge', range: 5, damage: 11, cooldown: 2.5, dash: 11 }
        : {
            kind: 'melee',
            range: 1.3 + ('halfLength' in model ? model.halfLength : model.halfWidth),
            damage: bulky ? 17 : 10,
            cooldown: bulky ? 1.5 : 1,
          };
    return {
      ...model,
      hp: bulky ? 85 : 40,
      speed: bulky ? 3.1 : 4,
      aggro: 22,
      ink: bulky ? 8 : 5,
      attack,
      body: color('ink'),
      eyes: color('teal'),
    };
  }),
] as const satisfies readonly EnemyDef[];

/** Index of an enemy type by key; throws on typos so content errors surface at load. */
export function enemyIndex(key: (typeof ENEMIES)[number]['key']): number {
  const i = ENEMIES.findIndex((e) => e.key === key);
  if (i < 0) throw new Error(`Unknown enemy: ${key}`);
  return i;
}
