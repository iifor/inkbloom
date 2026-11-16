// The mood of the view. Each frame it tells the renderer how much colour is around the player
// (the sky turns from a pencil sketch to a painted blue sky with it) and how far the ink tide
// has drained the world (black and white, ink closing in from the edges). A listener like
// audio and effects: gameplay never reads it.
import type { GameContext, System } from '@/game/types';
import { saturationAt } from '@/world/wilderness/drain';

/** Gloom while a tide is announced, and while it rolls. */
const WARNING_GLOOM = 0.35;
const TIDE_GLOOM = 1;

export class AtmosphereSystem implements System {
  readonly id = 'atmosphere';
  private colour: number;
  private gloom = 0;
  private gloomTarget = 0;
  private sampleT = 0;
  private colourTarget: number;
  private readonly release: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {
    this.colourTarget = this.colour = this.sample();
    const set = (g: number) => () => void (this.gloomTarget = g);
    this.release.push(
      ctx.events.on('tide:warning', set(WARNING_GLOOM)),
      ctx.events.on('tide:start', set(TIDE_GLOOM)),
      ctx.events.on('tide:end', set(0)),
      // tides only run in the city the player is in; leaving it pauses them
      ctx.events.on('scene:entered', () => {
        this.gloomTarget = 0;
        this.sampleT = 0;
      }),
    );
  }

  /** How much colour is around the player, 0..1. */
  private sample(): number {
    const { player, scenes, cities, wilderness } = this.ctx;
    const ref = scenes.active.ref;
    if (ref.kind === 'city') return cities.progress(ref.id);
    const p = player.position;
    const near = wilderness
      .entrancesNear(p.x, p.z, 1)
      .map((e) => ({ x: e.x, z: e.z, progress: cities.progress(e.cityId) }));
    return saturationAt(p.x, p.z, near);
  }

  update(dt: number): void {
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 0.5;
      this.colourTarget = this.sample();
    }
    // colour comes back slowly; the tide's gloom rolls in faster than it lifts
    this.colour += (this.colourTarget - this.colour) * Math.min(1, dt * 0.8);
    const rate = this.gloomTarget > this.gloom ? 1.2 : 0.5;
    this.gloom += (this.gloomTarget - this.gloom) * Math.min(1, dt * rate);
    const a = this.ctx.renderer.atmosphere;
    a.colour = this.colour;
    a.gloom = this.gloom;
  }

  dispose(): void {
    for (const r of this.release) r();
  }
}
