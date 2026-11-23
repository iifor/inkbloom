/** Shared presentation for local and networked paper-plane riders. Physics stays authoritative. */
export class FlightMotion {
  blend = 0;
  bank = 0;
  pitch = 0;
  private yaw: number | null = null;

  update(dt: number, flying: boolean, yaw: number, speed: number, climb: number): void {
    const step = Math.max(0, Math.min(dt, 0.1));
    const turn =
      this.yaw === null || dt <= 0 ? 0 : Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) / dt;
    this.yaw = yaw;
    this.blend = Math.max(0, Math.min(1, this.blend + ((flying ? 1 : -1) * step) / 0.45));
    const ease = 1 - Math.exp(-5 * step);
    const bank = flying ? Math.max(-0.3, Math.min(0.3, turn * Math.min(1, speed / 8) * 0.2)) : 0;
    const pitch = flying ? Math.max(-0.18, Math.min(0.18, Math.atan2(climb, Math.max(8, speed)) * 0.25)) : 0;
    this.bank += (bank - this.bank) * ease;
    this.pitch += (pitch - this.pitch) * ease;
  }

  reset(): void {
    this.blend = this.bank = this.pitch = 0;
    this.yaw = null;
  }
}
