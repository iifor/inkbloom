// Advances the world's play clock. Cooldowns (source regrowth, later studio output and ink
// tides) read state.clock, so nothing progresses while the game is closed.
import type { GameContext, System } from '@/game/types';
import { validTimeScale } from '@/world/settings';

export class ClockSystem implements System {
  readonly id = 'clock';
  timeScale = 1;
  constructor(private readonly ctx: GameContext) {}
  update(dt: number): void {
    this.ctx.state.clock += dt;
    if (!this.ctx.net) this.ctx.state.calendarOffset += dt * (validTimeScale(this.timeScale) - 1);
  }
}
