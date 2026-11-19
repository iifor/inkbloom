// Posing a player figure for one frame: walking and running, jumping, gliding and swimming, the
// upper body following where they look, what is in hand (player-hold.ts), a flinch, the cloth
// trailing behind, and being swallowed by ink.
import type { Gesture, HeldItem } from '@/world/net/protocol';
import { heldIn, holdPose } from './player-hold';
import type { Rig } from './player-rig';
import { swimArms } from './player-swim';

/** What another player's figure is doing this frame. */
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
  /** Swimming in deep water: lying along the surface, arms stroking, legs kicking. */
  readonly swim?: boolean;
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
] as const;

/** Pose a rig for one frame (exported for tests). */
export function posePlayer(r: Rig, p: PlayerPose): void {
  for (const k of JOINTS) r[k].rotation.set(0, 0, 0);
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
  r.root.rotation.set(0, p.yaw, 0);
  if (p.dying > 0.6) {
    // once the ink has climbed to the head, the figure slumps into a puddle
    const d = (p.dying - 0.6) / 0.4;
    r.root.scale.set(1 + 0.6 * d, Math.max(0.05, 1 - 0.95 * d), 1 + 0.6 * d);
  } else r.root.scale.set(1, 1, 1);
}
