// How a player holds what is in hand and acts out attacks and skills: a stance per item, keyed
// tracks the prop moves along (the katana's arc, a staff's cast), a gun's kick; the hands reach
// for the prop, and the upper body twists and leans with it while the legs keep walking.
// design: docs/game-design.md section 11.4
import * as THREE from 'three';
import type { Gesture, HeldItem } from '@/world/net/protocol';
import { reach } from './arm-ik';
import type { PlayerPose } from './player-pose';
import { PALM, UPPER_ARM, type Rig } from './player-rig';

/** Seconds each attack and skill takes to act out, by what is in hand. An attack faster than
 * this (the rifle) starts again before it ends, which reads as sustained fire. */
export const ACTION_SECONDS: Readonly<Record<HeldItem, Readonly<Record<Gesture, number>>>> = {
  brush: { attack: 0.5, skill: 0.5 },
  rifle: { attack: 0.16, skill: 0.5 },
  katana: { attack: 0.4, skill: 0.6 },
  sniper: { attack: 0.5, skill: 0.7 },
  launcher: { attack: 0.6, skill: 0.9 },
  staff: { attack: 0.45, skill: 0.85 },
};

/** How a prop is held this frame, in the torso's space: where the main hand grips it, which
 * way it points (euler XYZ: y turns it to the left, x tips it up), and the torso's twist and
 * lean to go with it. */
interface Hold {
  readonly g: THREE.Vector3;
  readonly r: THREE.Vector3;
  twist: number;
  lean: number;
}

type V3 = readonly [number, number, number];

/** A key pose for an action. In a track, null is the stance it starts from and returns to. */
interface Key {
  readonly g: V3;
  readonly r: V3;
  readonly twist: number;
  readonly lean: number;
}

const key = (g: V3, r: V3, twist = 0, lean = 0): Key => ({ g, r, twist, lean });

/** Where each thing sits at rest (and, for guns, sighted: `aim`). */
const STANCE: Readonly<Record<HeldItem, { readonly rest: Key; readonly aim?: Key }>> = {
  brush: { rest: key([0.25, 0.06, -0.14], [-0.9, 0, 0]) },
  // low and across the body; up at the shoulder to sight
  rifle: { rest: key([0.1, 0.26, -0.2], [-0.35, 0.3, 0]), aim: key([0.12, 0.38, -0.2], [0, 0.02, 0]) },
  sniper: { rest: key([0.1, 0.26, -0.2], [-0.35, 0.3, 0]), aim: key([0.1, 0.39, -0.18], [0, 0.02, 0]) },
  // on the right shoulder either way, levelled to fire
  launcher: { rest: key([0.2, 0.44, -0.16], [-0.08, 0, 0]), aim: key([0.2, 0.44, -0.16], [0, 0, 0]) },
  // one hand, the blade forward and up
  katana: { rest: key([0.24, 0.12, -0.22], [0.5, 0.15, 0]) },
  staff: { rest: key([0.18, 0.2, -0.24], [1.25, 0, 0]) },
};

interface Track {
  readonly keys: readonly (Key | null)[];
  /** When (0..1) each key is reached. */
  readonly at: readonly number[];
}

