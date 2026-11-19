// First-person body and camera. Movement abilities (glide, grapple, mount) will be added as
// separate modules that adjust velocity here, not as branches inside this file.
import * as THREE from 'three';
import { BIOMES } from '@/content/biomes';
import type { Look } from '@/content/characters';
import { color } from '@/content/palette';
import { TUNING } from '@/content/tuning';
import { type Body, makeBody } from '@/engine/physics/world';
import type { GameContext, PlayerApi, System } from '@/game/types';

import { WATER_LEVEL } from '@/world/wilderness/generator';
import { pathsOf } from '@/world/wilderness/paths';
import { spawnStoneDistance } from '@/world/wilderness/spawn-circle';
import { villageLawnKind } from '@/world/city/lawn';
import { JumpWindow } from './jump-window';
import { SwimArms } from './swim-arms';
import { WalkArms } from './walk-arms';
import type { InHand } from '@/systems/tools/tool';

const P = TUNING.player;
/** Seconds a shove carries the body before the player steers again. */
const KNOCK_SECONDS = 0.18;
/** How fast a punched view eases back (per second, exponential): gone in about 0.2 s. */
const PUNCH_RETURN = 14;
/** Ease discrete stair corrections without delaying horizontal movement or jump velocity. */
const STEP_RETURN = 18;
const LAND_RECOVERY = 0.28;
const GRASS = color('grass');
const REST_EYE = { sitting: 0.95, lying: 0.27 } as const;
const REST_SECONDS = { sitting: 0.8, lying: 1.05, standing: 0.52 } as const;

export class PlayerSystem implements System, PlayerApi {
  readonly id = 'player';
  readonly body: Body;
  readonly eye = new THREE.Vector3();
  readonly forward = new THREE.Vector3(0, 0, -1);
  yaw = 0;
  pitch = 0;
  private inFlight = false;
  private flightDrop = false;
  private landRecovery = 0;
  private waitForGliderRelease = false;
  /** Gliding on the paper plane this frame (for the HUD). */
  gliding = false;
  waterMode: PlayerApi['waterMode'] = 'dry';
  resting: PlayerApi['resting'] = null;
  private restDrop = 0;
  private restTilt = 0;
  private restRoll = 0;
  private restTransition = { time: 1, drop: 0, tilt: 0, roll: 0, phase: 0 };
  private beforeLyingPitch = 0;
  private swimBlend = 0;
  private readonly arms: SwimArms;
  private readonly walkArms: WalkArms;
  private dashT = 0;
  private readonly dashVel = new THREE.Vector3();
  /** A shove: for a moment the body keeps the pushed velocity instead of steering. */
  private knockT = 0;
  private slowT = 0;
  private slowFactor = 1;
  /** View tipped up by a blow, easing back; added on top of pitch, never into it. */
  private punchAmt = 0;
  private airJumps = 0;
  private readonly jump = new JumpWindow(P.coyoteTime, P.jumpBuffer);
  /** Head bob: step phase and how much of it shows (eases in and out with walking). */
  private bobPhase = 0;
  private bobAmt = 0;
  /** How far the camera has dipped from a landing, springing back. */
  private dip = 0;
  private stepOffset = 0;
  private readonly wish = new THREE.Vector3();

  constructor(private readonly ctx: GameContext) {
    this.body = makeBody(new THREE.Vector3(0, 10, 0), P.halfWidth, P.height, P.stepHeight);
    this.arms = new SwimArms(ctx.renderer.camera);
    this.walkArms = new WalkArms(ctx.renderer.camera);
  }

  get position(): THREE.Vector3 {
    return this.body.pos;
  }

  get flying(): boolean {
    return this.inFlight;
  }

  set flying(value: boolean) {
    if (this.inFlight === value) return;
    this.inFlight = value;
    this.flightDrop = !value;
    this.waitForGliderRelease = !value && this.ctx.input.held('jump');
    this.landRecovery = 0;
    this.body.onGround = false;
    this.body.vel.y = 0;
    this.airJumps = 0;
    this.jump.consume();
  }

  get falling(): boolean {
    return (
      !this.flying &&
      !this.gliding &&
      this.waterMode !== 'swimming' &&
      (this.landRecovery > 0 || (!this.grounded && (this.flightDrop || this.body.vel.y < -P.fallSafeSpeed)))
    );
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
    this.body.landVel = 0;
    this.waterMode = 'dry';
    this.resting = null;
    this.restDrop = this.restTilt = this.restRoll = 0;
    this.restTransition.time = 1;
    this.swimBlend = 0;
    this.stepOffset = 0;
    this.dip = 0;
    this.body.groundStep = 0;
    this.dashT = 0;
    this.flightDrop = false;
    this.landRecovery = 0;
    this.waitForGliderRelease = false;
    this.airJumps = 0;
    this.jump.consume();
    this.gliding = false;
    this.body.height = P.height;
    this.arms.update(0, 0, this.body.vel, yaw);
    this.walkArms.resetFallPose();
    this.yaw = yaw;
    this.pitch = 0;
    this.syncCamera();
  }

