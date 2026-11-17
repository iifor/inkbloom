// Forgiving jumps. A jump pressed a moment after running off a ledge still counts as a jump
// from the ground (coyote time), and one pressed a moment before landing fires on landing
// (the jump buffer). Without these, jumps the player clearly meant are silently dropped.
export class JumpWindow {
  private sinceGround = Infinity;
  private buffered = 0;

  constructor(
    /** Seconds after leaving the ground that a jump still counts as from the ground. */
    private readonly coyote: number,
    /** Seconds a press is remembered while it cannot be used yet. */
    private readonly buffer: number,
  ) {}

  /** Off the ground for longer than the coyote time: a press now is an air jump. */
  get airborne(): boolean {
    return this.sinceGround > this.coyote;
  }

  /** Call once a frame. True when a ground jump should happen now. */
  update(dt: number, onGround: boolean, pressed: boolean): boolean {
    this.sinceGround = onGround ? 0 : this.sinceGround + dt;
    this.buffered = pressed ? this.buffer : Math.max(0, this.buffered - dt);
    if (this.buffered <= 0 || this.sinceGround > this.coyote) return false;
    this.consume();
    return true;
  }

  /** The press was used (by a ground jump, or an air jump): forget it, and the ground. */
  consume(): void {
    this.buffered = 0;
    this.sinceGround = Infinity;
  }
}
