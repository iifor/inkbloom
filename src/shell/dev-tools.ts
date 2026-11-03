// `window.inkbloom` in development builds: drive the game from the console or from automated
// browser checks without needing pointer lock. Not shipped in production builds.
import * as THREE from 'three';
import type { OpenWorld } from '@/modes/open-world';
import { CityScene } from '@/systems/city/city-scene';
import type { Brush } from '@/systems/tools/brush';

export function installDevTools(game: OpenWorld): void {
  if (!import.meta.env.DEV) return;
  const { ctx, scenes } = game;
  const api = {
    game,
    ctx,
    /** Move the player; y defaults to the ground. */
    teleport(x: number, z: number, y?: number) {
      const ground = scenes.active.ref.kind === 'wild' ? ctx.wilderness.heightAt(x, z) : 0;
      ctx.player.teleport(new THREE.Vector3(x, y ?? ground + 0.05, z));
    },
    look(yaw: number, pitch = 0) {
      ctx.player.yaw = yaw;
      ctx.player.pitch = pitch;
    },
    fly(on = true) {
      ctx.player.flying = on;
    },
    /** Enter the city whose entrance is nearest the player. */
    enterNearestCity() {
      const p = ctx.player.position;
      const e = ctx.wilderness
        .entrancesNear(p.x, p.z, 1)
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (!e) throw new Error('No entrance nearby');
      scenes.enterCity(e);
      return e.cityId;
    },
    exitCity() {
      scenes.enterWild();
    },
    /** Hold the brush on whatever the camera points at for `seconds` of game time. */
    brush(seconds = 1.05, mode: 'restore' | 'graffiti' = 'restore') {
      const brush = game.belt.active as Brush;
      brush.mode = mode;
      ctx.input.setHeld('use', true);
      for (let t = 0; t < seconds; t += 1 / 60) game.loop.step(1 / 60);
      ctx.input.setHeld('use', false);
      game.loop.step(1 / 60);
    },
    /** Advance the simulation by n frames synchronously. */
    step(frames = 1) {
      for (let i = 0; i < frames; i++) game.loop.step(1 / 60);
    },
    info() {
      const p = ctx.player.position;
      const scene = scenes.active;
      return {
        scene: scene.ref,
        name: scene.name,
        pos: [p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100),
        yaw: ctx.player.yaw,
        progress: scene instanceof CityScene ? scene.progress() : null,
        inventory: { generic: ctx.state.inventory.generic },
        focused: ctx.interactions.focused?.label() ?? null,
        colliders: scene.physics.boxCount,
      };
    },
    /** Start an ink tide in the current city right away. */
    tide() {
      const c = scenes.currentCity;
      if (!c) throw new Error('Not in a city');
      return c.tide.trigger();
    },
    async save() {
      await game.save.flush();
    },
    /** The playtest report as Markdown (what the pause menu exports). */
    report() {
      return game.playtest.report();
    },
  };
  (window as unknown as { inkbloom: typeof api }).inkbloom = api;
}
