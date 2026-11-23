import * as THREE from 'three';
import type { Look } from '@/content/characters';
import { TUNING } from '@/content/tuning';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { PlayerFigures } from '@/systems/figures/player-figure';
import { FlightMotion } from '@/systems/figures/flight-motion';

/** World-space pilot and wings visible from the seat, with the head outside the view model. */
export class FlightBody {
  private readonly root = new THREE.Group();
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly figures = new PlayerFigures(this.root, this.material, true);
  private readonly motion = new FlightMotion();
  private readonly previous = new THREE.Vector3();
  private readonly seatRotation = new THREE.Euler();
  private time = 0;
  private initialized = false;

  constructor(scene: THREE.Scene) {
    this.root.name = 'paper-plane-pilot';
    scene.add(this.root);
  }

  cameraOffset(out: THREE.Vector3, yaw: number, viewPitch: number): void {
    const { blend, bank, pitch } = this.motion;
    // Rotate the eye with the pilot so banking cannot bring a shoulder through the camera.
    this.seatRotation.set(pitch * blend, yaw, bank * blend, 'YXZ');
    const height = TUNING.player.eyeHeight;
    // Lean the camera forward when looking down so it sees past the open collar.
    const lean = THREE.MathUtils.smoothstep(-viewPitch, 0.55, 1.45) * 0.48;
    out.set(0, height + blend * 0.27, -blend * (0.16 + lean)).applyEuler(this.seatRotation);
    out.y -= height;
  }

  draw(dt: number, look: Look, position: THREE.Vector3, yaw: number, flying: boolean, alive: boolean): void {
    const distance = this.initialized ? position.distanceTo(this.previous) : 0;
    // Teleports and scene changes must not cause a pitching impulse.
    const valid = this.initialized && dt > 0 && distance < 20;
    const speed = valid ? Math.hypot(position.x - this.previous.x, position.z - this.previous.z) / dt : 0;
    const climb = valid ? (position.y - this.previous.y) / dt : 0;
    this.previous.copy(position);
    this.initialized = true;
    this.time += dt;
    if (!alive) this.motion.reset();
    else this.motion.update(dt, flying, yaw, speed, climb);
    this.root.visible = this.motion.blend > 0;
    this.figures.begin();
    if (this.root.visible)
      this.figures.draw(look, {
        x: position.x,
        y: position.y,
        z: position.z,
        yaw,
        pitch: 0,
        walk: 0,
        stride: 0,
        air: false,
        glide: false,
        flight: this.motion,
        hurt: 0,
        dying: -1,
        t: this.time,
      });
    this.figures.end();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.figures.dispose();
    this.material.dispose();
  }
}
