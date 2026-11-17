// Player characters as soft figures: a shared body (about 1.8 m, head centred at 1.62 m to match
// the shared hit box) dressed per character. Faces are two dark eyes and a blush, read only up
// close; from afar a character is its hat and hair. Scarves, capes, ponytails and hood tips
// trail behind as the figure moves. Colours come from content/characters.ts and the player's
// own picks. design: docs/game-design.md section 8.3
//
// What a player holds (the brush or a weapon) is a small soft prop on the torso; the hands reach
// for it (two-bone arm IK), so one way of moving a prop serves every character. Attacks and
// skills move the prop along a few keyed poses (the katana's arc, a gun's kick, a staff's cast)
// while the legs keep walking. design: docs/game-design.md section 11.4
import * as THREE from 'three';
import {
  type CharacterKey,
  FACE_COLORS,
  HAIR_COLORS,
  type Look,
  SKIN_TONES,
  characterDef,
} from '@/content/characters';
import { type ColorKey, color } from '@/content/palette';
import { WEAPONS } from '@/content/weapons';
import type { Gesture, HeldItem } from '@/world/net/protocol';
import { FigureRenderer, type Part, RigBuilder } from './figure';

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

/** Something held: a few soft parts on a joint whose origin is where the main hand grips it.
 * It points along -z (barrel, blade, bristles, the staff's orb). */
export interface Prop {
  readonly node: THREE.Object3D;
  readonly parts: Part[];
  /** Where the other hand holds it, in its own space; null when held in one hand. */
  readonly off: THREE.Vector3 | null;
  /** The far end (muzzle, blade tip, bristles, orb), in its own space. */
  readonly tip: THREE.Vector3;
}

/** Something that trails behind: it swings back with speed and sways at rest. */
interface Trail {
  readonly node: THREE.Object3D;
  readonly rest: THREE.Euler;
  /** How far it swings back at a run. */
  readonly drag: number;
}

interface Rig {
  readonly root: THREE.Object3D;
  readonly hips: THREE.Object3D;
  readonly torso: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly armL: THREE.Object3D;
  readonly armR: THREE.Object3D;
  readonly foreL: THREE.Object3D;
  readonly foreR: THREE.Object3D;
  /** The middle of each hand, where it grips. */
  readonly palmL: THREE.Object3D;
  readonly palmR: THREE.Object3D;
  readonly legL: THREE.Object3D;
  readonly legR: THREE.Object3D;
  readonly shinL: THREE.Object3D;
  readonly shinR: THREE.Object3D;
  readonly trails: readonly Trail[];
  readonly hipsY: number;
  readonly parts: Part[];
  readonly props: Readonly<Record<HeldItem, Prop>>;
}

interface BodyOpts {
  /** Chest radii. */
  readonly chest: readonly [number, number, number];
  readonly shoulder: number;
  readonly leg: number;
  readonly arm: number;
  readonly hand: number;
  /** Paint slots for the parts that differ between characters. */
  readonly sleeve: string;
  readonly forearm: string;
  readonly handPaint: string;
  readonly shin: string;
  /** How far forward the face sits (a hood pushes it out). */
  readonly faceZ: number;
}

const BASE: BodyOpts = {
  chest: [0.2, 0.27, 0.13],
  shoulder: 0.22,
  leg: 0.075,
  arm: 0.058,
  hand: 0.055,
  sleeve: 'coat',
  forearm: 'coat',
  handPaint: 'skin',
  shin: 'trousers',
  faceZ: 0,
};

const HIPS_Y = 0.92;
/** Shoulder to elbow, and elbow to the middle of the palm (body(): the arm's two limbs). */
const UPPER_ARM = 0.29;
const PALM = 0.3;

