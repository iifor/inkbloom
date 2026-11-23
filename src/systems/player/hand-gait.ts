import { MathUtils } from 'three';
import { TUNING } from '@/content/tuning';
import type { PlayerApi } from '@/game/types';

export type GaitPlayer = Pick<PlayerApi, 'grounded' | 'flying' | 'gliding' | 'dashing' | 'waterMode' | 'speed'>;

/** Presentation only: actual ground speed drives the stride, never a held movement key. */
export class HandGait {
  phase = 0;
  amount = 0;
  run = 0;

  update(dt: number, player: GaitPlayer, steady = false): void {
    const ground =
      player.grounded &&
      !player.flying &&
      !player.gliding &&
      !player.dashing &&
      player.waterMode !== 'swimming';
    const pace = ground ? MathUtils.clamp(player.speed / TUNING.player.walkSpeed, 0, 1.7) : 0;
    const run = MathUtils.clamp(
      (player.speed - TUNING.player.walkSpeed) / (TUNING.player.sprintSpeed - TUNING.player.walkSpeed),
      0,
      1,
    );
    this.amount = MathUtils.damp(this.amount, Math.min(1, pace) * (steady ? 0.12 : 1), 10, dt);
    this.run = MathUtils.damp(this.run, ground && !steady ? run : 0, 8, dt);
    this.phase =
      (this.phase + dt * (5.5 + 3 * Math.max(0, pace - 1)) * Math.min(1, pace * 2)) % (Math.PI * 2);
  }
}
