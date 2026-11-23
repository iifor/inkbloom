// The wilderness and the towns that stand in it. Towns near the player are worked out ahead of
// time (in the city worker), stood up as they come within sight and taken down once far behind;
// a town's state lives in the save, not the scene. Walking through a town's wall makes it the
// active scene, and walking out makes the wilderness active again: nothing is loaded and the
// player is never moved.
import * as THREE from 'three';
import type { PhysicsWorld } from '@/engine/physics/world';
import type { GameContext, GameScene, InteractionAction, SceneApi, System } from '@/game/types';
import type { PlayerSave } from '@/world/state';
import { type Entrance, townDistance } from '@/world/wilderness/generator';
import { type CityLayout, groundAt } from '@/world/city/layout';
import { nextDestination } from '@/world/travel';
import { travelAltar } from '@/world/city/travel-altar';
import { TravelVeil } from './travel-veil';
import { friendLanding } from '@/world/friend-landing';
import { TUNING } from '@/content/tuning';
import type { CityScene } from '../city/city-scene';
import type { WildScene } from '../wilderness/wild-scene';

/** Builds a town; the mode passes this in so scenes never import the city system. */
export type CityFactory = (entrance: Entrance, layout: CityLayout, physics: PhysicsWorld) => CityScene;

/** Metres from a town's wall at which it is worked out in the background. */
const PREFETCH = 420;
/** ...stood up once its work is ready... */
const SHOW = 300;
/** ...or stood up at once, ready or not, because the player is about to see it close up. */
const SHOW_NOW = 120;
/** ...and taken down again. */
const HIDE = 480;
/** Milliseconds a frame spends putting a town together that has just come into view. */
const BUILD_MS = 3;
/** The guards of a town stay awake while the player is this close to its wall. */
const GUARDS_WAKE = 60;
/** Metres past the wall the player must go before the town or the wilderness takes over, so
 * standing in a gateway does not flip between the two. */
const THRESHOLD = 1;
/** How far outside the main gate `enterWild` puts the player. */
const OUTSIDE_GATE = 12;

const DX = [1, 0, -1, 0] as const;
const DZ = [0, 1, 0, -1] as const;

export class SceneManager implements SceneApi, System {
  readonly id = 'scenes';
  active: GameScene;
  /** Towns standing now, by city id. */
  private readonly towns = new Map<string, CityScene>();
  /** The town the player is in. */
  private city: CityScene | null = null;
  private readonly veil = new TravelVeil();
  private transfer: {
    id: string;
    near?: () => { pos: THREE.Vector3; name: string } | null;
    time: number;
    placed: boolean;
  } | null = null;
  private readonly stopTravel: () => void;

  constructor(
    private readonly ctx: GameContext,
    readonly wild: WildScene,
    private readonly makeCity: CityFactory,
  ) {
    this.active = wild;
    this.stopTravel = ctx.events.on('player:hurt', () => {
      if (!this.transfer?.placed) this.transfer = null;
      this.veil.show(0);
    });
    ctx.renderer.scene.add(wild.root);
  }

  get currentCity(): CityScene | null {
    return this.city;
  }

  private switchTo(scene: GameScene): void {
    if (this.active === scene) return;
    this.active.deactivate?.();
    this.active = scene;
    scene.activate?.();
    this.ctx.events.emit('scene:entered', { ref: scene.ref, name: scene.name });
  }

  /** Stand a town up: from its prebuilt work when ready, on the spot otherwise. It is put
   * together over the next few frames (see update); `finish` it to have it all at once. */
  private show(e: Entrance): CityScene {
    let town = this.towns.get(e.cityId);
    if (town) return town;
    town = this.makeCity(e, this.ctx.cities.layout(e), this.wild.physics);
    this.towns.set(e.cityId, town);
    this.ctx.renderer.scene.add(town.root);
    return town;
  }

