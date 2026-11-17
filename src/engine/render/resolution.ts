// Automatic resolution: watch the time between frames and draw fewer pixels when the GPU cannot
// keep up, more again when it can. Pure (it is given the clock), so it can be tested in Node.
//
// It starts where it is told (below full when the screen could take more than is safe to start
// with). Under about 45 fps for 1.5 s it steps down by a tenth (to half at most); a steady 55 fps
// or better for 8 s steps up, as far as full. A step up that turns slow again within 8 s caps the scale below
// it, so it does not flip back and forth. Gaps over 100 ms (a paused or hidden tab, a one-off
// hitch such as building a city) are ignored.

const SLOW_MS = 1000 / 45;
const FAST_MS = 1000 / 55;
const SLOW_FOR = 1500;
const FAST_FOR = 8000;
const SETTLE = 8000;
const GAP = 100;
const STEP = 0.1;
/** The lowest it goes, as a share of where it started. */
const MIN = 0.5;

export class ResolutionGovernor {
  /** Share of the quality setting's resolution to draw at, from half where it started to 1. */
  scale = 1;
  private floor = MIN;
  private cap = 1;
  private last = -1;
  private slowFor = 0;
  private fastFor = 0;
  private lastRaise = -Infinity;

  /** Start again from `start` (a new quality setting): full resolution unless told otherwise. */
  reset(start = 1): void {
    this.scale = Math.min(1, Math.max(MIN, start));
    this.floor = MIN * this.scale;
    this.cap = 1;
    this.slowFor = 0;
    this.fastFor = 0;
    this.lastRaise = -Infinity;
  }

  /** Call once per frame with the current time in ms; true when the scale changed. */
  frame(now: number): boolean {
    const dt = this.last < 0 ? -1 : now - this.last;
    this.last = now;
    if (dt <= 0 || dt > GAP) {
      this.slowFor = 0;
      this.fastFor = 0;
      return false;
    }
    if (dt > SLOW_MS) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (dt < FAST_MS) {
      this.fastFor += dt;
      this.slowFor = 0;
    }
    if (this.slowFor > SLOW_FOR && this.scale > this.floor + 1e-6) {
      // a level that was too much right after we stepped up to it stays off limits
      if (now - this.lastRaise < SETTLE) this.cap = this.scale - STEP;
      return this.set(this.scale - STEP);
    }
    if (this.fastFor > FAST_FOR && this.scale + STEP <= this.cap + 1e-6) {
      this.lastRaise = now;
      return this.set(this.scale + STEP);
    }
    return false;
  }

  private set(scale: number): boolean {
    this.scale = Math.max(this.floor, Math.round(Math.min(1, scale) * 10) / 10);
    this.slowFor = 0;
    this.fastFor = 0;
    return true;
  }
}
