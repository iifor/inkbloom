// Posing a player figure for one frame: walking and running, jumping, gliding and swimming, the
// upper body following where they look, what is in hand (player-hold.ts), a flinch, the cloth
// trailing behind, and being swallowed by ink.
import type { Gesture, HeldItem } from '@/world/net/protocol';
import { heldIn, holdPose } from './player-hold';
import type { Rig } from './player-rig';
import { swimArms } from './player-swim';
import { restHands } from './player-rest';

/** What a player's figure is doing this frame. */
export interface PlayerPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Where they look up (+) or down (-), radians; the upper body follows it. */
  readonly pitch: number;
  /** Walk cycle phase, radians. */
  readonly walk: number;
  /** 0 standing, 1 walking, up to 1.7 sprinting (speed over walking speed). */
  readonly stride: number;
  readonly air: boolean;
  readonly glide: boolean;
  /** F2 flight: seated on a paper plane; angles tilt rider and vehicle together. */
  readonly flight?: { readonly blend: number; readonly bank: number; readonly pitch: number };
  /** Swimming in deep water: lying along the surface, arms stroking, legs kicking. */
  readonly swim?: boolean;
  /** Blend from standing into the two resting poses. */
  readonly rest?: {
    readonly sitting: number;
    readonly lying: number;
    readonly groundPitch: number;
    readonly groundRoll: number;
  };
  /** 0..1 flinch from a hit, or 0. */
  readonly hurt: number;
  /** 0..1 through being swallowed by ink, or -1 while alive. */
  readonly dying: number;
  /** Seconds, for breathing and trailing cloth. */
  readonly t: number;
  /** What is in hand, if anything. */
  readonly held?: HeldItem | null;
  /** An attack or skill being acted out, and how far through it (0..1). */
  readonly action?: { readonly kind: Gesture; readonly t: number } | null;
  /** 0 a gun held low, 1 sighting down it. */
  readonly aim?: number;
  /** 0..1 working a surface with the brush. */
  readonly paint?: number;
}

const JOINTS = [
  'hips',
  'torso',
  'head',
  'armL',
  'armR',
  'foreL',
  'foreR',
  'legL',
  'legR',
  'shinL',
  'shinR',
  'footL',
  'footR',
] as const;

function poseRest(r: Rig, { sitting, lying }: NonNullable<PlayerPose['rest']>): void {
  const standing = 1 - sitting - lying;
  const blend = (upright: number, seated: number, flat: number): number =>
    upright * standing + seated * sitting + flat * lying;
  const seatHeight = 0.12;
  const seatTilt = 0.55;
  // The imported outfits have different torso/arm ratios. Recline only as far as
  // their shoulder height requires to plant the wrists without stretching bones.
  const reachLength = r.armLengths ? r.armLengths[0] + r.armLengths[1] : 0.59;
  const chestBase =
    seatHeight + r.torso.position.y * Math.cos(seatTilt) - r.torso.position.z * Math.sin(seatTilt);
  const shoulderRadius = Math.hypot(r.armR.position.y, r.armR.position.z);
  const seatTorso = Math.max(
    0.12,
    Math.acos(Math.max(-1, Math.min(1, (reachLength - 0.025 - chestBase) / shoulderRadius))) -
      Math.atan2(r.armR.position.z, r.armR.position.y) -
      seatTilt,
  );
  const backTilt = 1.5;
  r.hips.position.y = blend(r.hips.position.y, seatHeight, 0.22);
  r.hips.rotation.x = blend(r.hips.rotation.x, seatTilt, backTilt);
  r.torso.rotation.x = blend(r.torso.rotation.x, seatTorso, 0.015);
  r.head.rotation.x = blend(r.head.rotation.x, -(seatTilt + seatTorso) * 0.65, -0.04);
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? -1 : 1;
    const leg = r[`leg${side}`];
    const shin = r[`shin${side}`];
    const foot = r[`foot${side}`];
    const arm = r[`arm${side}`].rotation;
    const fore = r[`fore${side}`].rotation;
    const thighPitch = 1.62 - sign * 0.06;
    // Fit the knee bend to each rig's own thigh, shin and ankle lengths. The soles stay close
    // to their neutral height while the ankles keep the boots pointed forward.
    const kneeY =
      seatHeight +
      leg.position.y * Math.cos(seatTilt) -
      leg.position.z * Math.sin(seatTilt) +
      shin.position.y * Math.cos(thighPitch) -
      shin.position.z * Math.sin(thighPitch);
    const ankleY = r.hipsY + leg.position.y + shin.position.y + foot.position.y + 0.02;
    const shinLength = Math.hypot(foot.position.y, foot.position.z);
    const shinPitch =
      Math.acos(Math.max(0, Math.min(1, (kneeY - ankleY) / shinLength))) +
      Math.atan2(foot.position.z, -foot.position.y);
    const flatThighPitch = 1.57 + sign * 0.025;
    const flatShinPitch = 1.54;
    leg.rotation.set(
      blend(leg.rotation.x, thighPitch - seatTilt, flatThighPitch - backTilt),
      blend(leg.rotation.y, -sign * 0.13, -sign * 0.08),
      0,
      'YXZ',
    );
    shin.rotation.x = blend(shin.rotation.x, shinPitch - thighPitch, flatShinPitch - flatThighPitch);
    foot.rotation.x = blend(0, 0.14 - shinPitch, 1.14 - flatShinPitch);
    arm.x = blend(arm.x, 0.34, -0.23);
    arm.z = blend(arm.z, sign * 0.2, sign * 0.34);
    fore.x = blend(fore.x, 0.15, 0.09);
    fore.z = blend(fore.z, -sign * 0.15, -sign * 0.06);
  }
  restHands(r, sitting, lying);
}