  private hide(town: CityScene): void {
    if (town === this.city) return;
    this.towns.delete(town.layout.id);
    this.ctx.renderer.scene.remove(town.root);
    town.dispose();
  }

  /** Bring towns into being as the player nears them, and let them go once far behind. */
  private stream(): void {
    const p = this.ctx.player.position;
    for (const e of this.ctx.wilderness.entrancesNear(p.x, p.z, 1)) {
      if (this.towns.has(e.cityId)) continue;
      const d = townDistance(e, p.x, p.z);
      if (d > PREFETCH) continue;
      this.ctx.cities.prefetch(e);
      if (d < SHOW_NOW || (d < SHOW && this.ctx.cities.ready(e.cityId))) this.show(e);
    }
    for (const town of this.towns.values()) if (townDistance(town.entrance, p.x, p.z) > HIDE) this.hide(town);
  }

  /** Make the town the player stands in the active scene, or the wilderness once they leave. */
  private follow(): void {
    const p = this.ctx.player.position;
    if (this.city) {
      if (townDistance(this.city.entrance, p.x, p.z) <= THRESHOLD) return;
      this.city = null;
      this.switchTo(this.wild);
    }
    for (const town of this.towns.values()) {
      const e = town.entrance;
      // a whole metre inside the wall, not just on it
      if (p.x < e.ox + THRESHOLD || p.z < e.oz + THRESHOLD) continue;
      if (p.x > e.ox + e.size - THRESHOLD || p.z > e.oz + e.size - THRESHOLD) continue;
      // walked in faster than it went up: have the rest of it now
      town.finish();
      this.city = town;
      this.switchTo(town);
      this.ctx.events.emit('title', {
        text: town.layout.name,
        sub: town.peaceful ? '安宁的村庄' : town.completed ? undefined : '颜色被抽走了',
      });
      return;
    }
  }

  /** Put the player down somewhere, with the ground and any town there ready under them. */
  private place(at: { pos: THREE.Vector3; yaw: number }): void {
    this.wild.ensureAt(at.pos.x, at.pos.z);
    const town = this.ctx.wilderness.townAt(at.pos.x, at.pos.z, SHOW_NOW);
    if (town) this.show(town).finish();
    this.ctx.player.teleport(at.pos, at.yaw);
    this.follow();
  }

  enterCity(entrance: Entrance): void {
    const town = this.show(entrance);
    town.finish();
    this.place(town.spawn());
  }

  enterWild(at?: { pos: THREE.Vector3; yaw: number }): void {
    this.place(at ?? (this.city ? this.outsideOf(this.city.layout) : this.wild.spawn()));
  }

