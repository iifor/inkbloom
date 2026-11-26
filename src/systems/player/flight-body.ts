import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { FlightMotion } from '@/systems/figures/flight-motion';

/** First-person flight motion only. The glider and pilot are rendered by remote players. */
export class FlightBody {
  private readonly motion = new FlightMotion();
  private readonly previous = new THREE.Vector3();
  private readonly seatRotation = new THREE.Euler();
  private initialized = false;

  cameraOffset(out: THREE.Vector3, yaw: number, viewPitch: number): void {
    const { blend, bank, pitch } = this.motion;
    // Ease the eye into the forward-leaning flight pose as the glider opens.
    this.seatRotation.set(pitch * blend, yaw, bank * blend, 'YXZ');
    const height = TUNING.player.eyeHeight;
    // Looking down adds a small forward lean without drawing local flight geometry.
    const lean = THREE.MathUtils.smoothstep(-viewPitch, 0.55, 1.45) * 0.48;
    out.set(0, height - blend * 0.04, -blend * (0.66 + lean)).applyEuler(this.seatRotation);
    out.y -= height;
  }

  update(dt: number, position: THREE.Vector3, yaw: number, flying: boolean, alive: boolean): void {
    const distance = this.initialized ? position.distanceTo(this.previous) : 0;
    // Teleports and scene changes must not cause a pitching impulse.
    const valid = this.initialized && dt > 0 && distance < 20;
    const speed = valid ? Math.hypot(position.x - this.previous.x, position.z - this.previous.z) / dt : 0;
    const climb = valid ? (position.y - this.previous.y) / dt : 0;
    this.previous.copy(position);
    this.initialized = true;
    if (!alive) this.motion.reset();
    else this.motion.update(dt, flying, yaw, speed, climb);
  }
}