const TRACKS: Partial<Record<HeldItem, Partial<Record<Gesture, Track>>>> = {
  katana: {
    // up over the right shoulder, then down and across the body, and back
    attack: {
      keys: [
        null,
        key([0.3, 0.55, -0.05], [1.9, -0.5, 0], -0.35),
        key([-0.12, 0.18, -0.38], [-0.5, 1.2, 0], 0.4, -0.1),
        null,
      ],
      at: [0, 0.2, 0.45, 1],
    },
    // 突进斩: the blade flat, swept right to left, leaning into the dash
    skill: {
      keys: [
        null,
        key([0.36, 0.32, -0.05], [0.1, -1.4, 0], -0.45, -0.2),
        key([-0.2, 0.3, -0.35], [0, 1.3, 0], 0.5, -0.3),
        null,
      ],
      at: [0, 0.2, 0.5, 1],
    },
  },
  staff: {
    // a cast: the orb thrust forward
    attack: { keys: [null, key([0.12, 0.36, -0.3], [0.3, 0, 0], 0, -0.08), null], at: [0, 0.3, 1] },
    // 法阵: raised high, then planted
    skill: {
      keys: [
        null,
        key([0.12, 0.6, -0.22], [1.45, 0, 0], 0, 0.06),
        key([0.16, 0.08, -0.34], [1.5, 0, 0], 0, -0.15),
        key([0.16, 0.08, -0.34], [1.5, 0, 0], 0, -0.15),
        null,
      ],
      at: [0, 0.3, 0.5, 0.75, 1],
    },
  },
  // 战术闪避: the rifle pulled in close, the body ducking aside
  rifle: { skill: { keys: [null, key([0.1, 0.28, -0.2], [0.6, 0.4, 0], 0.2, -0.1), null], at: [0, 0.3, 1] } },
  // 专注射击: the scope to the eye, held
  sniper: {
    skill: {
      keys: [null, key([0.08, 0.41, -0.17], [0, 0, 0]), key([0.08, 0.41, -0.17], [0, 0, 0]), null],
      at: [0, 0.25, 0.8, 1],
    },
  },
  // 蓄力炮击: braced, then the big shot (its kick comes on top)
  launcher: {
    skill: {
      keys: [
        null,
        key([0.2, 0.46, -0.13], [0.05, 0, 0], 0, -0.12),
        key([0.2, 0.46, -0.13], [0.05, 0, 0]),
        null,
      ],
      at: [0, 0.35, 0.55, 1],
    },
  },
};

/** How hard each gun kicks back. */
const KICK: Partial<Record<HeldItem, number>> = { rifle: 1, sniper: 2, launcher: 2.5 };
/** When the launcher's charged shot goes off, through its skill. */
const CHARGED = 0.55;

const smooth = (k: number): number => k * k * (3 - 2 * k);
/** A gun's kick: back at once, easing home. */
const kick = (t: number): number => (t < 0.12 ? t / 0.12 : (1 - (t - 0.12) / 0.88) ** 2);

const v = new THREE.Vector3();
const hold: Hold = { g: new THREE.Vector3(), r: new THREE.Vector3(), twist: 0, lean: 0 };
const stance: Hold = { g: new THREE.Vector3(), r: new THREE.Vector3(), twist: 0, lean: 0 };
/** Where the other hand goes, in the torso's space. */
const off = new THREE.Vector3();
const wrist = new THREE.Vector3();
const contact = new THREE.Vector3();
const handQ = new THREE.Quaternion();
const foreQ = new THREE.Quaternion();
const handRotation = new THREE.Euler();
const rollQ = new THREE.Quaternion();
const rollAxis = new THREE.Vector3(0, 1, 0);

/** Orient the imported wrist separately from the forearm, then solve to the wrist, not
 * the middle of a mitten. These hands have long palms; using the old palm offset put the
 * shaft through the palm while leaving the fingers dangling in front of it. */