/** The body every character shares; returns its joints for dressing. */
function body(b: RigBuilder, o: BodyOpts) {
  const root = new THREE.Object3D();
  const hips = b.joint(root, 0, HIPS_Y, 0);
  b.blob(hips, 0, 0, 0, o.chest[0] * 0.85, 0.12, o.chest[2] * 0.95, 'trousers');
  const leg = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const t = b.limb(hips, sx * 0.09, -0.02, 0, 0.44, o.leg, 'trousers');
    const s = b.limb(t.joint, 0, t.end, 0, 0.42, o.leg * 0.88, o.shin);
    // a round knee, so a bent leg stays one form instead of two links pinched together
    b.blob(s.joint, 0, 0, 0, o.leg * 0.92, o.leg * 0.92, o.leg * 0.92, o.shin);
    b.blob(s.joint, 0, s.end + 0.035, -0.045, o.leg * 1.05, 0.06, 0.13, 'boots');
    return [t.joint, s.joint];
  };
  const [legL, shinL] = leg(-1);
  const [legR, shinR] = leg(1);
  const torso = b.joint(hips, 0, 0.02, 0);
  // a chest over a narrower waist, so the body tapers instead of being one egg
  b.blob(torso, 0, 0.32, 0, o.chest[0], o.chest[1] * 0.78, o.chest[2], 'coat');
  b.blob(torso, 0, 0.12, 0, o.chest[0] * 0.86, o.chest[1] * 0.55, o.chest[2] * 0.92, 'coat');
  const arm = (sx: number): [THREE.Object3D, THREE.Object3D, THREE.Object3D] => {
    // a rounded shoulder joins the arm to the chest
    b.blob(torso, sx * o.shoulder, 0.44, 0, o.arm * 1.3, o.arm * 1.2, o.arm * 1.3, o.sleeve);
    const up = b.limb(torso, sx * o.shoulder, 0.46, 0, 0.29, o.arm, o.sleeve);
    const fore = b.limb(up.joint, 0, up.end, 0, 0.27, o.arm * 0.88, o.forearm);
    b.blob(fore.joint, 0, 0, 0, o.arm * 0.9, o.arm * 0.9, o.arm * 0.9, o.forearm);
    // a mitten of a hand with a thumb on the inside
    b.blob(fore.joint, 0, fore.end - 0.03, 0, o.hand * 0.85, o.hand * 1.2, o.hand * 0.7, o.handPaint);
    b.blob(
      fore.joint,
      -sx * o.hand * 0.55,
      fore.end - 0.01,
      -o.hand * 0.35,
      o.hand * 0.35,
      o.hand * 0.5,
      o.hand * 0.35,
      o.handPaint,
    );
    return [up.joint, fore.joint, b.joint(fore.joint, 0, -PALM, 0)];
  };
  const [armL, foreL, palmL] = arm(-1);
  const [armR, foreR, palmR] = arm(1);
  b.blob(torso, 0, 0.5, 0, 0.06, 0.06, 0.06, 'skin');
  const head = b.joint(torso, 0, 0.53, 0);
  b.blob(head, 0, 0.15, 0, 0.14, 0.16, 0.145, 'skin');
  // a rounder chin, a small nose for the profile, ears
  b.blob(head, 0, 0.09, -0.025, 0.115, 0.085, 0.115, 'skin');
  b.blob(head, 0, 0.13, -0.148 - o.faceZ, 0.02, 0.022, 0.022, 'skin');
  for (const sx of [-1, 1]) b.blob(head, sx * 0.138, 0.15, 0.005, 0.022, 0.038, 0.03, 'skin');
  for (const sx of [-1, 1]) {
    // big enough to survive the brush pass a few metres away
    b.blob(head, sx * 0.052, 0.16, -0.132 - o.faceZ, 0.027, 0.038, 0.018, 'eye');
    b.blob(head, sx * 0.088, 0.105, -0.118 - o.faceZ, 0.032, 0.018, 0.014, 'blush');
  }
  return { root, hips, torso, head, armL, armR, foreL, foreR, palmL, palmR, legL, legR, shinL, shinR };
}

/** A joint that trails behind; parts hung from it swing with it. */
function trail(
  b: RigBuilder,
  parent: THREE.Object3D,
  at: [number, number, number],
  rest: [number, number, number],
  drag: number,
): Trail {
  const node = b.joint(parent, ...at);
  node.rotation.set(...rest);
  return { node, rest: node.rotation.clone(), drag };
}