  private canRest(posture: 'sitting' | 'lying'): boolean {
    const { wilderness, scenes, cities } = this.ctx;
    const scene = scenes.active;
    const { x, y, z } = this.position;
    const h = wilderness.heightAt(x, z);
    if (h <= WATER_LEVEL + 0.2 || Math.abs(y - h) > 0.12) return false;
    const townId = scene.ref.kind === 'city' ? scene.ref.id : wilderness.townAt(x, z)?.cityId;
    const town = townId ? cities.byId(townId) : undefined;
    if (town) {
      if (villageLawnKind(town, x, z) !== 1) return false;
    } else {
      if (scene.ref.kind === 'city' || BIOMES[wilderness.biomeAt(x, z)]?.ground !== GRASS) return false;
      if (spawnStoneDistance(x, z) <= 0) return false;
      const paths = pathsOf(wilderness);
      if (paths.edgeDistance(x, z) < 0.2 || paths.bridgeAt(x, z)) return false;
    }
    const room = posture === 'sitting' ? 0.6 : 0.9;
    for (const dx of [-1, 0, 1])
      for (const dz of [-1, 0, 1]) {
        const ground = wilderness.heightAt(x + dx * room, z + dz * room);
        if (ground <= WATER_LEVEL + 0.05 || Math.abs(ground - h) > 0.27) return false;
      }
    return (
      scene.physics.query(
        { x: x - room, y: y + 0.02, z: z - room },
        { x: x + room, y: y + P.height, z: z + room },
      ).length === 0
    );
  }

  private setRest(next: PlayerApi['resting']): void {
    if (next === this.resting) return;
    const viewPitch = this.pitch + this.restTilt;
    if (this.resting === 'lying') this.pitch = this.beforeLyingPitch;
    if (next === 'lying') {
      this.beforeLyingPitch = this.pitch;
      this.pitch = 1.25;
    }
    this.restTilt = viewPitch - this.pitch;
    this.restTransition = {
      time: 0,
      drop: this.restDrop,
      tilt: this.restTilt,
      roll: this.restRoll,
      phase: Math.random() * Math.PI * 2,
    };
    this.resting = next;
  }

  private updateRestView(dt: number): void {
    const t = this.restTransition;
    if (t.time >= 1) return;
    t.time = Math.min(1, t.time + dt / REST_SECONDS[this.resting ?? 'standing']);
    const ease = THREE.MathUtils.smoothstep(t.time, 0, 1);
    const target = this.resting ? P.eyeHeight - REST_EYE[this.resting] : 0;
    this.restDrop = THREE.MathUtils.lerp(t.drop, target, ease);
    this.restTilt = t.tilt * (1 - ease);
    // One gentle, randomly phased sway per motion. It starts and ends at rest.
    const sway = t.time === 1 ? 0 : Math.sin(Math.PI * t.time) * Math.sin(t.phase + 9 * t.time);
    this.restRoll = t.roll * (1 - ease) + sway * 0.009;
  }

