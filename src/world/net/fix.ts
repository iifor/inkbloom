// The server's word on the shared world. Clients apply their own patches at once and others'
// as they arrive, so two players acting on the same thing can end up seeing it differently
// (one restores a wall while the keeper's erosion drains it). So with every shared change the
// server also sends the values it ended with, in the order it applied the changes, to everyone,
// the sender included; each client sets them. Whatever the order things arrived in, everyone
// ends on the server's values.
import type { CitySave, WorldState } from '../state';
import type { InkSite, InfectedPerson } from '../infection';

/** Index -> value pairs. */
type Pairs = [number, number][];

export interface CityFix {
  readonly id: string;
  readonly states?: Pairs;
  readonly stains?: Pairs;
  readonly defeated?: Pairs;
  readonly coloredOnce?: Pairs;
  readonly stockFrom?: Pairs;
  readonly completed?: boolean;
  readonly restoredAt?: number | null;
  readonly peaceful?: boolean;
  readonly altarGuards?: number;
}

export interface Fix {
  readonly infectedPerson?: [string, InfectedPerson | null];
  readonly inkArea?: [string, InkSite | null];
  readonly city?: CityFix;
  /** Wilderness source / monster id -> clock time it was harvested / hunted (for a monster,
   * null: not hunted, so a kill the server refused comes back). */
  readonly harvested?: [string, number][];
  readonly hunted?: [string, number | null][];
  /** Ink well id -> clock time it was cleansed, or null: not cleansed (a refused cleanse is
   * taken back). Wells, unlike sources and monsters, never come back by themselves. */
  readonly cleansed?: [string, number | null][];
}

const ARRAYS = ['states', 'stains', 'defeated', 'coloredOnce'] as const;

function diff(before: ArrayLike<number> | undefined, after: ArrayLike<number>): Pairs | undefined {
  const out: Pairs = [];
  for (let i = 0; i < after.length; i++) if (!before || before[i] !== after[i]) out.push([i, after[i]!]);
  return out.length ? out : undefined;
}

/** What changed in a town between two of its saves (everything, with no `before`). */
export function cityFix(id: string, before: CitySave | undefined, after: CitySave): CityFix | undefined {
  const fix: Record<string, unknown> = { id };
  for (const k of ARRAYS) {
    const d = diff(before?.[k], after[k]);
    if (d) fix[k] = d;
  }
  const stock = diff(before?.stockFrom, after.stockFrom);
  if (stock) fix.stockFrom = stock;
  if (!before || before.completed !== after.completed) fix.completed = after.completed;
  if (!before || before.restoredAt !== after.restoredAt) fix.restoredAt = after.restoredAt;
  if (!before || before.peaceful !== after.peaceful) fix.peaceful = after.peaceful;
  if (!before || (before.altarGuards ?? 0) !== (after.altarGuards ?? 0)) fix.altarGuards = after.altarGuards ?? 0;
  return Object.keys(fix).length > 1 ? (fix as unknown as CityFix) : undefined;
}

/** What a fix changed on this client, so the town on screen can catch up. */
export interface Changed {
  readonly city: string | null;
  /** Surfaces whose state changed. */
  readonly surfaces: number[];
  /** Stains newly soaked up, guards newly defeated. */
  readonly stains: number[];
  readonly defeated: number[];
}

/** Set the server's values. A town this client has no save for yet is left alone (its save
 * arrives with the patch that creates it). Malformed parts are skipped. */
export function applyFix(state: WorldState, fix: Fix | null | undefined): Changed {
  const changed: Changed = { city: null, surfaces: [], stains: [], defeated: [] };
  if (!fix) return changed;
  for (const [map, entry] of [[state.infectedPeople, fix.infectedPerson], [state.inkAreas, fix.inkArea]] as const) {
    if (!entry) continue;
    if (entry[1]) map.set(entry[0], entry[1]); else map.delete(entry[0]);
  }
  const c = fix.city;
  const saved = c ? state.cities.get(c.id) : undefined;
  if (c && saved) {
    const set = (arr: Uint8Array | number[], pairs: Pairs | undefined, out?: number[]): void => {
      for (const [i, v] of pairs ?? []) {
        if (!Number.isInteger(i) || i < 0 || i >= arr.length || !Number.isFinite(v)) continue;
        if (arr[i] === v) continue;
        arr[i] = v;
        out?.push(i);
      }
    };
    (changed as { city: string | null }).city = c.id;
    set(saved.states, c.states, changed.surfaces);
    set(
      saved.stains,
      c.stains?.filter(([, v]) => v === 1),
      changed.stains,
    );
    set(
      saved.stains,
      c.stains?.filter(([, v]) => v !== 1),
    );
    set(
      saved.defeated,
      c.defeated?.filter(([, v]) => v === 1),
      changed.defeated,
    );
    set(
      saved.defeated,
      c.defeated?.filter(([, v]) => v !== 1),
    );
    set(saved.coloredOnce, c.coloredOnce);
    set(saved.stockFrom, c.stockFrom);
    if (typeof c.completed === 'boolean') saved.completed = c.completed;
    if (
      c.restoredAt === null ||
      (typeof c.restoredAt === 'number' && Number.isFinite(c.restoredAt) && c.restoredAt >= 0)
    )
      saved.restoredAt = c.restoredAt;
    if (typeof c.peaceful === 'boolean') saved.peaceful = c.peaceful;
    if (Number.isInteger(c.altarGuards) && c.altarGuards! >= 0 && c.altarGuards! <= 7) saved.altarGuards = c.altarGuards;
  }
  for (const [k, t] of fix.harvested ?? [])
    if (typeof k === 'string' && Number.isFinite(t)) state.harvested.set(k, t);
  for (const [k, t] of fix.hunted ?? [])
    if (typeof k !== 'string') continue;
    else if (t === null) state.hunted.delete(k);
    else if (Number.isFinite(t)) state.hunted.set(k, t);
  for (const [k, t] of fix.cleansed ?? [])
    if (typeof k !== 'string') continue;
    else if (t === null) state.cleansed.delete(k);
    else if (Number.isFinite(t)) state.cleansed.set(k, t);
  return changed;
}