/** 信使: beret, a long scarf, a satchel and a paper plane folded on the back. */
function courier(b: RigBuilder) {
  const j = body(b, BASE);
  const trails: Trail[] = [];
  // short coat over the hips
  b.blob(j.torso, 0, 0.05, 0, 0.21, 0.13, 0.145, 'coat');
  // hair, then a beret tipped to one side
  b.blob(j.head, 0, 0.2, 0.02, 0.15, 0.12, 0.15, 'hair');
  b.blob(j.head, 0, 0.13, 0.06, 0.14, 0.12, 0.1, 'hair');
  const beret = b.joint(j.head, 0.02, 0.29, 0);
  beret.rotation.z = -0.2;
  b.blob(beret, 0, 0, 0, 0.165, 0.045, 0.16, 'accent');
  b.blob(beret, 0, 0.045, 0, 0.025, 0.025, 0.025, 'accent');
  // scarf: a wrap round the neck and a tail that streams out behind
  b.blob(j.torso, 0, 0.49, 0, 0.12, 0.045, 0.11, 'accent');
  const tail = trail(b, j.torso, [0.06, 0.48, 0.1], [0.35, 0, 0.1], 1.1);
  b.limb(tail.node, 0, 0, 0, 0.38, 0.05, 'accent', 0.018);
  trails.push(tail);
  // satchel strap across the chest, the bag at the left hip
  const strap = b.joint(j.torso, 0.15, 0.46, -0.125);
  strap.rotation.z = -0.62;
  b.limb(strap, 0, 0, 0, 0.5, 0.02, 'bag', 0.008);
  const bag = trail(b, j.torso, [-0.19, 0.12, -0.02], [0, 0, 0], 0.25);
  b.blob(bag.node, 0, -0.1, 0, 0.055, 0.1, 0.12, 'bag');
  trails.push(bag);
  // the paper plane, folded flat on the back
  const plane = b.joint(j.torso, 0, 0.36, 0.15);
  plane.rotation.set(-1.25, 0, 0.45);
  b.blob(plane, 0, 0, 0, 0.17, 0.014, 0.08, 'plane');
  return { ...j, trails };
}

/** 石匠: broad and round, overalls, rolled sleeves, big gloves, a hard hat with a lamp. */
function mason(b: RigBuilder) {
  const j = body(b, {
    ...BASE,
    chest: [0.25, 0.28, 0.17],
    shoulder: 0.27,
    leg: 0.085,
    arm: 0.07,
    hand: 0.085,
    forearm: 'skin',
    handPaint: 'accent',
  });
  const trails: Trail[] = [];
  // round belly in the overalls, the bib and straps over the shirt
  b.blob(j.torso, 0, 0.12, -0.01, 0.24, 0.2, 0.185, 'overalls');
  b.blob(j.torso, 0, 0.3, -0.12, 0.15, 0.12, 0.05, 'overalls');
  for (const sx of [-1, 1]) b.limb(j.torso, sx * 0.1, 0.5, -0.1, 0.2, 0.026, 'overalls', 0.012);
  // rolled cuffs at the elbows
  for (const arm of [j.armL, j.armR]) b.blob(arm, 0, -0.27, 0, 0.075, 0.05, 0.075, 'coat');
  // short hair at the back, then the hard hat: dome, brim and lamp
  b.blob(j.head, 0, 0.12, 0.07, 0.13, 0.09, 0.09, 'hair');
  b.blob(j.head, 0, 0.24, 0, 0.165, 0.1, 0.165, 'accent');
  b.blob(j.head, 0, 0.2, 0, 0.215, 0.022, 0.21, 'accent');
  b.blob(j.head, 0, 0.27, -0.16, 0.035, 0.035, 0.02, 'lamp');
  // tool pouch swinging at the right hip
  const pouch = trail(b, j.torso, [0.22, 0.08, -0.02], [0, 0, 0], 0.3);
  b.blob(pouch.node, 0, -0.08, 0, 0.07, 0.08, 0.05, 'pouch');
  trails.push(pouch);
  return { ...j, trails };
}

