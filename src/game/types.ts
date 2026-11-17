// The contracts every part of the game is written against. Read this file first.
import type * as THREE from 'three';
import type { GeometryData } from '@/engine/render/geometry-builder';
import type { InkRenderer } from '@/engine/render/renderer';
import type { Input } from '@/engine/input/input';
import type { ColliderData, PhysicsWorld, Vec3Like } from '@/engine/physics/world';
import type { CityLayout } from '@/world/city/layout';
import type { WeaponKey } from '@/content/weapons';
import type { ArenaMode, ArenaState, Team } from '@/world/arena/match';
import type { ArenaSite } from '@/world/arena/site';
import type { ActKind, PlayerInfo } from '@/world/net/protocol';
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
  /**
   * Distance along a ray to something that is not a collider but still stops the brush (the
   * ink tide's curtain), or null when nothing is in the way.
   */
  brushStop?(eye: THREE.Vector3, forward: THREE.Vector3): number | null;
  dispose(): void;
}

export interface Interactable {
  readonly scene: string;
  readonly pos: THREE.Vector3;
  readonly radius: number;
  /** The prompt; null leaves the thing out (nothing to do here right now). */
  label(): string | null;
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
  readonly waterMode: 'dry' | 'wading' | 'swimming';
  /** Push the player along a direction for a moment (dodges, dash attacks). */
  dash(dir: THREE.Vector3, distance: number, seconds: number): void;
  readonly dashing: boolean;
  /** Standing on something (for footsteps). */
  readonly grounded: boolean;
  /** Horizontal speed, metres per second. */
  readonly speed: number;
  /** Shake the camera briefly (0..1). */
  shake(amount: number): void;
  /** Tip the view up by `radians`, easing back (presentation; the aim itself is unchanged). */
  punch(radians: number): void;
  /** Shove the body along a direction, metres per second. */
  knock(dir: THREE.Vector3, speed: number): void;
  /** Move at `factor` of normal speed for `seconds`. */
  slow(factor: number, seconds: number): void;
  teleport(pos: THREE.Vector3, yaw?: number): void;
}

export interface SceneApi {
  /** The wilderness, or the town the player is standing in. Towns stand in the wilderness:
   * walking through a town's wall switches this, with nothing to load in between. */
  readonly active: GameScene;
  /** Put the player in the wilderness: at `at`, or just outside the main gate of the town
   * they are in. */
  enterWild(at?: { pos: THREE.Vector3; yaw: number }): void;
  /** Where to come back after being knocked out at `near`: the main street inside a town; in
   * the wilderness, the nearest restored town's main street or the world spawn. */
  respawnPoint(near: THREE.Vector3): { pos: THREE.Vector3; yaw: number };
  /** Go to a travel stop (a restored town's main street, or an ink mark), from anywhere. */
  travelTo(id: string): void;
  /** The action at a travel stop (on `key`, F unless given): go to the next stop on the ring. */
  travelAction(from: string, key?: 'E' | 'F'): { label(): string | null; activate(): void };
  /** Go to a town's main street. */
  enterCity(entrance: Entrance): void;
}

/** A city's geometry and colliders, built ahead of time (off the main thread). */
export interface BuiltCity {
  /** Per district (see buildCity): in full, and with the houses as shells for far off. */
  readonly tiles: readonly { readonly full: GeometryData; readonly far: GeometryData }[];
  /** addBox calls to replay into the city's physics world. */
  readonly boxes: readonly {
    readonly group: string;
    readonly min: Vec3Like;
    readonly max: Vec3Like;
    readonly data: ColliderData;
  }[];
}

export interface CityApi {
  layout(entrance: Entrance): CityLayout;
  /** Start working out a city in the background (layout, geometry, colliders) so entering it
   * does not stall. Cheap to call again. */
  prefetch(entrance: Entrance): void;
  /** The city's name if its layout is ready; otherwise null (and it is prefetched). */
  nameOf(entrance: Entrance): string | null;
  /** Whether the city's prebuilt geometry and colliders are waiting to be taken. */
  ready(id: string): boolean;
  /** The city's prebuilt geometry and colliders, if ready; each is handed out once. */
  takeBuilt(id: string): BuiltCity | undefined;
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
/** How a hit lands beyond its damage. */
export interface HitOptions {
  /** Shove away from the attacker, metres per second (0 for none). */
  readonly knock?: number;
  /** A heavy blow (a blade, a shell's direct hit): the target holds still for a moment. */
  readonly heavy?: boolean;
}

export interface TargetHit {
  readonly dist: number;
  damage(amount: number, from: THREE.Vector3, opts?: HitOptions): boolean;
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
  /** The shot stopped on the world (a wall or the ground) rather than flying out of range. */
  readonly hitWorld: boolean;
  readonly killed: boolean;
}

export interface CombatApi {
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  /** `melee`: a blow that shoves the player back and slows them for a moment. */
  damagePlayer(amount: number, from: THREE.Vector3, opts?: { readonly melee?: boolean }): void;
  addTargets(source: TargetSource): () => void;
  /** A hitscan shot: hits the nearest target unless a wall is closer. */
  shoot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number): ShotResult;
  /** A melee swing; returns how many targets were hit. */
  strike(origin: THREE.Vector3, dir: THREE.Vector3, range: number, halfAngle: number, damage: number): number;
  /** An explosion with linear falloff to the edge; returns how many targets were hit. A
   * shell passes `knock` to shove what it hits; a lingering field does not. */
  blast(point: THREE.Vector3, radius: number, damage: number, knock?: number): number;
  /** Whether any target is within `radius` of a point (shells burst on contact). */
  probe(point: THREE.Vector3, radius: number): boolean;
  /** Absorbs damage before health for a while. */
  shield(amount: number, seconds: number): void;
  readonly shieldLeft: number;
  /** In the arena the server keeps this player's health: no regeneration, no death patch, no
   * respawn of its own. `hit`, `fall` and `rise` apply what the server says. */
  serverHealth(on: boolean): void;
  hit(amount: number, hp: number, from: THREE.Vector3 | null): void;
  fall(): void;
  rise(pos: THREE.Vector3, yaw: number): void;
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
  /** Set in a server world (multiplayer); absent when playing alone. */
  readonly net?: NetApi;
  /** The arena (PvP); there is one only in a server world. */
  readonly arena?: ArenaApi;
}

/** This player's view of the arena. */
export interface ArenaApi {
  readonly site: ArenaSite;
  /** Whether this player is in the arena (fighting, or waiting for a round). */
  readonly inside: boolean;
  /** How it stands, as the server last said (null until anyone has been in). */
  readonly state: ArenaState | null;
  /** This player's id on the server. */
  readonly me: number;
  /** -1 in a free-for-all or when not in the arena. */
  teamOf(id: number): Team;
  join(): void;
  leave(): void;
  vote(mode: ArenaMode): void;
  /** This player attacked or used a skill: the server decides what it hit. */
  act(w: WeaponKey, k: ActKind, o: THREE.Vector3, d: THREE.Vector3): void;
}

/** This client's part in a server world. */
export interface NetApi {
  /** Whether this client runs the town's ink tide and erosion (one player per town does). */
  keeps(town: string): boolean;
  /** Everyone else in the world. */
  readonly players: readonly PlayerInfo[];
  /** Most players the server takes. */
  readonly max: number;
  /** Why the connection went down, once it has; null while connected. */
  readonly down: string | null;
  sendPatch(patch: Patch): void;
  leave(): void;
}

export const sceneKey = (ref: SceneRef): string => (ref.kind === 'wild' ? 'wild' : `city:${ref.id}`);