  update(dt: number): void {
    const { input } = this.ctx;
    const look = input.takeLook();
    this.yaw += look.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch, -1.5, 1.5);
    if (input.pressed('debugFly')) this.flying = !this.flying;
    if (!input.held('jump')) this.waitForGliderRelease = false;
    this.landRecovery = Math.max(0, this.landRecovery - dt);
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
    const swim = p.y < WATER_LEVEL - 0.35 && this.canSwimAt(p.x, p.z, depth, wasSwimming);
    this.waterMode = swim ? 'swimming' : wet && depth > 0 ? 'wading' : 'dry';
    const requested = input.pressed('lieDown') ? 'lying' : input.pressed('sit') ? 'sitting' : null;
    if (this.resting || requested) {
      const canStay =
        !this.ctx.arena?.inside &&
        this.ctx.combat.alive &&
        this.grounded &&
        !this.flying &&
        !this.dashing &&
        this.knockT <= 0 &&
        this.waterMode === 'dry' &&
        !input.held('jump') &&
        !input.held('forward') &&
        !input.held('back') &&
        !input.held('left') &&
        !input.held('right');
      if (!canStay) this.setRest(null);
      if (requested) {
        if (canStay && this.speed < 0.25 && this.canRest(requested)) this.setRest(requested);
        else this.ctx.events.emit('toast', { text: '停下来，在干燥开阔的草地上休息' });
      }
    }
    this.updateRestView(dt);
    this.swimBlend = THREE.MathUtils.damp(this.swimBlend, swim ? 1 : 0, 8, dt);
    this.body.height = P.height - this.swimBlend * 0.65;
    this.body.groundStep = 0;
    if (this.flying) {
      this.gliding = false;
      this.fly(dt);
    } else if (this.ctx.combat.alive) this.walk(dt);
    if (this.flying || this.waterMode === 'swimming') this.stepOffset = 0;
    else {
      this.stepOffset =
        THREE.MathUtils.clamp(this.stepOffset - this.body.groundStep, -P.stepHeight, P.stepHeight) *
        Math.exp(-dt * STEP_RETURN);
    }
    this.stepFeel(dt);
    const kicked = this.arms.update(dt, this.swimBlend, this.body.vel, this.yaw, this.pitch);
    this.syncCamera();
    if (kicked && this.waterMode === 'swimming') {
      const hands = this.arms.hands();
      for (const h of hands) h.y = WATER_LEVEL;
      this.ctx.events.emit('player:stroke', { hands, power: Math.min(1, this.speed / P.swimSpeed) });
    }
  }

  private canSwimAt(x: number, z: number, depth: number, alreadySwimming = false): boolean {
    if (depth < P.swimDepth - (alreadySwimming ? 0.25 : 0)) return false;
    const ground = this.ctx.wilderness.heightAt;
    const room = alreadySwimming ? 2 : 3;
    return (
      Math.max(ground(x - room, z), ground(x + room, z), ground(x, z - room), ground(x, z + room)) <
      WATER_LEVEL - 0.35
    );
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
      this.flightDrop = false;
      this.landRecovery = 0;
      this.airJumps = 0;
      const buoyancy = THREE.MathUtils.clamp((WATER_LEVEL - 0.72 - b.pos.y) * 5, -2.5, 3.5);
      b.vel.y = THREE.MathUtils.damp(Math.max(b.vel.y, -3), buoyancy, 9, dt);
      this.ctx.scenes.active.physics.moveBody(b, dt);
      return;
    }
    if (b.onGround) this.airJumps = P.airJumps;
    const pressed = input.pressed('jump');
    if (this.jump.update(dt, b.onGround, pressed)) {
      b.vel.y = P.jumpSpeed;
      this.ctx.events.emit('player:jump', { air: false });
    } else if (pressed && this.jump.airborne && this.airJumps > 0) {
      this.jump.consume();
      this.airJumps--;
      b.vel.y = P.jumpSpeed * 0.9;
      this.ctx.events.emit('player:jump', { air: true });
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      b.vel.x = this.dashVel.x;
      b.vel.z = this.dashVel.z;
    }
    b.vel.y = Math.max(-P.terminalFallSpeed, b.vel.y - P.gravity * dt);
    // paper plane: hold jump while falling to glide forward
    this.gliding =
      !wade &&
      !b.onGround &&
      b.vel.y < 0 &&
      !this.waitForGliderRelease &&
      input.held('jump') &&
      this.ctx.state.inventory.glider;
    if (this.gliding) {
      b.vel.y = Math.max(b.vel.y, -P.glideFall);
      const fx = -Math.sin(this.yaw) * P.glideSpeed;
      const fz = -Math.cos(this.yaw) * P.glideSpeed;
      b.vel.x += THREE.MathUtils.clamp(fx - b.vel.x, -P.accelAir * 2 * dt, P.accelAir * 2 * dt);
      b.vel.z += THREE.MathUtils.clamp(fz - b.vel.z, -P.accelAir * 2 * dt, P.accelAir * 2 * dt);
    }
    const down = -b.vel.y;
    const wasAboveWater = b.pos.y >= WATER_LEVEL - 0.03;
    this.ctx.scenes.active.physics.moveBody(b, dt);
    this.finishFall(down, wasAboveWater);
    if (b.pos.y < -80) {
      const s = this.ctx.scenes.active.spawn();
      this.teleport(s.pos, s.yaw);
      this.ctx.events.emit('toast', { text: '掉出了世界，已送回出生点' });
    }
  }

  private finishFall(down: number, wasAboveWater: boolean): void {
    const b = this.body;
    const { x, y, z } = b.pos;
    const submerged = y < WATER_LEVEL - 0.03 && (b.onGround || wasAboveWater);
    const depth = submerged ? WATER_LEVEL - this.ctx.wilderness.heightAt(x, z) : 0;
    // A fast fall can cross the surface and hit the bed in the same physics frame.
    if (submerged && wasAboveWater && down > 4 && this.canSwimAt(x, z, depth)) {
      b.pos.y = WATER_LEVEL - 0.72;
      b.vel.y = -2;
      b.onGround = false;
      this.waterMode = 'swimming';
      this.flightDrop = false;
      this.landRecovery = 0;
      this.ctx.events.emit('player:land', { impact: Math.min(1, down / 20), water: true });
      return;
    }
    if (!b.onGround) return;
    const speed = -b.landVel;
    if (this.flightDrop || speed > P.fallSafeSpeed) this.landRecovery = LAND_RECOVERY;
    this.flightDrop = false;
    this.gliding = false;
    if (speed <= 4) return;
    if (depth > 0) this.waterMode = 'wading';
    const impact = Math.min(1, speed / 20);
    this.dip = Math.max(this.dip, impact * P.landDip);
    this.ctx.events.emit('player:land', { impact, water: depth > 0 });
    if (speed > P.fallSafeSpeed) {
      // Impact energy grows with speed squared, above the safe landing threshold.
      const fraction = (speed ** 2 - P.fallSafeSpeed ** 2) / (P.fallSevereSpeed ** 2 - P.fallSafeSpeed ** 2);
      this.ctx.combat.damagePlayer(Math.ceil(TUNING.combat.playerHp * fraction), undefined, { fall: true });
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
    // free flight still keeps out of the ground (feet a little over it, or over the water) and
    // under a ceiling high enough to see the land as a map
    const floor = Math.max(this.ctx.wilderness.heightAt(b.pos.x, b.pos.z), WATER_LEVEL) + 0.2;
    b.pos.y = THREE.MathUtils.clamp(b.pos.y + up * speed * dt, floor, Math.max(floor, P.flyCeiling));
    b.vel.set(0, 0, 0);
  }

  /** Head bob from walking and the spring back from a landing dip (presentation only). */
  private stepFeel(dt: number): void {
    const walking = this.body.onGround && !this.flying && this.waterMode !== 'swimming';
    const pace = walking ? Math.min(1.6, this.speed / P.walkSpeed) : 0;
    this.bobAmt = THREE.MathUtils.damp(this.bobAmt, pace, 10, dt);
    // about two steps a second at a walk, quicker at a run
    this.bobPhase += dt * (5.5 + 3 * Math.max(0, pace - 1)) * Math.min(1, pace * 2);
    this.dip *= Math.exp(-dt * 9);
  }

  private syncCamera(): void {
    const cam = this.ctx.renderer.camera;
    const head = this.arms.head;
    // The aim origin follows the stair-smoothed view, so a brush or shot still matches
    // the crosshair. The collision body stays on the real tread throughout.
    this.eye.set(
      this.body.pos.x,
      this.body.pos.y + P.eyeHeight + this.stepOffset - this.swimBlend * 0.74 - this.restDrop,
      this.body.pos.z,
    );
    // the stroke rocks the head: up to breathe, on with the kick (presentation only, like shake)
    const surge = this.speed > 0.3 ? (head.surge * this.swimBlend) / this.speed : 0;
    // walking: the head rises and falls with each step and sways a little; a landing dips it.
    // Only the camera moves; the eye that aims and paints stays put.
    const bob = this.bobAmt * P.bob;
    const sway = Math.cos(this.bobPhase) * bob * 0.5;
    cam.position.set(
      this.eye.x + this.body.vel.x * surge + Math.cos(this.yaw) * sway,
      this.eye.y +
        head.lift * this.swimBlend +
        Math.abs(Math.sin(this.bobPhase)) * bob -
        bob * 0.5 -
        this.dip,
      this.eye.z + this.body.vel.z * surge - Math.sin(this.yaw) * sway,
    );
    // a little shake decays quickly; it never touches the aim the player sees in yaw/pitch
    this.shakeAmt = Math.max(0, this.shakeAmt - 1 / 30);
    const s = this.shakeAmt * this.shakeAmt * 0.04;
    cam.rotation.set(
      THREE.MathUtils.clamp(this.pitch + this.restTilt, -1.5, 1.5) +
        this.punchAmt +
        head.nod * this.swimBlend +
        (Math.random() - 0.5) * s,
      this.yaw + (Math.random() - 0.5) * s,
      head.roll * this.swimBlend + this.restRoll,
      'YXZ',
    );
    cam.updateMatrixWorld();
    this.forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
  }

  /** Draw the swimming arms in this character's skin and coat. */
  setLook(look: Look): void {
    this.arms.setLook(look);
    this.walkArms.setLook(look);
  }

  /** Runs after the tool belt so switching/swimming never draws two sets of hands. */
  updateHands(dt: number, held: InHand): void {
    const brace = this.falling
      ? this.grounded
        ? 0.25 + 0.45 * (this.landRecovery / LAND_RECOVERY)
        : THREE.MathUtils.clamp(0.5 - this.body.vel.y / 55, 0.5, 1)
      : 0;
    this.walkArms.update(
      dt,
      this,
      held,
      this.ctx.combat.alive && this.swimBlend <= 0.025 && !this.resting,
      brace,
    );
  }

  dispose(): void {
    this.arms.dispose();
    this.walkArms.dispose();
  }
}