/** 学徒: a pointed hood, a knee-length robe with wide sleeves, a big brush on the back. */
function apprentice(b: RigBuilder) {
  const j = body(b, { ...BASE, chest: [0.18, 0.27, 0.12], arm: 0.07, faceZ: 0.025 });
  const trails: Trail[] = [];
  // the robe's skirt sways from the hips: a stroke turned upside down, so it flares at the hem
  const skirt = trail(b, j.hips, [0, -0.02, 0], [0, 0, 0], 0.3);
  const hem = b.joint(skirt.node, 0, -0.46, 0);
  hem.rotation.x = Math.PI;
  b.limb(hem, 0, 0, 0, 0.52, 0.25, 'coat', 0.2);
  trails.push(skirt);
  b.blob(j.torso, 0, 0.1, 0, 0.205, 0.03, 0.14, 'belt');
  // hood round the head; the face sits forward in its opening
  b.blob(j.head, 0, 0.16, 0.035, 0.175, 0.19, 0.175, 'accent');
  b.blob(j.head, 0, 0.15, -0.1, 0.11, 0.12, 0.06, 'skin');
  b.blob(j.head, 0, 0.235, -0.13, 0.1, 0.035, 0.04, 'hair');
  const tip = trail(b, j.head, [0, 0.31, 0.06], [-0.5, 0, 0], 0.35);
  b.blob(tip.node, 0, 0.1, 0, 0.06, 0.14, 0.06, 'accent');
  trails.push(tip);
  // the big brush across the back
  const brush = b.joint(j.torso, 0.05, 0.62, 0.16);
  brush.rotation.z = 0.42;
  b.limb(brush, 0, 0, 0, 0.95, 0.022, 'brush');
  b.blob(brush, 0, 0.015, 0, 0.03, 0.03, 0.03, 'ferrule');
  b.blob(brush, 0, 0.12, 0, 0.05, 0.11, 0.045, 'accent');
  return { ...j, trails };
}

/** 巡林人: a high ponytail, goggles pushed up on the forehead, a short cape and tall boots. */
function ranger(b: RigBuilder) {
  const j = body(b, { ...BASE, shin: 'boots' });
  const trails: Trail[] = [];
  // the cape hangs from the shoulders and streams back at a run
  const cape = trail(b, j.torso, [0, 0.47, 0.1], [0.08, 0, 0], 0.6);
  b.blob(cape.node, 0, -0.26, 0.03, 0.24, 0.3, 0.035, 'accent');
  trails.push(cape);
  // vest over the shirt, bracers on the forearms
  for (const sx of [-1, 1]) b.blob(j.torso, sx * 0.1, 0.25, -0.085, 0.075, 0.19, 0.045, 'vest');
  for (const fore of [j.foreL, j.foreR]) b.blob(fore, 0, -0.16, 0, 0.055, 0.065, 0.055, 'vest');
  // hair and a high ponytail
  b.blob(j.head, 0, 0.2, 0.02, 0.15, 0.12, 0.15, 'hair');
  const tail = trail(b, j.head, [0, 0.27, 0.12], [0.5, 0, 0], 0.9);
  b.blob(tail.node, 0, -0.08, 0.02, 0.055, 0.12, 0.055, 'hair');
  b.blob(tail.node, 0, -0.2, 0.03, 0.045, 0.1, 0.045, 'hair');
  trails.push(tail);
  // goggles: a strap round the head and two lenses on the forehead
  b.blob(j.head, 0, 0.22, 0, 0.152, 0.022, 0.152, 'band');
  for (const sx of [-1, 1]) b.blob(j.head, sx * 0.05, 0.235, -0.145, 0.04, 0.035, 0.02, 'goggles');
  return { ...j, trails };
}

