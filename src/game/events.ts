// Session-scoped event bus. Systems publish facts here instead of importing each other.
// Add an event by adding a key to GameEvents; TypeScript then checks every emit and listener.
import type { Patch } from '@/world/patch';
import type { SceneRef } from '@/world/state';

export interface GameEvents {
  'patch:applied': { readonly patch: Patch };
  'patch:rejected': { readonly patch: Patch; readonly reason: string };
  'scene:entered': { readonly ref: SceneRef; readonly name: string };
  'city:completed': { readonly city: string; readonly name: string };
  /** Damage the player actually took (after armour), what a shield absorbed, and where from. */
  'player:hurt': { readonly amount: number; readonly absorbed: number; readonly from: Point3 | null };
  'growth:level': { readonly level: number };
  'growth:points': { readonly gained: number; readonly total: number };
  'weapon:unlocked': { readonly key: string };
  // ---- feedback: sound and effects listen to these; gameplay never depends on them
  'weapon:fired': { readonly key: string };
  'weapon:skill': { readonly key: string };
  'weapon:reload': { readonly key: string };
  blast: { readonly at: Point3; readonly radius: number };
  'monster:hit': {
    readonly at: Point3;
    readonly id: number;
    readonly amount: number;
    /** Health left, 0..1. */
    readonly hp: number;
    /** The monster's live position (read it each frame to follow it) and its height. */
    readonly anchor: Point3;
    readonly height: number;
  };
  'monster:died': {
    readonly at: Point3;
    readonly id: number;
    readonly amount: number;
    /** The colours it had stolen, set free as it melts. */
    readonly colors: readonly number[];
  };
  'monster:spit': { readonly at: Point3 };
  'monster:bite': { readonly at: Point3 };
  /** A surface the brush just coloured (bloom of its colour). */
  'paint:bloom': { readonly at: Point3; readonly color: number };
  /** A surface the ink took (tide or erosion). */
  'paint:drained': { readonly at: Point3 };
  'brush:stroke': { readonly stroking: boolean };
  'tide:warning': { readonly at: Point3 };
  'tide:start': { readonly at: Point3 };
  'tide:end': { readonly held: boolean };
  /** A drop of ink falling off the tide curtain (effects only). */
  'tide:drip': { readonly at: Point3 };
  'player:jump': { readonly air: boolean };
  'player:land': { readonly impact: number };
  'player:died': { readonly lostInk: number };
  'shot:hit': { readonly killed: boolean };
  /** A bullet's streak reached the wall or ground it hit (a little after the instant hit). */
  'shot:impact': { readonly at: Point3 };
  toast: { readonly text: string; readonly seconds?: number };
}

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type Listener<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private readonly listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as Listener<E[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