export function alignGrips(r: Rig, item: HeldItem): void {
  if (!r.gripOffset) return;
  const prop = r.props[item];
  const gun = KICK[item] !== undefined;
  // Keep the rear of a tool clear of the chest, even during recoil and equip transitions.
  prop.node.position.z = Math.min(prop.node.position.z, gun ? -0.37 : item === 'katana' ? -0.34 : -0.25);
  prop.node.position.y = Math.max(0.12, Math.min(0.47, prop.node.position.y));
  if (item === 'brush' || item === 'katana') {
    // One-handed shafts follow a neutral wrist. The arm supplies the stroke/cut; an
    // independently rotated prop would fold this long hand back against its forearm.
    const lengths = r.armLengths!;
    foreQ.copy(r.armR.quaternion).multiply(r.foreR.quaternion);
    // Account for the shaft sitting beside the palm, not inside its centre line. Without
    // this correction, resolving a blended pose repeatedly would creep sideways each frame.
    for (let i = 0; i < 4; i++) {
      contact.set(r.gripOffset.x, 0, r.gripOffset.z).applyQuaternion(foreQ);
      wrist.copy(prop.node.position).sub(contact);
      reach(r.armR, r.foreR, 1, wrist, [lengths[0], lengths[1] - r.gripOffset.y]);
      if (item === 'katana')
        r.foreR.quaternion.multiply(rollQ.setFromAxisAngle(rollAxis, prop.gripRoll ?? 0));
      foreQ.copy(r.armR.quaternion).multiply(r.foreR.quaternion);
    }
    r.palmR.quaternion.identity();
    r.palmR.position.copy(r.gripOffset);
    r.palmR.position.y -= lengths[1];
    prop.node.position.set(0, -lengths[0], 0).applyQuaternion(r.armR.quaternion).add(r.armR.position);
    prop.node.position.add(contact.copy(r.palmR.position).applyQuaternion(foreQ));
    prop.node.quaternion.copy(foreQ);
    return;
  }
  for (const side of ['R', 'L'] as const) {
    if (side === 'L' && !prop.off) continue;
    const sign = side === 'R' ? 1 : -1;
    const arm = r[`arm${side}`],
      fore = r[`fore${side}`],
      palm = r[`palm${side}`];
    if (side === 'R') off.copy(prop.node.position);
    else
      off
        .copy(prop.off!)
        .multiplyScalar(prop.node.scale.x)
        .applyQuaternion(prop.node.quaternion)
        .add(prop.node.position);
    // Trigger hand behind the pistol grip; support hand cups the underside from the left.
    handRotation.set(
      side === 'R' && gun ? 1.9 : 0,
      side === 'L' && gun ? 1.05 : 0,
      side === 'L' && gun ? Math.PI / 2 : side === 'R' && !gun ? -1.05 : 0,
    );
    handQ.setFromEuler(handRotation).premultiply(prop.node.quaternion);
    contact.copy(r.gripOffset);
    contact.x *= sign;
    contact.applyQuaternion(handQ);
    wrist.copy(off).sub(contact);
    reach(arm, fore, sign, wrist, r.armLengths);
    if (side === 'R') prop.node.position.copy(wrist).add(contact);
    foreQ.copy(arm.quaternion).multiply(fore.quaternion).invert();
    palm.quaternion.copy(foreQ).multiply(handQ);
    palm.position.copy(contact).applyQuaternion(foreQ);
    palm.position.y -= r.armLengths![1];
  }
}

function setKey(h: Hold, k: Key): void {
  h.g.set(...k.g);
  h.r.set(...k.r);
  h.twist = k.twist;
  h.lean = k.lean;
}

/** h moved toward k by w. */
function toward(h: Hold, k: Key | Hold, w: number): void {
  h.g.lerp(Array.isArray(k.g) ? v.set(...(k.g as V3)) : (k.g as THREE.Vector3), w);
  h.r.lerp(Array.isArray(k.r) ? v.set(...(k.r as V3)) : (k.r as THREE.Vector3), w);
  h.twist += (k.twist - h.twist) * w;
  h.lean += (k.lean - h.lean) * w;
}

/** A keyed track at t; h comes in holding the stance. */
function play(h: Hold, track: Track, t: number): void {
  let i = 0;
  while (i < track.at.length - 2 && t >= track.at[i + 1]!) i++;
  const k = smooth(Math.min(1, Math.max(0, (t - track.at[i]!) / (track.at[i + 1]! - track.at[i]!))));
  stance.g.copy(h.g);
  stance.r.copy(h.r);
  stance.twist = h.twist;
  stance.lean = h.lean;
  const from = track.keys[i];
  if (from) setKey(h, from);
  toward(h, track.keys[i + 1] ?? stance, k);
}