/** Pose a rig for one frame (exported for tests). */
export function posePlayer(r: Rig, p: PlayerPose): void {
  for (const k of JOINTS) r[k].rotation.set(0, 0, 0, 'XYZ');
  if (r.gripOffset) {
    for (const side of ['L', 'R'] as const) {
      const palm = r[`palm${side}`];
      palm.quaternion.identity();
      palm.position.copy(r.gripOffset);
      if (side === 'L') palm.position.x *= -1;
      palm.position.y -= r.armLengths![1];
    }
  }
  const s = Math.sin(p.walk);
  const w = Math.min(1, p.stride);
  const run = Math.max(0, Math.min(1, p.stride - 1) / 0.7);
  // walking and running: legs and arms swing opposite, knees bend, a bob each step
  const swing = 0.6 + 0.35 * run;
  r.legL.rotation.x = s * swing * w;
  r.legR.rotation.x = -s * swing * w;
  r.shinL.rotation.x = -(0.08 + (0.7 + 0.6 * run) * Math.max(0, -s)) * w;
  r.shinR.rotation.x = -(0.08 + (0.7 + 0.6 * run) * Math.max(0, s)) * w;
  // Keep the shoulders quiet; bend and open each elbow through the step instead of
  // holding a fixed elbow angle and swinging the whole arm as one rigid piece.
  const upperSwing = (0.16 + 0.1 * run) * w;
  const elbowRest = 0.15 + (0.5 + 0.65 * run) * w;
  const elbowSwing = (0.4 + 0.25 * run) * w;
  const elbowPhase = Math.sin(p.walk - 0.18);
  r.armL.rotation.set(-s * upperSwing, 0, -0.1);
  r.armR.rotation.set(s * upperSwing, 0, 0.1);
  r.foreL.rotation.x = elbowRest - elbowPhase * elbowSwing;
  r.foreR.rotation.x = elbowRest + elbowPhase * elbowSwing;
  r.hips.position.y = r.hipsY - 0.02 * w + Math.abs(Math.cos(p.walk)) * (0.03 + 0.04 * run) * w;
  // at a run the body leans into it; at rest it breathes
  r.torso.rotation.x = -(0.05 * w + 0.18 * run);
  r.torso.scale.set(1, 1 + 0.012 * Math.sin(p.t * 1.9 + p.x), 1);
  // the upper body follows where they look, the head most
  r.torso.rotation.x += p.pitch * 0.25;
  r.head.rotation.x = p.pitch * 0.45 + Math.sin(p.t * 0.7 + p.z) * 0.03;

  let lift = 0;
  if (p.swim) {
    // lying along the water with the head up out of it: a crawl stroke and a flutter kick,
    // the whole body sunk so the head rides at the surface
    r.hips.position.y = r.hipsY - 0.78;
    r.hips.rotation.x = -1.25;
    r.head.rotation.x = 1.05 + p.pitch * 0.3;
    swimArms(r, p.walk);
    r.legL.rotation.x = Math.sin(p.walk * 2) * 0.35;
    r.legR.rotation.x = -Math.sin(p.walk * 2) * 0.35;
    r.shinL.rotation.x = r.shinR.rotation.x = -0.2;
    r.torso.rotation.x = 0;
    lift = 0.4;
  } else if (p.glide) {
    // the paper plane held overhead, legs trailing
    r.armL.rotation.set(2.9, 0, -0.25);
    r.armR.rotation.set(2.9, 0, 0.25);
    r.foreL.rotation.x = r.foreR.rotation.x = 0.2;
    r.legL.rotation.x = -0.25;
    r.legR.rotation.x = -0.1;
    r.shinL.rotation.x = r.shinR.rotation.x = -0.5;
    r.torso.rotation.x = -0.2;
    lift = 1;
  } else if (p.air) {
    r.legL.rotation.x = 0.7;
    r.legR.rotation.x = -0.15;
    r.shinL.rotation.x = -1.2;
    r.shinR.rotation.x = -0.5;
    r.armL.rotation.set(0.6, 0, -0.6);
    r.armR.rotation.set(-0.3, 0, 0.6);
    lift = 0.6;
  }
  if (p.rest) poseRest(r, p.rest);
  if (p.flight && p.flight.blend > 0 && p.dying < 0) {
    const f = p.flight.blend;
    const blend = (from: number, to: number): number => from + (to - from) * f;
    r.hips.position.y = blend(r.hips.position.y, 1.02);
    r.hips.rotation.x *= 1 - f;
    r.torso.rotation.x = blend(r.torso.rotation.x, -0.12);
    r.head.rotation.x = blend(r.head.rotation.x, p.pitch * 0.4);
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? -1 : 1;
      const leg = r[`leg${side}`].rotation;
      leg.set(blend(leg.x, 1.42), blend(leg.y, -sign * 0.18), 0);
      r[`shin${side}`].rotation.x = blend(r[`shin${side}`].rotation.x, -0.88);
      r[`foot${side}`].rotation.x = -0.38 * f;
      const arm = r[`arm${side}`].rotation;
      arm.set(blend(arm.x, 0.4), 0, blend(arm.z, sign * 0.25));
      r[`fore${side}`].rotation.x = blend(r[`fore${side}`].rotation.x, 0.65);
    }
    lift = f;
  }
  const item = heldIn(p);
  if (item) holdPose(r, p, item);
  if (p.hurt > 0) {
    r.torso.rotation.x += p.hurt * 0.35;
    r.head.rotation.x += p.hurt * 0.3;
  }
  // cloth and hair trail behind with speed, lift in the air and sway a little at rest
  for (const tr of r.trails) {
    const sway = Math.sin(p.t * 2.3 + tr.drag * 3 + p.x) * 0.06;
    tr.node.rotation.set(
      tr.rest.x + tr.drag * (0.35 * w + 0.5 * run + 0.6 * lift) + sway,
      tr.rest.y,
      tr.rest.z + Math.sin(p.walk) * 0.12 * w * tr.drag,
    );
  }

  r.root.position.set(p.x, p.y, p.z);
  const onGround = p.rest ? p.rest.sitting + p.rest.lying : 0;
  r.root.rotation.set(
    (p.rest?.groundPitch ?? 0) * onGround + (p.flight?.pitch ?? 0) * (p.flight?.blend ?? 0),
    p.yaw,
    (p.rest?.groundRoll ?? 0) * onGround + (p.flight?.bank ?? 0) * (p.flight?.blend ?? 0),
    'YXZ',
  );
  if (p.dying > 0.6) {
    // once the ink has climbed to the head, the figure slumps into a puddle
    const d = (p.dying - 0.6) / 0.4;
    r.root.scale.set(1 + 0.6 * d, Math.max(0.05, 1 - 0.95 * d), 1 + 0.6 * d);
  } else r.root.scale.set(1, 1, 1);
}
