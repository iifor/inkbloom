// First-person body and camera. Movement abilities (glide, grapple, mount) will be added as
// separate modules that adjust velocity here, not as branches inside this file.
import * as THREE from 'three';
import { TUNING } from '@/content/tuning';
import { type Body, makeBody } from '@/engine/physics/world';
import type { GameContext, PlayerApi, System } from '@/game/types';

import { WATER_LEVEL } from '@/world/wilderness/generator';
import { SwimArms } from './swim-arms';

const P = TUNING.player;
/** Seconds a shove carries the body before the player steers again. */
const KNOCK_SECONDS = 0.18;
/** How fast a punched view eases back (per second, exponential): gone in about 0.2 s. */
const PUNCH_RETURN = 14;

export class PlayerSystem implements System, PlayerApi {
  readonly id = 'player';
  readonly body: Body;
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  flying = false;
  /** Gliding on the paper plane this frame (for the HUD). */
  gliding = false;
  waterMode: PlayerApi['waterMode'] = 'dry';
  private swimBlend = 0;
  private readonly arms: SwimArms;
  private dashT = 0;
  private readonly dashVel = new THREE.Vector3();
  /** A shove: for a moment the body keeps the pushed velocity instead of steering. */
  private knockT = 0;
  private slowT = 0;
  private slowFactor = 1;
  /** View tipped up by a blow, easing back; added on top of pitch, never into it. */
  private punchAmt = 0;
  private airJumps = 0;
  private readonly wish = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    this.body = makeBody(new THREE.Vector3(0, 10, 0), P.halfWidth, P.height, P.stepHeight);
    this.arms = new SwimArms(ctx.renderer.camera);
  }

  get position(): THREE.Vector3 {
    return this.body.pos;
  }

  get grounded(): boolean {
    return this.body.onGround;
  }

  get speed(): number {
    return Math.hypot(this.body.vel.x, this.body.vel.z);
  }

  private shakeAmt = 0;

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  punch(radians: number): void {
    this.punchAmt = Math.min(0.08, this.punchAmt + radians);
  }

  knock(dir: THREE.Vector3, speed: number): void {
    this.body.vel.x += dir.x * speed;
    this.body.vel.z += dir.z * speed;
    this.knockT = KNOCK_SECONDS;
  }

  slow(factor: number, seconds: number): void {
    this.slowFactor = factor;
    this.slowT = Math.max(this.slowT, seconds);
  }

  get dashing(): boolean {
    return this.dashT > 0;
  }

  dash(dir: THREE.Vector3, distance: number, seconds: number): void {
    this.dashVel
      .set(dir.x, 0, dir.z)
      .normalize()
      .multiplyScalar(distance / seconds);
    this.dashT = seconds;
  }

  teleport(pos: THREE.Vector3, yaw = this.yaw): void {
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.body.onGround = false;
    this.waterMode = 'dry';
    this.swimBlend = 0;
    this.dashT = 0;
    this.gliding = false;
    this.body.height = P.height;
    this.arms.update(0, 0, this.body.vel, yaw);
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
    this.knockT -= dt;
    this.slowT -= dt;
    this.punchAmt *= Math.exp(-dt * PUNCH_RETURN);

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

    const p = this.position;
    const wet = !this.flying && this.ctx.combat.alive && p.y < WATER_LEVEL - 0.03;
    const depth = wet ? WATER_LEVEL - this.ctx.wilderness.heightAt(p.x, p.z) : 0;
    const wasSwimming = this.waterMode === 'swimming';
    const ground = this.ctx.wilderness.heightAt;
    const room = wasSwimming ? 2 : 3;
    const swim =
      depth >= (wasSwimming ? P.swimDepth - 0.25 : P.swimDepth) &&
      p.y < WATER_LEVEL - 0.35 &&
      Math.max(
        ground(p.x - room, p.z),
        ground(p.x + room, p.z),
        ground(p.x, p.z - room),
        ground(p.x, p.z + room),
      ) <
        WATER_LEVEL - 0.35;
    this.waterMode = swim ? 'swimming' : wet && depth > 0 ? 'wading' : 'dry';
    this.swimBlend = THREE.MathUtils.damp(this.swimBlend, swim ? 1 : 0, 8, dt);
    this.body.height = P.height - this.swimBlend * 0.65;
    if (this.flying) {
      this.gliding = false;
      this.fly(dt);
    } else if (this.ctx.combat.alive) this.walk(dt);
    const kicked = this.arms.update(dt, this.swimBlend, this.body.vel, this.yaw, this.pitch);
    this.syncCamera();
    if (kicked && this.waterMode === 'swimming') {
      const hands = this.arms.hands();
      for (const h of hands) h.y = WATER_LEVEL;
      this.ctx.events.emit('player:stroke', { hands, power: Math.min(1, this.speed / P.swimSpeed) });
    }
  }

  private walk(dt: number): void {
    const { input } = this.ctx;
    const b = this.body;
    const swim = this.waterMode === 'swimming';
    const wade = this.waterMode === 'wading';
    const drag = wade ? THREE.MathUtils.clamp(1 - (WATER_LEVEL - b.pos.y) * 0.42, 0.52, 0.86) : 1;
    const pace = swim
      ? P.swimSpeed * (input.held('sprint') ? 1.25 : 1)
      : (input.held('sprint') ? P.sprintSpeed : P.walkSpeed) * drag;
    const speed = pace * (this.slowT > 0 ? this.slowFactor : 1);
    // while shoved the body slides with the push; the player can't steer against it
    const accel = this.knockT > 0 ? 0 : b.onGround ? P.accelGround : P.accelAir;
    const tx = this.wish.x * speed;
    const tz = this.wish.z * speed;
    b.vel.x += THREE.MathUtils.clamp(tx - b.vel.x, -accel * dt, accel * dt);
    b.vel.z += THREE.MathUtils.clamp(tz - b.vel.z, -accel * dt, accel * dt);
    if (swim) {
      this.dashT = 0;
      this.gliding = false;
      this.airJumps = 0;
      const buoyancy = THREE.MathUtils.clamp((WATER_LEVEL - 0.72 - b.pos.y) * 5, -2.5, 3.5);
      b.vel.y = THREE.MathUtils.damp(Math.max(b.vel.y, -3), buoyancy, 9, dt);
      this.ctx.scenes.active.physics.moveBody(b, dt);
      return;
    }
    if (b.onGround) this.airJumps = P.airJumps;
    if (input.pressed('jump')) {
      if (b.onGround) {
        b.vel.y = P.jumpSpeed;
        this.ctx.events.emit('player:jump', { air: false });
      } else if (this.airJumps > 0) {
        this.airJumps--;
        b.vel.y = P.jumpSpeed * 0.9;
        this.ctx.events.emit('player:jump', { air: true });
      }
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      b.vel.x = this.dashVel.x;
      b.vel.z = this.dashVel.z;
    }
    b.vel.y -= P.gravity * dt;
    // paper plane: hold jump while falling to glide forward
    this.gliding =
      !wade && !b.onGround && b.vel.y < 0 && input.held('jump') && this.ctx.state.inventory.glider;
    if (this.gliding) {
      b.vel.y = Math.max(b.vel.y, -P.glideFall);
      const fx = -Math.sin(this.yaw) * P.glideSpeed;
      const fz = -Math.cos(this.yaw) * P.glideSpeed;
      b.vel.x += THREE.MathUtils.clamp(fx - b.vel.x, -P.accelAir * 2 * dt, P.accelAir * 2 * dt);
      b.vel.z += THREE.MathUtils.clamp(fz - b.vel.z, -P.accelAir * 2 * dt, P.accelAir * 2 * dt);
    }
    this.ctx.scenes.active.physics.moveBody(b, dt);
    if (b.landVel < -4) this.ctx.events.emit('player:land', { impact: Math.min(1, -b.landVel / 20) });
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
    const head = this.arms.head;
    this.eye.set(this.body.pos.x, this.body.pos.y + P.eyeHeight - this.swimBlend * 0.74, this.body.pos.z);
    // the stroke rocks the head: up to breathe, on with the kick (presentation only, like shake)
    const surge = this.speed > 0.3 ? (head.surge * this.swimBlend) / this.speed : 0;
    cam.position.set(
      this.eye.x + this.body.vel.x * surge,
      this.eye.y + head.lift * this.swimBlend,
      this.eye.z + this.body.vel.z * surge,
    );
    // a little shake decays quickly; it never touches the aim the player sees in yaw/pitch
    this.shakeAmt = Math.max(0, this.shakeAmt - 1 / 30);
    const s = this.shakeAmt * this.shakeAmt * 0.04;
    cam.rotation.set(
      this.pitch + this.punchAmt + head.nod * this.swimBlend + (Math.random() - 0.5) * s,
      this.yaw + (Math.random() - 0.5) * s,
      head.roll * this.swimBlend,
      'YXZ',
    );
    cam.updateMatrixWorld();
    this.forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
  }

  dispose(): void {
    this.arms.dispose();
  }
}
