// The arena: a ring of ink walls round a stretch of real wilderness where players fight each
// other (online only). Rules in world/arena/match.ts, the place in world/arena/site.ts.
// design: docs/game-design.md section 9.4

export const ARENA = {
  /** Metres from the centre to the wall. */
  radius: 45,
  /** How far from the world's spawn the site may be: far enough that nobody stumbles on it. */
  nearest: 1500,
  farthest: 3000,
  /** No town within this many metres of the centre (towns are only a few hundred metres apart). */
  townClear: 60,
  /** The ground inside: dry, rolling (this much rise from lowest to highest), not cliffs. */
  minRelief: 2,
  maxRelief: 14,
  /** Most a sample may rise above its neighbour 6 m away. */
  maxStep: 3.5,
  minTrees: 8,
  wall: { segments: 48, height: 4.5, thickness: 0.6 },
  /** Spawn points on a ring this far out. */
  spawnRing: 36,
  spawns: 10,

  hp: 100,
  /** Seconds lying down before getting up again, then seconds nobody can hurt you. */
  respawn: 3,
  grace: 2,
  countdown: 10,
  results: 10,
  /** A round ends at this many kills (a player's in a free-for-all, a team's in teams) or time. */
  killsFfa: 10,
  killsTeams: 20,
  roundSeconds: 300,

  /** Skills are softer against players than against monsters. design: 9.3 */
  slash: { damage: 25, range: 9, halfAngle: 0.35 },
  shield: { amount: 25, seconds: 4 },
  focus: { seconds: 4, multiplier: 1.5 },
  bigShell: { damage: 60, area: 9 },
  field: { radius: 4, seconds: 4, every: 0.5, damage: 9 },
  /** A launcher shell: as systems/tools/weapons.ts fires it (forward, kicked up a little). */
  shell: { speed: 30, lift: 3, gravity: 9, life: 3, probe: 1 },

  /** Server checks: a shot leaves from within this many metres of where the shooter was, and
   * may be rewound at most this far to where its target was on the shooter's screen. */
  reach: 4,
  rewind: 0.2,
  /** Remote players are drawn this far in the past (systems/net/remote-players.ts). */
  viewDelay: 0.1,
} as const;

/** Cover: stone blocks laid out round the centre. dx/dz from the centre, w across x, d across
 * z, h above the highest ground under it (metres). Mirror-symmetric so no side is favoured. */
export const ARENA_COVER: readonly { dx: number; dz: number; w: number; d: number; h: number }[] = [
  // the middle: a low cross to fight over
  { dx: 0, dz: 0, w: 6, d: 1.2, h: 1.2 },
  { dx: 0, dz: 0, w: 1.2, d: 6, h: 1.2 },
  // an inner ring of corners
  ...[
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ].flatMap(([sx, sz]) => [
    { dx: sx! * 14, dz: sz! * 14, w: 5, d: 1, h: 2.2 },
    { dx: sx! * 16, dz: sz! * 12, w: 1, d: 4, h: 2.2 },
  ]),
  // long walls further out, to run behind
  { dx: 0, dz: 27, w: 9, d: 1.2, h: 2.6 },
  { dx: 0, dz: -27, w: 9, d: 1.2, h: 2.6 },
  { dx: 27, dz: 0, w: 1.2, d: 9, h: 2.6 },
  { dx: -27, dz: 0, w: 1.2, d: 9, h: 2.6 },
  // a few lone blocks to crouch behind
  { dx: 22, dz: 20, w: 2, d: 2, h: 1.4 },
  { dx: -22, dz: -20, w: 2, d: 2, h: 1.4 },
  { dx: -20, dz: 22, w: 2, d: 2, h: 1.4 },
  { dx: 20, dz: -22, w: 2, d: 2, h: 1.4 },
];
