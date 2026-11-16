// A GameContext without a browser: real state, patches, events and combat; a stub player and
// input that a test moves by hand. Systems built on it run in Node, so their rules can be
// stepped frame by frame without WebGL or the DOM.
import * as THREE from 'three';
import { PhysicsWorld } from '@/engine/physics/world';
import { EventBus, type GameEvents } from '@/game/events';
import type { GameContext, GameScene, PlayerApi } from '@/game/types';
import { CombatSystem } from '@/systems/combat/combat';
import type { CitySkeleton } from '@/world/city/features';
import { applyPatch } from '@/world/patch';
import { createWorldState } from '@/world/state';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface Headless {
  readonly ctx: GameContext;
  readonly combat: CombatSystem;
  readonly physics: PhysicsWorld;
  /** Actions the stub input reports as held. */
  readonly held: Set<string>;
  /** Every event emitted, in order. */
  readonly log: { type: keyof GameEvents; payload: unknown }[];
  /** Put the player's feet at a point, looking along `look` (default -z). */
  place(x: number, y: number, z: number, look?: THREE.Vector3): void;
  /** Advance the game clock and run `update` in fixed steps. */
  run(seconds: number, update: (dt: number) => void, dt?: number): void;
  count(type: keyof GameEvents): number;
}

const EYE_HEIGHT = 1.6;

export function headless(opts: { cities?: Record<string, CitySkeleton> } = {}): Headless {
  const ctx = {} as Mutable<GameContext>;
  const log: Headless['log'] = [];
  const held = new Set<string>();
  ctx.state = createWorldState('test', 1);
  const events = new EventBus<GameEvents>();
  const emit = events.emit.bind(events);
  events.emit = (type, payload) => {
    log.push({ type, payload });
    emit(type, payload);
  };
  ctx.events = events;
  ctx.input = { held: (a: string) => held.has(a), pressed: () => false } as unknown as GameContext['input'];
  ctx.apply = (patch) => {
    const result = applyPatch(ctx.state, patch, {
      cityOf: (id) => opts.cities?.[id] ?? null,
      sourceOf: () => null,
      ruinOf: () => null,
      wildMonsterOf: () => null,
    });
    if (result.ok) events.emit('patch:applied', { patch });
    else events.emit('patch:rejected', { patch, reason: result.reason });
    return result;
  };

  const position = new THREE.Vector3();
  const eye = new THREE.Vector3(0, EYE_HEIGHT, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const player: PlayerApi = {
    eye,
    forward,
    position,
    yaw: 0,
    pitch: 0,
    flying: false,
    gliding: false,
    dashing: false,
    grounded: true,
    speed: 0,
    dash: () => {},
    shake: () => {},
    teleport: (pos) => place(pos.x, pos.y, pos.z),
  };
  ctx.player = player;

  const physics = new PhysicsWorld(8);
  const scene: GameScene = {
    ref: { kind: 'wild' },
    name: 'test',
    root: new THREE.Group(),
    physics,
    spawn: () => ({ pos: new THREE.Vector3(), yaw: 0 }),
    update: () => {},
    dispose: () => {},
  };
  ctx.scenes = {
    active: scene,
    enterWild: () => {},
    enterCity: () => {},
    travelTo: () => {},
    travelAction: () => ({ label: () => null, activate: () => {} }),
    respawnPoint: () => ({ pos: new THREE.Vector3(), yaw: 0 }),
  };
  const combat = new CombatSystem(ctx);
  ctx.combat = combat;

  function place(x: number, y: number, z: number, look?: THREE.Vector3): void {
    position.set(x, y, z);
    eye.set(x, y + EYE_HEIGHT, z);
    if (look) forward.copy(look).normalize();
  }

  return {
    ctx,
    combat,
    physics,
    held,
    log,
    place,
    run(seconds, update, dt = 1 / 30) {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        ctx.state.clock += dt;
        update(dt);
      }
    },
    count: (type) => log.filter((e) => e.type === type).length,
  };
}
