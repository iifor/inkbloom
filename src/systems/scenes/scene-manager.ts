// Switches between the wilderness and city instances. The wilderness stays cached while the
// player is in a city; a city is disposed on exit (its state lives in the save, not the scene).
import * as THREE from 'three';
import type { GameContext, GameScene, SceneApi, System } from '@/game/types';
import type { PlayerSave } from '@/world/state';
import type { Entrance } from '@/world/wilderness/generator';
import { nextDestination } from '@/world/travel';
import { CityScene } from '../city/city-scene';
import type { WildScene } from '../wilderness/wild-scene';

export class SceneManager implements SceneApi, System {
  readonly id = 'scenes';
  active: GameScene;
  private city: CityScene | null = null;
  /** Where the player stood in the wilderness before entering the current city. */
  private wildReturn: { pos: THREE.Vector3; yaw: number } | null = null;

  constructor(
    private readonly ctx: GameContext,
    readonly wild: WildScene,
  ) {
    this.active = wild;
    ctx.renderer.scene.add(wild.root);
  }

  get currentCity(): CityScene | null {
    return this.city;
  }

  private switchTo(scene: GameScene): void {
    if (this.active === scene) return;
    this.active.deactivate?.();
    this.ctx.renderer.scene.remove(this.active.root);
    this.active = scene;
    this.ctx.renderer.scene.add(scene.root);
    scene.activate?.();
    this.ctx.events.emit('scene:entered', { ref: scene.ref, name: scene.name });
  }

  enterCity(entrance: Entrance): void {
    if (this.city?.layout.id === entrance.cityId) return;
    const { player } = this.ctx;
    if (this.active === this.wild)
      this.wildReturn = { pos: player.position.clone(), yaw: player.yaw + Math.PI };
    this.leaveCity();
    const layout = this.ctx.cities.layout(entrance);
    this.city = new CityScene(this.ctx, entrance, layout);
    this.switchTo(this.city);
    const s = this.city.spawn();
    player.teleport(s.pos, s.yaw);
    this.ctx.events.emit('toast', { text: `${layout.name}：颜色被抽走了` });
  }

  enterWild(at?: { pos: THREE.Vector3; yaw: number }): void {
    const target = at ?? this.wildReturn ?? this.outsideOf(this.city?.entrance) ?? this.wild.spawn();
    this.wild.ensureAt(target.pos.x, target.pos.z);
    this.switchTo(this.wild);
    this.leaveCity();
    this.ctx.player.teleport(target.pos, target.yaw);
    this.wildReturn = null;
  }

  respawnPoint(near: THREE.Vector3): { pos: THREE.Vector3; yaw: number } {
    if (this.active !== this.wild) return this.active.spawn();
    const options = [...this.ctx.state.cities]
      .filter(([, c]) => c.completed)
      .map(([id]) => this.outsideOf(this.ctx.cities.entranceOf(id)))
      .filter((o): o is { pos: THREE.Vector3; yaw: number } => o !== null);
    options.push(this.wild.spawn());
    options.sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near));
    const best = options[0]!;
    this.wild.ensureAt(best.pos.x, best.pos.z);
    return best;
  }

  /** Where a travel id (restored city or ink mark) puts the player, and what it is called. */
  private destination(id: string): { pos: THREE.Vector3; yaw: number; name: string } | null {
    const mark = this.ctx.state.marks.find((m) => m.id === id);
    if (mark)
      return {
        pos: new THREE.Vector3(mark.x, mark.y + 0.05, mark.z),
        yaw: this.ctx.player.yaw,
        name: `墨迹标记 ${id.slice(1)}`,
      };
    const e = this.ctx.cities.entranceOf(id);
    const target = this.outsideOf(e);
    return e && target ? { ...target, name: this.ctx.cities.layout(e).name } : null;
  }

  /** Restored cities and ink marks, the stops on the travel ring. */
  private ring(): string[] {
    const cities = [...this.ctx.state.cities].filter(([, c]) => c.completed).map(([id]) => id);
    return [...cities, ...this.ctx.state.marks.map((m) => m.id)];
  }

  travelTo(id: string): void {
    const target = this.destination(id);
    if (!target) return;
    if (this.active === this.wild) {
      this.wild.ensureAt(target.pos.x, target.pos.z);
      this.ctx.player.teleport(target.pos, target.yaw);
    } else this.enterWild({ pos: target.pos, yaw: target.yaw });
    this.ctx.events.emit('toast', { text: `传送到${target.name}`, seconds: 3 });
  }

  travelAction(fromCity: string): { label(): string | null; activate(): void } {
    const dest = (): string | null => nextDestination(this.ring(), fromCity);
    return {
      label: () => {
        const id = dest();
        const d = id ? this.destination(id) : null;
        return d ? `F 传送到${d.name}` : null;
      },
      activate: () => {
        const id = dest();
        if (id) this.travelTo(id);
      },
    };
  }

  /** Put the player back where a save says they were. */
  restore(save: PlayerSave | null): void {
    const pos = save ? new THREE.Vector3(save.x, save.y, save.z) : null;
    if (save?.scene.kind === 'city') {
      const e = this.ctx.cities.entranceOf(save.scene.id);
      if (e) {
        this.enterCity(e);
        this.wildReturn = this.outsideOf(e);
        // a saved spot in a city whose layout changed may now be inside a building
        if (pos && !this.city?.wasReset) this.ctx.player.teleport(pos, save.yaw);
        return;
      }
    }
    if (pos) {
      this.wild.ensureAt(pos.x, pos.z);
      this.ctx.player.teleport(pos.setY(pos.y + 0.05), save!.yaw);
    } else {
      const s = this.wild.spawn();
      this.ctx.player.teleport(s.pos, s.yaw);
    }
    this.wild.activate();
    this.ctx.events.emit('scene:entered', { ref: this.wild.ref, name: this.wild.name });
  }

  private outsideOf(e: Entrance | undefined): { pos: THREE.Vector3; yaw: number } | null {
    if (!e) return null;
    // in front of the tower door: clear of the widest tower base (8 m) and within 3.5 m of the
    // door prompt for every tower size (7.5–10.5 m out), so F at a tower keeps cycling
    const x = e.x + e.door[0] * 11;
    const z = e.z + e.door[1] * 11;
    this.wild.ensureAt(x, z);
    return {
      pos: new THREE.Vector3(x, this.ctx.wilderness.heightAt(x, z) + 0.05, z),
      yaw: Math.atan2(-e.door[0], -e.door[1]),
    };
  }

  private leaveCity(): void {
    if (!this.city) return;
    if (this.active === this.city) {
      this.ctx.renderer.scene.remove(this.city.root);
      this.active = this.wild;
    }
    this.city.dispose();
    this.city = null;
  }

  update(dt: number): void {
    this.active.update(dt);
  }

  dispose(): void {
    this.leaveCity();
    this.wild.dispose();
  }
}