/** Where the held thing is this frame, into `hold`. Returns how far a gun is sighted. */
function holdFor(item: HeldItem, p: PlayerPose): number {
  const st = STANCE[item];
  const act = p.action ?? null;
  const gun = KICK[item] !== undefined;
  // a gun comes up to the shoulder to fire
  const aim = st.aim ? Math.max(p.aim ?? 0, act ? 1 : 0) : 0;
  setKey(hold, st.rest);
  if (st.aim) toward(hold, st.aim, aim);
  const paint = item === 'brush' ? (p.paint ?? 0) : 0;
  if (paint > 0) {
    // working a wall: the arm reaches out and strokes up and down, drifting side to side, the
    // bristles flicking at each turn
    const ph = p.t * 6.5;
    const g: V3 = [0.1 + 0.07 * Math.sin(ph * 0.5), 0.36 + 0.13 * Math.sin(ph) + p.pitch * 0.2, -0.38];
    toward(hold, key(g, [0.35 + 0.3 * Math.cos(ph) + p.pitch * 0.6, 0.1, 0]), paint);
  }
  if (act) {
    const track = TRACKS[item]?.[act.kind];
    if (track) play(hold, track, act.t);
    // the shot itself: the attack, or the launcher's skill once braced
    const shot = act.kind === 'attack' ? act.t : item === 'launcher' ? (act.t - CHARGED) / (1 - CHARGED) : -1;
    if (gun && shot >= 0) {
      const k = kick(shot) * KICK[item]! * (act.kind === 'skill' ? 1.6 : 1);
      hold.g.z += 0.05 * k;
      hold.r.x += 0.1 * k;
      hold.lean += 0.04 * k;
    }
  }
  // a sighted gun follows where they look (the torso has already taken a quarter of it)
  if (gun) hold.r.x += p.pitch * 0.75 * aim;
  return aim;
}

/** The hands on what they hold, over the body already posed for moving: the upper body plays
 * the action, the legs keep going. */
export function holdPose(r: Rig, p: PlayerPose, item: HeldItem): void {
  const aim = holdFor(item, p);
  const reachScale = r.gripOffset
    ? 0.78
    : r.armLengths
      ? (r.armLengths[0] + r.armLengths[1]) / (UPPER_ARM + PALM)
      : 1;
  if (r.gripOffset) {
    hold.g.x *= 0.9;
    hold.g.y += r.armR.position.y - 0.46;
    hold.g.z -= KICK[item] !== undefined ? 0.18 : 0.08;
    if (KICK[item] !== undefined) hold.g.y += p.pitch * 0.16 * aim;
    if (item === 'brush') {
      const paint = Math.min(1, Math.max(0, p.paint ?? 0));
      const phase = p.t * 3.8;
      hold.g
        .set(0.24, 0.12, -0.29)
        .lerp(
          v.set(
            0.24 + Math.sin(phase * 0.5) * 0.02,
            0.22 + Math.sin(phase) * 0.065 + p.pitch * 0.1,
            -0.41 - Math.cos(phase) * 0.015,
          ),
          paint,
        );
    }
  } else hold.g.multiplyScalar(reachScale);
  // it bobs with the steps
  hold.g.y += Math.sin(p.walk * 2) * 0.012 * Math.min(1, p.stride);
  const prop = r.props[item];
  prop.node.scale.setScalar(reachScale);
  if (r.gripOffset && item === 'katana') prop.gripRoll = THREE.MathUtils.clamp(hold.r.y, -0.7, 1.2);
  // the grip goes where the main hand gets to, so the hand never lets go
  const grip = r.gripOffset ? hold.g : reach(r.armR, r.foreR, 1, hold.g, r.armLengths);
  prop.node.position.copy(grip);
  prop.node.rotation.set(hold.r.x, hold.r.y, hold.r.z);
  if (r.gripOffset) alignGrips(r, item);
  else if (prop.off)
    reach(
      r.armL,
      r.foreL,
      -1,
      off.copy(prop.off).multiplyScalar(reachScale).applyEuler(prop.node.rotation).add(grip),
      r.armLengths,
    );
  r.torso.rotation.y += hold.twist;
  r.torso.rotation.x += hold.lean;
  // the head keeps looking ahead through a twist; at a scope, the cheek goes down to the stock
  r.head.rotation.y -= hold.twist * 0.6;
  if (item === 'sniper') r.head.rotation.z = -0.12 * aim;
}

/** What is drawn in hand: nothing while gliding (both hands on the plane) or swimming. */
export const heldIn = (p: PlayerPose): HeldItem | null => (p.held && !p.glide && !p.swim ? p.held : null);
