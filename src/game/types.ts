// The contracts every part of the game is written against. Read this file first.
import type * as THREE from 'three';
import type { InkRenderer } from '@/engine/render/renderer';
import type { Input } from '@/engine/input/input';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { CityLayout } from '@/world/city/layout';
import type { Patch, PatchResult } from '@/world/patch';
import type { SceneRef, WorldState } from '@/world/state';
import type { Entrance, Wilderness } from '@/world/wilderness/generator';
import type { EventBus, GameEvents } from './events';

/** A per-frame unit of behaviour. Systems run in the order a mode lists them. */
export interface System {
  readonly id: string;
  update?(dt: number): void;
  dispose?(): void;
}

/** A place the player can be: the wilderness, a city, later interiors. */
export interface GameScene {
  readonly ref: SceneRef;
  readonly name: string;
  readonly root: THREE.Group;
  readonly physics: PhysicsWorld;
  /** Where to put the player when entering without a saved position. */
  spawn(): { readonly pos: THREE.Vector3; readonly yaw: number };
  update(dt: number): void;
  /** Called each time the scene becomes active (set shared shader state here). */
  activate?(): void;
  /** Called when the scene stops being active. Scenes may stay cached. */
  deactivate?(): void;
  dispose(): void;
}

export interface Interactable {
  readonly scene: string;
  readonly pos: THREE.Vector3;
  readonly radius: number;
  label(): string;
  activate(): void;
  /** Optional second action on F, shown under the main prompt (null hides it). */
  alt?: { label(): string | null; activate(): void };
}

export interface PlayerApi {
  readonly eye: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly position: THREE.Vector3;
  yaw: number;
  pitch: number;
  flying: boolean;
  teleport(pos: THREE.Vector3, yaw?: number): void;
}

export interface SceneApi {
  readonly active: GameScene;
  enterWild(at?: { pos: THREE.Vector3; yaw: number }): void;
  enterCity(entrance: Entrance): void;
}

export interface CityApi {
  layout(entrance: Entrance): CityLayout;
  /** Layout by id, if it has been generated this session. */
  byId(id: string): CityLayout | undefined;
  entranceOf(id: string): Entrance | undefined;
  /** 0..1 share of coloured surfaces, from saved state alone. */
  progress(id: string): number;
}

export interface InteractionApi {
  add(item: Interactable): () => void;
  readonly focused: Interactable | null;
}

export interface GameContext {
  readonly renderer: InkRenderer;
  readonly input: Input;
  readonly events: EventBus<GameEvents>;
  readonly state: WorldState;
  readonly wilderness: Wilderness;
  readonly player: PlayerApi;
  readonly scenes: SceneApi;
  readonly cities: CityApi;
  readonly interactions: InteractionApi;
  /** The single entry point for changing saved world state. */
  apply(patch: Patch): PatchResult;
}

export const sceneKey = (ref: SceneRef): string => (ref.kind === 'wild' ? 'wild' : `city:${ref.id}`);
