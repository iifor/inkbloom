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
  readonly gliding: boolean;
  /** Push the player along a direction for a moment (dodges, dash attacks). */
  dash(dir: THREE.Vector3, distance: number, seconds: number): void;
  readonly dashing: boolean;
  /** Standing on something (for footsteps). */
  readonly grounded: boolean;
  /** Horizontal speed, metres per second. */
  readonly speed: number;
  /** Shake the camera briefly (0..1). */
  shake(amount: number): void;
  teleport(pos: THREE.Vector3, yaw?: number): void;
}

export interface SceneApi {
  readonly active: GameScene;
  enterWild(at?: { pos: THREE.Vector3; yaw: number }): void;
  /** Where to come back after being knocked out at `near`: the city gate inside a city; in
   * the wilderness, the nearest restored city's tower door or the world spawn. */
  respawnPoint(near: THREE.Vector3): { pos: THREE.Vector3; yaw: number };
  /** Go to a travel stop (a restored city's tower door, or an ink mark), from anywhere. */
  travelTo(id: string): void;
  /** The F action at a travel stop: go to the next stop on the ring. */
  travelAction(from: string): { label(): string | null; activate(): void };
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

/** One thing that was hit, and a way to hurt it (returns whether it died). */
export interface TargetHit {
  readonly dist: number;
  damage(amount: number, from: THREE.Vector3): boolean;
}

/** Something the player can hit (a group of monsters registers one). */
export interface TargetSource {
  /** Nearest hit along a ray. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number): TargetHit | null;
  /** Everything within `range` and `halfAngle` of a direction (a melee swing). */
  inArc(origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number): TargetHit[];
  /** Everything within `radius` of a point (an explosion), nearest first. */
  inSphere(point: THREE.Vector3, radius: number): TargetHit[];
}

export interface ShotResult {
  readonly point: THREE.Vector3;
  /** A target (not the world) was hit. */
  readonly hitTarget: boolean;
  readonly killed: boolean;
}

export interface CombatApi {
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  damagePlayer(amount: number, from: THREE.Vector3): void;
  addTargets(source: TargetSource): () => void;
  /** A hitscan shot: hits the nearest target unless a wall is closer. */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number): ShotResult;
  /** A melee swing; returns how many targets were hit. */
  strike(origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number, damage: number): number;
  /** An explosion with linear falloff to the edge; returns how many targets were hit. */
  blast(point: THREE.Vector3, radius: number, damage: number): number;
  /** Whether any target is within `radius` of a point (shells burst on contact). */
  probe(point: THREE.Vector3, radius: number): boolean;
  /** Absorbs damage before health for a while. */
  shield(amount: number, seconds: number): void;
  readonly shieldLeft: number;
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
  readonly combat: CombatApi;
  /** The single entry point for changing saved world state. */
  apply(patch: Patch): PatchResult;
}

export const sceneKey = (ref: SceneRef): string => (ref.kind === 'wild' ? 'wild' : `city:${ref.id}`);
