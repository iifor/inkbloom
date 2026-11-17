// Player characters as soft figures: a shared body (about 1.8 m, head centred at 1.62 m to match
// the shared hit box) dressed per character. Faces are two dark eyes and a blush, read only up
// close; from afar a character is its hat and hair. Scarves, capes, ponytails and hood tips
// trail behind as the figure moves. Colours come from content/characters.ts and the player's
// own picks. design: docs/game-design.md section 8.3
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
  readonly legL: THREE.Object3D;
  readonly legR: THREE.Object3D;
  readonly shinL: THREE.Object3D;
  readonly shinR: THREE.Object3D;
  readonly trails: readonly Trail[];
  readonly hipsY: number;
  readonly parts: Part[];
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

/** The body every character shares; returns its joints for dressing. */
function body(b: RigBuilder, o: BodyOpts) {
  const root = new THREE.Object3D();
  const hips = b.joint(root, 0, HIPS_Y, 0);
  b.blob(hips, 0, 0, 0, o.chest[0] * 0.85, 0.12, o.chest[2] * 0.95, 'trousers');
  const leg = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const t = b.limb(hips, sx * 0.09, -0.02, 0, 0.44, o.leg, 'trousers');
    const s = b.limb(t.joint, 0, t.end, 0, 0.42, o.leg * 0.88, o.shin);
    b.blob(s.joint, 0, s.end + 0.035, -0.045, o.leg * 1.05, 0.06, 0.13, 'boots');
    return [t.joint, s.joint];
  };
  const [legL, shinL] = leg(-1);
  const [legR, shinR] = leg(1);
  const torso = b.joint(hips, 0, 0.02, 0);
  // a chest over a narrower waist, so the body tapers instead of being one egg
  b.blob(torso, 0, 0.32, 0, o.chest[0], o.chest[1] * 0.78, o.chest[2], 'coat');
  b.blob(torso, 0, 0.12, 0, o.chest[0] * 0.86, o.chest[1] * 0.55, o.chest[2] * 0.92, 'coat');
  const arm = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    // a rounded shoulder joins the arm to the chest
    b.blob(torso, sx * o.shoulder, 0.44, 0, o.arm * 1.3, o.arm * 1.2, o.arm * 1.3, o.sleeve);
    const up = b.limb(torso, sx * o.shoulder, 0.46, 0, 0.29, o.arm, o.sleeve);
    const fore = b.limb(up.joint, 0, up.end, 0, 0.27, o.arm * 0.88, o.forearm);
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
    return [up.joint, fore.joint];
  };
  const [armL, foreL] = arm(-1);
  const [armR, foreR] = arm(1);
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
  return { root, hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR };
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

const BUILD: Record<CharacterKey, (b: RigBuilder) => Omit<Rig, 'parts' | 'hipsY'>> = {
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
  return { ...BUILD[key](b), hipsY: HIPS_Y, parts: b.parts };
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

function pose(r: Rig, p: PlayerPose): void {
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
    pose(r, p);
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
  }

  end(): void {
    this.figures.end();
  }

  dispose(): void {
    this.figures.dispose();
  }
}
