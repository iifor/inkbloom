// `window.inkbloom` in development builds: drive the game from the console or from automated
// browser checks without needing pointer lock. Not shipped in production builds.
import * as THREE from 'three';
import type { OpenWorld } from '@/modes/open-world';
import { CityScene } from '@/systems/city/city-scene';
import { FigureLineup, type LineupAct } from '@/systems/figures/lineup';
import type { Brush } from '@/systems/tools/brush';
import { profileLoop } from './profile-loop';

export function installDevTools(game: OpenWorld): void {
  if (!import.meta.env.DEV) return;
  const { ctx, scenes } = game;
  const api = {
    game,
    ctx,
    /** Move the player; y defaults to the ground. */
    teleport(x: number, z: number, y?: number) {
      // inside a town the land lies just under its paving
      const ground = ctx.wilderness.townAt(x, z)?.y ?? ctx.wilderness.heightAt(x, z);
      ctx.player.teleport(new THREE.Vector3(x, y ?? ground + 0.05, z));
    },
    look(yaw: number, pitch = 0) {
      ctx.player.yaw = yaw;
      ctx.player.pitch = pitch;
    },
    fly(on = true) {
      ctx.player.flying = on;
    },
    /** Go to the main street of the town nearest the player. */
    enterNearestCity() {
      const p = ctx.player.position;
      const e = ctx.wilderness
        .entrancesNear(p.x, p.z, 1)
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (!e) throw new Error('No town nearby');
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
    /** Stand the player characters and monsters in a row in front of the camera, acting out
     * their poses (or holding one act); `lineup(false)` takes them away. */
    lineup(on: boolean | LineupAct = true) {
      if (on === false) {
        lineup?.dispose();
        lineup = null;
        return;
      }
      if (!lineup) {
        const l = (lineup = new FigureLineup(ctx));
        let last = performance.now();
        const tick = (now: number): void => {
          if (lineup !== l) return;
          l.update(Math.min(0.1, (now - last) / 1000));
          last = now;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
      lineup.place();
      lineup.act = on === true ? 'cycle' : on;
    },
    /** GPU milliseconds per render pass, each drawn n times and waited for. */
    benchPasses: (n = 20) => ctx.renderer.benchPasses(n),
    /** Where a frame's time goes, averaged over `seconds`: each system's update on the CPU and
     * each render pass on the GPU (timer queries), in milliseconds per frame. */
    async profile(seconds = 4) {
      const { cpu, gpu, frames, calls, triangles, manual, elapsedMs } = await profileLoop(
        game.loop,
        ctx.renderer,
        seconds,
      );
      const per = (m: Map<string, number>, n: number) =>
        Object.fromEntries(
          [...m]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => [k, Math.round((v / Math.max(1, n)) * 100) / 100]),
        );
      const size = ctx.renderer.renderer.getDrawingBufferSize(new THREE.Vector2());
      return {
        hidden: manual,
        mode: manual ? 'paced-60hz' : 'animation-frame',
        fps: Math.round((frames * 1000) / elapsedMs),
        elapsedMs: Math.round(elapsedMs),
        frames,
        drawingBuffer: `${size.x}x${size.y}`,
        calls: Math.round(calls / frames),
        triangles: Math.round(triangles / frames),
        cpu: per(cpu, frames),
        gpu: per(gpu, ctx.renderer.gpuFrames),
        gpuTotal:
          Math.round(
            ([...gpu.values()].reduce((a, b) => a + b, 0) / Math.max(1, ctx.renderer.gpuFrames)) * 100,
          ) / 100,
      };
    },
  };
  let lineup: FigureLineup | null = null;
  (window as unknown as { inkbloom: typeof api }).inkbloom = api;
}
