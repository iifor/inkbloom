// First-person body and camera. Movement abilities (glide, grapple, mount) will be added as
// separate modules that adjust velocity here, not as branches inside this file.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { type Body, makeBody } from '@/engine/physics/world';
import type { GameContext, PlayerApi, System } from '@/game/types';

const P = TUNING.player;

export class PlayerSystem implements System, PlayerApi {
  readonly id = 'player';
  readonly body: Body;
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  flying = false;
  private airJumps = 0;
  private readonly wish = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    this.body = makeBody(new THREE.Vector3(0, 10, 0), P.halfWidth, P.height, P.stepHeight);
  }

  get position(): THREE.Vector3 {
    return this.body.pos;
  }

  teleport(pos: THREE.Vector3, yaw = this.yaw): void {
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.body.onGround = false;
    this.yaw = yaw;
    this.pitch = 0;
    this.syncCamera();
  }

  update(dt: number): void {
    const { input } = this.ctx;
    const look = input.takeLook();
    this.yaw += look.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch, -1.5, 1.5);
    if (input.pressed('debugFly')) this.flying = !this.flying;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let mx = 0;
    let mz = 0;
    if (input.held('forward')) mz += 1;
    if (input.held('back')) mz -= 1;
    if (input.held('right')) mx += 1;
    if (input.held('left')) mx -= 1;
    // forward (fx, fz); right is (-fz, fx)
    this.wish.set(fx * mz - fz * mx, 0, fz * mz + fx * mx);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    if (this.flying) this.fly(dt);
    else this.walk(dt);
    this.syncCamera();
  }

  private walk(dt: number): void {
    const { input } = this.ctx;
    const b = this.body;
    const speed = input.held('sprint') ? P.sprintSpeed : P.walkSpeed;
    const accel = b.onGround ? P.accelGround : P.accelAir;
    const tx = this.wish.x * speed;
    const tz = this.wish.z * speed;
    b.vel.x += THREE.MathUtils.clamp(tx - b.vel.x, -accel * dt, accel * dt);
    b.vel.z += THREE.MathUtils.clamp(tz - b.vel.z, -accel * dt, accel * dt);
    if (b.onGround) this.airJumps = P.airJumps;
    if (input.pressed('jump')) {
      if (b.onGround) b.vel.y = P.jumpSpeed;
      else if (this.airJumps > 0) {
        this.airJumps--;
        b.vel.y = P.jumpSpeed * 0.9;
      }
    }
    b.vel.y -= P.gravity * dt;
    this.ctx.scenes.active.physics.moveBody(b, dt);
    if (b.pos.y < -80) {
      const s = this.ctx.scenes.active.spawn();
      this.teleport(s.pos, s.yaw);
      this.ctx.events.emit('toast', { text: '掉出了世界，已送回出生点' });
    }
  }

  private fly(dt: number): void {
    const { input } = this.ctx;
    const b = this.body;
    const speed = P.flySpeed * (input.held('sprint') ? 3 : 1);
    let up = 0;
    if (input.held('jump')) up += 1;
    if (input.held('crouch')) up -= 1;
    b.pos.x += this.wish.x * speed * dt;
    b.pos.z += this.wish.z * speed * dt;
    b.pos.y += up * speed * dt;
    b.vel.set(0, 0, 0);
  }

  private syncCamera(): void {
    const cam = this.ctx.renderer.camera;
    this.eye.set(this.body.pos.x, this.body.pos.y + P.eyeHeight, this.body.pos.z);
    cam.position.copy(this.eye);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    this.forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
  }
}