/** 船夫: a broad conical straw hat, a short raincoat, a coil of rope, a towel at the belt. */
function boatman(b: RigBuilder) {
  const j = body(b, { ...BASE, sleeve: 'accent', forearm: 'skin' });
  const trails: Trail[] = [];
  // the raincoat is the accent: over the chest, flaring at the hips
  b.blob(j.torso, 0, 0.3, 0, 0.215, 0.24, 0.145, 'accent');
  const hem = trail(b, j.hips, [0, 0.02, 0], [0, 0, 0], 0.25);
  b.blob(hem.node, 0, -0.06, 0, 0.22, 0.13, 0.155, 'accent');
  trails.push(hem);
  for (const arm of [j.armL, j.armR]) b.blob(arm, 0, -0.27, 0, 0.068, 0.045, 0.068, 'accent');
  // hair at the back under the hat
  b.blob(j.head, 0, 0.13, 0.07, 0.13, 0.1, 0.09, 'hair');
  // the hat: a broad flat brim and a low peak, wider than the shoulders
  const hat = b.joint(j.head, 0, 0.27, 0);
  b.blob(hat, 0, 0, 0, 0.32, 0.035, 0.32, 'hat');
  b.blob(hat, 0, 0.05, 0, 0.17, 0.07, 0.17, 'hat');
  b.blob(hat, 0, 0.1, 0, 0.06, 0.04, 0.06, 'hat');
  // a coil of rope over the left shoulder
  const coil = b.joint(j.torso, -0.12, 0.38, 0.1);
  coil.rotation.set(0.2, 0.3, 0.6);
  b.blob(coil, 0, 0, 0, 0.14, 0.14, 0.035, 'rope');
  // a towel tucked into the belt, swinging
  const towel = trail(b, j.torso, [0.16, 0.05, -0.08], [0, 0, 0], 0.5);
  b.limb(towel.node, 0, 0, 0, 0.26, 0.055, 'towel', 0.012);
  trails.push(towel);
  return { ...j, trails };
}

/** 园丁: a big straw sun hat with a flower, a long apron, a braid over the shoulder. */
function gardener(b: RigBuilder) {
  const j = body(b, { ...BASE, chest: [0.19, 0.27, 0.13] });
  const trails: Trail[] = [];
  // the apron is the accent: a bib on the chest and a long skirt that sways from the hips
  b.blob(j.torso, 0, 0.3, -0.105, 0.15, 0.2, 0.04, 'accent');
  for (const sx of [-1, 1]) b.limb(j.torso, sx * 0.12, 0.52, -0.06, 0.2, 0.022, 'accent', 0.01);
  const apron = trail(b, j.hips, [0, 0.02, -0.12], [0, 0, 0], 0.3);
  b.limb(apron.node, 0, 0, 0, 0.62, 0.17, 'accent', 0.03);
  trails.push(apron);
  // hair and a braid over the right shoulder, tied with a ribbon
  b.blob(j.head, 0, 0.2, 0.02, 0.15, 0.12, 0.15, 'hair');
  const braid = trail(b, j.head, [0.1, 0.12, 0.05], [0.15, 0, 0.25], 0.5);
  b.blob(braid.node, 0, -0.08, 0, 0.04, 0.09, 0.04, 'hair');
  b.blob(braid.node, 0, -0.19, 0, 0.035, 0.08, 0.035, 'hair');
  b.blob(braid.node, 0, -0.27, 0, 0.03, 0.03, 0.03, 'accent');
  trails.push(braid);
  // a straw sun hat, tipped a little, its band in the accent and a flower on the side
  const hat = b.joint(j.head, 0, 0.27, 0);
  hat.rotation.z = 0.08;
  b.blob(hat, 0, 0, 0, 0.26, 0.025, 0.25, 'hat');
  b.blob(hat, 0, 0.05, 0, 0.15, 0.07, 0.15, 'hat');
  b.blob(hat, 0, 0.03, 0, 0.152, 0.02, 0.152, 'accent');
  b.blob(hat, 0.1, 0.05, -0.12, 0.045, 0.045, 0.02, 'petal');
  b.blob(hat, 0.1, 0.05, -0.135, 0.018, 0.018, 0.012, 'bud');
  return { ...j, trails };
}

/** A limb lying along -z from z (at height y): a barrel, a blade, a shaft. */
function bar(
  b: RigBuilder,
  parent: THREE.Object3D,
  z: number,
  y: number,
  len: number,
  r: number,
  paint: string,
  ry = r,
): void {
  const l = b.limb(parent, 0, y, z, len, r, paint, ry);
  l.joint.rotation.x = Math.PI / 2;
}

/** The things a player can hold, each on its own joint on the torso. Paint slots: `main` and
 * `trim` are the weapon's own colours (content/weapons.ts `look`), `bristle` the player's
 * accent; `wood` and `metal` are fixed. */
