import { PERSON_SPACING } from '@/engine/physics/character-contact';

export interface Visitor {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly eyeY: number;
}

type Point = { x: number; y: number; z: number };

/** Brief contact-triggered interruption; routine time stays frozen until it ends. */
export class NpcAttention {
  target: Visitor | undefined;
  private delay = 0;
  private lastClock = 0;
  private lostFor = 0;
  private checkIn = 0;
  private heldFor = 0;
  private cooldown = 0;
  private readonly contacts = new Set<number>();
  private interrupted = false;

  time(clock: number): number {
    return clock - this.delay - (this.target || this.interrupted ? Math.max(0, clock - this.lastClock) : 0);
  }

  update(
    clock: number,
    dt: number,
    at: Point,
    visitors: readonly Visitor[],
    visible: (visitor: Visitor) => boolean,
    yaw = 0,
  ): void {
    if (this.target || this.interrupted) this.delay += Math.max(0, clock - this.lastClock);
    this.interrupted = false;
    this.lastClock = clock;
    const step = Math.max(0, dt);
    this.cooldown = Math.max(0, this.cooldown - step);
    const distance = (v: Visitor) => (v.x - at.x) ** 2 + (v.z - at.z) ** 2;
    // Approximate two touching body capsules, with a wider exit threshold to
    // prevent repeated bumps at the edge. Cheap contacts are sampled every frame.
    for (const id of this.contacts) {
      const v = visitors.find((v) => v.id === id);
      if (!v || Math.abs(v.y - at.y) > 0.8 || distance(v) > (PERSON_SPACING + 0.15) ** 2)
        this.contacts.delete(id);
    }
    let bump: Visitor | undefined;
    for (const v of visitors) {
      if (Math.abs(v.y - at.y) > 0.8 || distance(v) > (PERSON_SPACING + 0.05) ** 2 || this.contacts.has(v.id))
        continue;
      this.contacts.add(v.id);
      if (
        !this.target &&
        this.cooldown === 0 &&
        visible(v) &&
        (!bump || distance(v) < distance(bump) || (distance(v) === distance(bump) && v.id < bump.id))
      )
        bump = v;
    }

    if (this.target) {
      this.heldFor += step;
      const previous = visitors.find((v) => v.id === this.target!.id);
      if (!previous || this.heldFor >= 3.2) {
        this.stop();
        return;
      }
      this.target = previous;
      this.checkIn -= step;
      if (this.checkIn > 0) return;
      const elapsed = 0.2 - this.checkIn;
      this.checkIn = 0.2;
      const dx = previous.x - at.x,
        dz = previous.z - at.z;
      const d = Math.hypot(dx, dz);
      // Allow time to turn toward a bump from behind, then use a 140-degree FOV.
      const inView =
        this.heldFor < 0.9 ||
        d < 0.1 ||
        (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d >= Math.cos((70 * Math.PI) / 180);
      const seen = Math.abs(previous.y - at.y) < 1.8 && d < 4.5 && inView && visible(previous);
      this.lostFor = seen ? 0 : this.lostFor + elapsed;
      if (this.lostFor >= 0.5) this.stop();
      return;
    }
    if (bump) {
      this.target = bump;
      this.heldFor = this.lostFor = 0;
      this.checkIn = 0.2;
    }
  }

  private stop(): void {
    this.target = undefined;
    this.checkIn = this.lostFor = this.heldFor = 0;
    this.cooldown = 3;
  }

  /** Combat takes priority over contact and freezes the same daily routine clock. */
  hold(clock: number): void {
    if (this.target || this.interrupted) this.delay += Math.max(0, clock - this.lastClock);
    this.lastClock = clock;
    this.stop();
    this.interrupted = true;
  }

  release(clock: number): void {
    if (this.target || this.interrupted) this.delay += Math.max(0, clock - this.lastClock);
    this.interrupted = false;
    this.lastClock = clock;
    this.stop();
    this.contacts.clear();
  }
}

/** Shortest arc with a bounded turn speed, including the -PI / PI seam. */
export function attentionYaw(current: number, desired: number, dt: number): number {
  const delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
  const step = Math.min(Math.abs(delta) * (1 - Math.exp(-7 * dt)), 2.8 * dt);
  return current + Math.sign(delta) * step;
}
