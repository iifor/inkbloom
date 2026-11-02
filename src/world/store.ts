// Where saves live. The game only talks to WorldStore, so swapping browser storage for the
// local world server (planned for multiplayer) does not touch any system.
import { type WorldState, deserializeWorld, serializeWorld } from './state';

export interface WorldStore {
  load(id: string): Promise<WorldState | null>;
  save(state: WorldState): Promise<void>;
  remove(id: string): Promise<void>;
  /** Move an unreadable save aside so a new one can be created. Returns where it went. */
  quarantine(id: string): Promise<string | null>;
}

/** Minimal subset of the Web Storage API so tests can pass a Map-backed fake. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class KeyValueStore implements WorldStore {
  constructor(
    private readonly kv: KeyValue,
    private readonly prefix = 'inkbloom:world:',
  ) {}

  async load(id: string): Promise<WorldState | null> {
    const text = this.kv.getItem(this.prefix + id);
    // A missing save and a corrupt save are different: corrupt ones throw.
    return text === null ? null : deserializeWorld(text);
  }

  async save(state: WorldState): Promise<void> {
    this.kv.setItem(this.prefix + state.id, serializeWorld(state));
  }

  async remove(id: string): Promise<void> {
    this.kv.removeItem(this.prefix + id);
  }

  async quarantine(id: string): Promise<string | null> {
    const text = this.kv.getItem(this.prefix + id);
    if (text === null) return null;
    const backup = `${this.prefix}${id}:corrupt-${Date.now()}`;
    this.kv.setItem(backup, text);
    this.kv.removeItem(this.prefix + id);
    return backup;
  }
}

/**
 * The browser's localStorage when it works, otherwise an in-memory fallback (private mode,
 * disabled storage). `persistent` tells the caller whether saves survive a reload.
 */
export function browserKeyValue(): { kv: KeyValue; persistent: boolean } {
  try {
    const probe = 'inkbloom:probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { kv: localStorage, persistent: true };
  } catch {
    return { kv: new MemoryKeyValue(), persistent: false };
  }
}

export class MemoryKeyValue implements KeyValue {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}