function buildProps(torso: THREE.Object3D): Record<HeldItem, Prop> {
  const prop = (
    off: [number, number, number] | null,
    tip: [number, number, number],
    make: (b: RigBuilder, n: THREE.Object3D) => void,
  ): Prop => {
    const b = new RigBuilder();
    const node = b.joint(torso, 0, 0, 0);
    make(b, node);
    return {
      node,
      parts: b.parts,
      off: off ? new THREE.Vector3(...off) : null,
      tip: new THREE.Vector3(...tip),
    };
  };
  return {
    // a painter's brush, bigger than life so it reads from across a street
    brush: prop(null, [0, 0, -0.5], (b, n) => {
      bar(b, n, 0.1, 0, 0.42, 0.016, 'wood');
      b.blob(n, 0, 0, -0.33, 0.024, 0.024, 0.03, 'metal');
      b.blob(n, 0, 0, -0.42, 0.036, 0.034, 0.085, 'bristle');
    }),
    rifle: prop([0, 0, -0.26], [0, 0.06, -0.58], (b, n) => {
      b.blob(n, 0, 0.05, -0.1, 0.04, 0.05, 0.17, 'main');
      bar(b, n, -0.25, 0.06, 0.33, 0.018, 'main');
      b.blob(n, 0, 0.03, -0.27, 0.032, 0.035, 0.08, 'trim');
      b.blob(n, 0, -0.03, -0.13, 0.025, 0.06, 0.035, 'trim');
      b.blob(n, 0, -0.02, 0.01, 0.025, 0.055, 0.03, 'trim');
      b.blob(n, 0, 0.02, 0.14, 0.035, 0.06, 0.12, 'trim');
    }),
    sniper: prop([0, 0, -0.24], [0, 0.06, -0.77], (b, n) => {
      b.blob(n, 0, 0.05, -0.08, 0.038, 0.05, 0.16, 'main');
      bar(b, n, -0.22, 0.06, 0.55, 0.015, 'main');
      b.blob(n, 0, 0.035, -0.26, 0.03, 0.032, 0.09, 'main');
      b.blob(n, 0, 0.13, -0.1, 0.026, 0.026, 0.11, 'trim');
      b.blob(n, 0, -0.02, 0.01, 0.025, 0.055, 0.03, 'trim');
      b.blob(n, 0, 0.02, 0.15, 0.035, 0.065, 0.13, 'trim');
    }),
    // carried on the shoulder: the tube sits above the grip
    launcher: prop([0, 0.02, -0.22], [0, 0.14, -0.54], (b, n) => {
      b.blob(n, 0, 0.14, -0.1, 0.085, 0.085, 0.42, 'main');
      b.blob(n, 0, 0.14, -0.5, 0.095, 0.095, 0.045, 'trim');
      b.blob(n, 0, 0.14, 0.3, 0.09, 0.09, 0.05, 'trim');
      b.blob(n, 0, 0.02, 0, 0.025, 0.06, 0.03, 'trim');
      b.blob(n, 0, 0.04, -0.22, 0.025, 0.05, 0.03, 'trim');
    }),
    // one hand: a wrapped grip, a round guard, a long flat blade
    katana: prop(null, [0, 0, -0.8], (b, n) => {
      bar(b, n, 0.11, 0, 0.17, 0.021, 'trim');
      b.blob(n, 0, 0, -0.07, 0.05, 0.05, 0.014, 'trim');
      bar(b, n, -0.08, 0, 0.72, 0.014, 'main', 0.034);
    }),
    staff: prop([0, 0, -0.18], [0, 0, -0.78], (b, n) => {
      bar(b, n, 0.55, 0, 1.25, 0.022, 'wood');
      b.blob(n, 0, 0, -0.78, 0.085, 0.085, 0.085, 'main');
      for (const sx of [-1, 1]) b.blob(n, sx * 0.06, 0, -0.71, 0.02, 0.02, 0.05, 'trim');
    }),
  };
}

const BUILD: Record<CharacterKey, (b: RigBuilder) => Omit<Rig, 'parts' | 'hipsY' | 'props'>> = {
  courier,
  mason,
  apprentice,
  ranger,
  boatman,
  gardener,
};

