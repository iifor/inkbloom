// Advances the world's play clock. Cooldowns (source regrowth, later studio output and ink
// tides) read state.clock, so nothing progresses while the game is closed.
import type { GameContext, System } from '@/game/types';

export class ClockSystem implements System {
  readonly id = 'clock';
  constructor(private readonly ctx: GameContext) {}
  update(dt: number): void {
    this.ctx.state.clock += dt;
  }
}