  respawnPoint(near: THREE.Vector3): { pos: THREE.Vector3; yaw: number } {
    if (this.city) return this.city.spawn();
    const options = [...this.ctx.state.cities]
      .filter(([, c]) => c.completed || c.peaceful)
      .map(([id]) => this.mainStreet(id))
      .filter((o): o is { pos: THREE.Vector3; yaw: number } => o !== null);
    options.push(this.wild.spawn());
    options.sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near));
    const best = options[0]!;
    // the player is put there next; have the ground and the town ready
    this.wild.ensureAt(best.pos.x, best.pos.z);
    const town = this.ctx.wilderness.townAt(best.pos.x, best.pos.z);
    if (town) this.show(town);
    return best;
  }

  /** Where a town's main street is, where travelling to it or coming back after a fall puts the
   * player. */
  private mainStreet(id: string): { pos: THREE.Vector3; yaw: number } | null {
    const e = this.ctx.cities.entranceOf(id);
    if (!e) return null;
    const l = this.ctx.cities.layout(e);
    return {
      pos: new THREE.Vector3(l.spawn.x, groundAt(l, l.spawn.x, l.spawn.z) + 0.05, l.spawn.z),
      yaw: l.spawn.yaw,
    };
  }

  /** Arrival at an unlocked altar or an ink mark, and its name. */
  private destination(id: string): { pos: THREE.Vector3; yaw: number; name: string } | null {
    const mark = this.ctx.state.marks.find((m) => m.id === id);
    if (mark)
      return {
        pos: new THREE.Vector3(mark.x, mark.y + 0.05, mark.z),
        yaw: this.ctx.player.yaw,
        name: `墨迹标记 ${id.slice(1)}`,
      };
    const state = this.ctx.state.cities.get(id);
    if (!state || (!state.completed && !state.peaceful)) return null;
    const e = this.ctx.cities.entranceOf(id);
    if (!e) return null;
    const layout = this.ctx.cities.layout(e);
    const altar = travelAltar(layout);
    return altar
      ? { pos: new THREE.Vector3(altar.x, altar.y + 0.26, altar.z), yaw: altar.yaw, name: layout.name }
      : null;
  }

  /** Discovered, usable altars and ink marks, the stops on the travel ring. */
  private ring(): string[] {
    const cities = [...this.ctx.state.cities]
      .filter(([, c]) => c.completed || c.peaceful)
      .map(([id]) => id)
      .filter((id) => this.destination(id) !== null);
    return [...cities, ...this.ctx.state.marks.map((m) => m.id)];
  }

  travelTo(id: string): void {
    if (this.transfer || !this.ctx.combat.alive || this.ctx.arena?.inside || !this.destination(id)) return;
    this.transfer = { id, time: 0, placed: false };
  }

  travelNear(target: () => { pos: THREE.Vector3; name: string } | null): boolean {
    if (this.transfer || !this.ctx.combat.alive || this.ctx.arena?.inside || !target()) return false;
    this.transfer = { id: '', near: target, time: 0, placed: false };
    return true;
  }

  private friendDestination(resolve: () => { pos: THREE.Vector3; name: string } | null) {
    const target = this.ctx.arena?.inside ? null : resolve();
    if (!target) return null;
    const prepared = new Set<string>();
    const prepare = (x: number, z: number): void => {
      const size = TUNING.world.chunkSize;
      const key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
      if (prepared.has(key)) return;
      prepared.add(key);
      this.wild.ensureAt(x, z);
      const town = this.ctx.wilderness.townAt(x, z, SHOW_NOW);
      if (town) this.show(town).finish();
    };
    const pos = friendLanding(
      target.pos,
      this.wild.physics,
      (x, z) => this.ctx.wilderness.heightAt(x, z),
      prepare,
    );
    return pos ? { pos, yaw: this.ctx.player.yaw, name: `${target.name}身边` } : null;
  }

  travelAction(fromCity: string, key: 'E' | 'F' = 'F'): InteractionAction {
    let progress = 0;
    let locked: string | null = null;
    let signature = '',
      chosen: string | null = null;
    const dest = (): string | null => {
      const next =
        [...this.ctx.state.cities].map(([id, c]) => `${id}:${Number(c.completed || c.peaceful)}`).join('|') +
        '/' +
        this.ctx.state.marks.map((m) => m.id).join('|');
      if (signature !== next) {
        signature = next;
        chosen = nextDestination(this.ring(), fromCity);
      }
      return locked ?? chosen;
    };
    return {
      holdSeconds: 2,
      canHold: () => {
        const p = this.ctx.player;
        return (
          !this.transfer &&
          this.ctx.combat.alive &&
          !p.flying &&
          !p.gliding &&
          !p.resting &&
          !p.gettingUp &&
          p.grounded &&
          p.waterMode !== 'swimming' &&
          this.destination(fromCity) !== null &&
          dest() !== null
        );
      },
      label: () => {
        const id = dest();
        const d = id ? this.destination(id) : null;
        return d
          ? `长按 ${key} 传送到${d.name}${progress > 0 ? ` · ${Math.floor(progress * 100)}%` : ''}`
          : null;
      },
      onHold: (value) => {
        if (value > 0 && !locked) locked = dest();
        progress = value;
        this.ctx.events.emit('travel:charge', { from: fromCity, progress });
        if (!this.transfer) this.veil.show(value * value * 0.32);
        if (value === 0) locked = null;
      },
      activate: () => {
        const id = dest();
        if (id) this.travelTo(id);
      },
    };
  }

  private updateTravel(dt: number): void {
    const t = this.transfer;
    if (!t) return;
    if (!this.ctx.combat.alive || this.ctx.arena?.inside) {
      this.transfer = null;
      this.veil.show(0);
      return;
    }
    t.time += Math.max(0, Math.min(dt, 0.1));
    this.veil.show(t.placed ? 1 - (t.time - 0.5) / 0.65 : Math.min(1, t.time / 0.35));
    if (!t.placed && t.time >= 0.5) {
      const target = t.near ? this.friendDestination(t.near) : this.destination(t.id);
      if (!target) {
        this.transfer = null;
        this.veil.show(0);
        if (t.near) this.ctx.events.emit('toast', { text: '无法传送：伙伴状态已变化，或附近没有安全落脚点' });
        return;
      }
      if (t.near) this.ctx.player.flying = false;
      this.place(target);
      t.placed = true;
      t.time = 0.5;
      this.ctx.events.emit('title', { text: target.name });
    }
    if (t.time >= 1.15) {
      this.transfer = null;
      this.veil.show(0);
    }
  }

  /** Put the player back where a save says they were. */
  restore(save: PlayerSave | null): void {
    if (!save) {
      this.place(this.wild.spawn());
      this.emitEntered();
      return;
    }
    const pos = new THREE.Vector3(save.x, save.y + 0.05, save.z);
    if (save.scene.kind === 'city') {
      const e = this.ctx.cities.entranceOf(save.scene.id);
      if (e) {
        const town = this.show(e);
        // a save from before towns stood in the wilderness has the player at city-local
        // coordinates, and one from an older layout may have them inside a house
        const inside = townDistance(e, pos.x, pos.z) === 0;
        this.place(inside && !town.wasReset ? { pos, yaw: save.yaw } : town.spawn());
        this.emitEntered();
        return;
      }
    }
    this.place({ pos, yaw: save.yaw });
    this.emitEntered();
  }

  /** Announce the wilderness when the player starts in it (follow() announced a town). */
  private emitEntered(): void {
    if (this.active !== this.wild) return;
    this.wild.activate();
    this.ctx.events.emit('scene:entered', { ref: this.wild.ref, name: this.wild.name });
  }

  /** Just outside a town's main gate, facing it. */
  private outsideOf(l: CityLayout): { pos: THREE.Vector3; yaw: number } {
    const g = l.gates.find((x) => x.main) ?? l.gates[0]!;
    const x = l.ox + (g.ix + 0.5) * l.cell - DX[g.dir]! * OUTSIDE_GATE;
    const z = l.oz + (g.iz + 0.5) * l.cell - DZ[g.dir]! * OUTSIDE_GATE;
    return {
      pos: new THREE.Vector3(x, this.ctx.wilderness.heightAt(x, z) + 0.05, z),
      yaw: Math.atan2(-DX[g.dir]!, -DZ[g.dir]!),
    };
  }

  update(dt: number): void {
    this.updateTravel(dt);
    this.wild.update(dt);
    this.stream();
    this.follow();
    const p = this.ctx.player.position;
    // one town a frame goes on being put together
    for (const town of this.towns.values())
      if (!town.ready) {
        town.build(BUILD_MS);
        break;
      }
    for (const town of this.towns.values()) town.updateDetail(this.ctx.renderer.camera);
    for (const town of this.towns.values())
      if (town === this.city) town.update(dt);
      else if (townDistance(town.entrance, p.x, p.z) < GUARDS_WAKE) town.updateOutside(dt);
  }

  dispose(): void {
    this.stopTravel();
    this.veil.dispose();
    this.transfer = null;
    this.city = null;
    for (const town of [...this.towns.values()]) this.hide(town);
    this.wild.dispose();
  }
}