/** A character's rig at rest. Exported for tests. */
export function characterRig(key: CharacterKey): Rig {
  const b = new RigBuilder();
  const j = BUILD[key](b);
  return { ...j, hipsY: HIPS_Y, parts: b.parts, props: buildProps(j.torso) };
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

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const va = new THREE.Vector3();
const vb = new THREE.Vector3();
const vc = new THREE.Vector3();
const vd = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Reach a hand for `target` (in the torso's space; it is overwritten): the upper arm turned
 * and the elbow bent so the palm lands there, the elbow out, down and back as elbows go. Out of
 * reach, the arm reaches as far as it goes. Returns where the palm ends up (`target`).
 */
function reach(
  arm: THREE.Object3D,
  fore: THREE.Object3D,
  side: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const a = UPPER_ARM;
  const b = PALM;
  const dir = va.subVectors(target, arm.position);
  const d = Math.min(a + b - 1e-3, Math.max(0.12, dir.length()));
  dir.normalize();
  // the elbow's bend, from the triangle shoulder, elbow, palm
  const bend = Math.acos(Math.max(-1, Math.min(1, (d * d - a * a - b * b) / (2 * a * b))));
  // where the palm is with that bend and no turn, turned onto the target
  qa.setFromUnitVectors(vb.set(0, -a - b * Math.cos(bend), -b * Math.sin(bend)).normalize(), dir);
  // then spun about the reach so the elbow points the right way
  const elbow = vb.copy(DOWN).applyQuaternion(qa);
  elbow.addScaledVector(dir, -elbow.dot(dir));
  const pole = vc.set(side * 0.7, -1, 0.5);
  pole.addScaledVector(dir, -pole.dot(dir));
  if (elbow.lengthSq() > 1e-8 && pole.lengthSq() > 1e-8) {
    const turn = Math.atan2(dir.dot(vd.crossVectors(elbow, pole)), elbow.dot(pole));
    qa.premultiply(qb.setFromAxisAngle(dir, turn));
  }
  arm.quaternion.copy(qa);
  fore.rotation.set(bend, 0, 0);
  return target.copy(arm.position).addScaledVector(dir, d);
}

/** The hands on what they hold, over the body already posed for moving: the upper body plays
 * the action, the legs keep going. */
function holdPose(r: Rig, p: PlayerPose, item: HeldItem): void {
  const aim = holdFor(item, p);
  // it bobs with the steps
  hold.g.y += Math.sin(p.walk * 2) * 0.012 * Math.min(1, p.stride);
  const prop = r.props[item];
  // the grip goes where the main hand gets to, so the hand never lets go
  const grip = reach(r.armR, r.foreR, 1, hold.g);
  prop.node.position.copy(grip);
  prop.node.rotation.set(hold.r.x, hold.r.y, hold.r.z);
  if (prop.off) reach(r.armL, r.foreL, -1, vd.copy(prop.off).applyEuler(prop.node.rotation).add(grip));
  r.torso.rotation.y += hold.twist;
  r.torso.rotation.x += hold.lean;
  // the head keeps looking ahead through a twist; at a scope, the cheek goes down to the stock
  r.head.rotation.y -= hold.twist * 0.6;
  if (item === 'sniper') r.head.rotation.z = -0.12 * aim;
}

/** What is drawn in hand: nothing while gliding (both hands on the plane) or swimming. */
const heldIn = (p: PlayerPose): HeldItem | null => (p.held && !p.glide && !p.swim ? p.held : null);

/** Pose a rig for one frame (exported for tests). */
export function posePlayer(r: Rig, p: PlayerPose): void {
  for (const k of JOINTS) r[k].rotation.set(0, 0, 0);
  const s = Math.sin(p.walk);
  const w = Math.min(1, p.stride);
  const run = Math.max(0, Math.min(1, p.stride - 1) / 0.7);
  // walking and running: legs and arms swing opposite, knees bend, a bob each step
  const swing = 0.6 + 0.35 * run;
  r.legL.rotation.x = s * swing * w;
  r.legR.rotation.x = -s * swing * w;
  r.shinL.rotation.x = -(0.08 + (0.7 + 0.6 * run) * Math.max(0, -s)) * w;
  r.shinR.rotation.x = -(0.08 + (0.7 + 0.6 * run) * Math.max(0, s)) * w;
  r.armL.rotation.set(-s * (0.5 + 0.4 * run) * w, 0, -0.1);
  r.armR.rotation.set(s * (0.5 + 0.4 * run) * w, 0, 0.1);
  r.foreL.rotation.x = r.foreR.rotation.x = 0.15 + (0.25 + 0.9 * run) * w;
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
    const s = Math.sin(p.walk);
    r.hips.position.y = r.hipsY - 0.78;
    r.hips.rotation.x = -1.25;
    r.head.rotation.x = 1.05 + p.pitch * 0.3;
    r.armL.rotation.set(1.6 + s * 1.4, 0, -0.2);
    r.armR.rotation.set(1.6 - s * 1.4, 0, 0.2);
    r.foreL.rotation.x = r.foreR.rotation.x = 0.3;
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

const INK = color('ink');
const FACE = { eye: color(FACE_COLORS.eye), blush: color(FACE_COLORS.blush) };
const SKIN = SKIN_TONES.map((k) => color(k));
const HAIR = HAIR_COLORS.map((k) => color(k));
/** A weapon prop wears the weapon's own colours, as in the hand of the one holding it. */
const WEAPON_LOOK = new Map<string, readonly [number, number]>(WEAPONS.map((w) => [w.key, w.look]));
const PROP_PAINT: Readonly<Record<string, number>> = { wood: color('brown'), metal: color('charcoal') };

/** Every player figure in a scene, drawn as two instanced meshes. */
export class PlayerFigures {
  private readonly rigs = new Map<CharacterKey, Rig>();
  private readonly fixed = new Map<CharacterKey, Map<string, number>>();
  private readonly figures: FigureRenderer;
  private readonly at = new THREE.Vector3();

  constructor(parent: THREE.Object3D, material: THREE.Material) {
    this.figures = new FigureRenderer(parent, material);
  }

  private rig(key: CharacterKey): Rig {
    let r = this.rigs.get(key);
    if (!r) {
      r = characterRig(key);
      this.rigs.set(key, r);
      const colors = characterDef(key).colors as Record<string, ColorKey>;
      this.fixed.set(key, new Map(Object.entries(colors).map(([slot, c]) => [slot, color(c)])));
    }
    return r;
  }

  begin(): void {
    this.figures.begin();
  }

  draw(look: Look, p: PlayerPose): void {
    const r = this.rig(look.character);
    posePlayer(r, p);
    r.root.updateMatrixWorld(true);
    const fixed = this.fixed.get(look.character)!;
    const skin = SKIN[look.skin] ?? SKIN[0]!;
    const hair = HAIR[look.hair] ?? HAIR[0]!;
    // being swallowed: ink climbs from the feet to the head
    const inkTo = p.dying >= 0 ? p.y + Math.min(1, p.dying / 0.6) * 1.9 : -Infinity;
    this.figures.add(r.parts, (part) => {
      if (inkTo > -Infinity && this.at.setFromMatrixPosition(part.node.matrixWorld).y < inkTo) return INK;
      switch (part.paint) {
        case 'skin':
          return skin;
        case 'hair':
          return hair;
        case 'accent':
          return look.accent;
        case 'eye':
          return FACE.eye;
        case 'blush':
          return FACE.blush;
        default:
          return fixed.get(part.paint) ?? INK;
      }
    });
    const item = heldIn(p);
    if (!item) return;
    const own = WEAPON_LOOK.get(item);
    this.figures.add(r.props[item].parts, (part) => {
      if (inkTo > -Infinity && this.at.setFromMatrixPosition(part.node.matrixWorld).y < inkTo) return INK;
      switch (part.paint) {
        case 'main':
          return own?.[0] ?? INK;
        case 'trim':
          return own?.[1] ?? INK;
        case 'bristle':
          return look.accent;
        default:
          return PROP_PAINT[part.paint] ?? INK;
      }
    });
  }

  end(): void {
    this.figures.end();
  }

  dispose(): void {
    this.figures.dispose();
  }
}
