// Session-scoped event bus. Systems publish facts here instead of importing each other.
// Add an event by adding a key to GameEvents; TypeScript then checks every emit and listener.
import type { Patch } from '@/world/patch';
import type { SceneRef } from '@/world/state';

export interface GameEvents {
  'patch:applied': { readonly patch: Patch };
  'patch:rejected': { readonly patch: Patch; readonly reason: string };
  'scene:entered': { readonly ref: SceneRef; readonly name: string };
  'city:completed': { readonly city: string; readonly name: string };
  'player:hurt': { readonly amount: number };
  'growth:level': { readonly level: number };
  'growth:points': { readonly gained: number; readonly total: number };
  'weapon:unlocked': { readonly key: string };
  'player:died': { readonly lostInk: number };
  'shot:hit': { readonly killed: boolean };
  toast: { readonly text: string; readonly seconds?: number };
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
