// One world, many players. A WorldState holds both the shared world (cities, harvested sources,
// hunted monsters, the clock) and one player's own things (inventory, growth, colours, drop,
// marks, ruins found, position). In multiplayer every player has their own slice of the second
// kind; the world server keeps them all, a client keeps its own. To run a patch for a player,
// their slice is swapped into the state, applyPatch runs as it always has, and it is swapped
// back out. So the rules in patch.ts never need to know there is more than one player.
import { PALETTE } from '@/content/palette';
import { type WorldState, createWorldState, deserializeWorld, serializeWorld } from '../state';

/** Everything in a WorldState that belongs to one player. */
export interface PlayerSlice {
  inventory: WorldState['inventory'];
  unlocked: WorldState['unlocked'];
  growth: WorldState['growth'];
  drop: WorldState['drop'];
  marks: WorldState['marks'];
  nextMark: WorldState['nextMark'];
  discovered: WorldState['discovered'];
  player: WorldState['player'];
}

const KEYS = [
  'inventory',
  'unlocked',
  'growth',
  'drop',
  'marks',
  'nextMark',
  'discovered',
  'player',
] as const;

/** The slice the state holds now (the same objects, not copies). */
export function takeSlice(state: WorldState): PlayerSlice {
  return {
    inventory: state.inventory,
    unlocked: state.unlocked,
    growth: state.growth,
    drop: state.drop,
    marks: state.marks,
    nextMark: state.nextMark,
    discovered: state.discovered,
    player: state.player,
  };
}

export function putSlice(state: WorldState, slice: PlayerSlice): void {
  for (const k of KEYS) (state as unknown as Record<string, unknown>)[k] = slice[k];
}

/** Run `fn` with `slice` swapped into the state; what it changes ends up in `slice`. */
export function withSlice<T>(state: WorldState, slice: PlayerSlice, fn: () => T): T {
  const own = takeSlice(state);
  putSlice(state, slice);
  try {
    return fn();
  } finally {
    Object.assign(slice, takeSlice(state));
    putSlice(state, own);
  }
}

/** A new player's slice: what a new world starts a player with. */
export function newSlice(): PlayerSlice {
  return takeSlice(createWorldState('player', 0));
}

/**
 * A stand-in with plenty of everything, for running another player's patch on a client: the
 * server has already checked it against that player's real slice, so only its effect on the
 * shared world matters here, and what it pays out is thrown away.
 */
export function standInSlice(): PlayerSlice {
  const s = newSlice();
  const lots = 1e9;
  s.inventory.generic = lots;
  s.inventory.ink = lots;
  s.unlocked = PALETTE.flatMap((c, i) => (c.paintable ? [i] : []));
  return s;
}

/** A slice as text, checked on the way back in by the world save's own validation. */
export function serializeSlice(slice: PlayerSlice): string {
  const state = createWorldState('player', 0);
  putSlice(state, slice);
  return serializeWorld(state);
}

/** Throws SaveError (from deserializeWorld) when the text is not a valid slice. */
export function deserializeSlice(text: string): PlayerSlice {
  return takeSlice(deserializeWorld(text));
}
