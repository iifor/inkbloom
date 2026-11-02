// Runs systems in order every animation frame. A frame that throws stops the loop instead of
// repeating a broken state; the error is reported through onError.
import type { System } from './types';

export class Loop {
  private frame = 0;
  private last = 0;
  private running = false;

  constructor(
    private readonly systems: readonly System[],
    private readonly before: () => void,
    private readonly after: () => void,
    private readonly onError: (e: unknown) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (): void => {
      if (!this.running) return;
      try {
        this.step();
        this.frame = requestAnimationFrame(tick);
      } catch (e) {
        this.running = false;
        this.onError(e);
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** One frame. Exposed so tooling can advance the game deterministically. */
  step(dtOverride?: number): void {
    const now = performance.now();
    const dt = dtOverride ?? Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.before();
    for (const s of this.systems) s.update?.(dt);
    this.after();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }
}
