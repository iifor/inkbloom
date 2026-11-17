// Ink monsters as living ink, not black people: a sack of ink that slumps at rest, stretches
// when it moves and grows arms only to strike (墨团), and a tall teardrop with a long neck and a
// throat sack (墨吐). The body is the palette's solid ink, which the renderer gives a wet sheen;
// the colours a monster stole glow inside it, in its eyes, belly or throat. They swell during
// the wind-up, which is the tell to read from 20–30 m away. design: docs/game-design.md 8.6
//
// The drawing stretches and squashes, but the monster's collision box (content/enemies.ts) does
// not: what the player has to hit stays the same through a wind-up.
import * as THREE from 'three';
import { color } from '@/content/palette';
import type { EnemyDef } from '@/content/enemies';
import { FigureRenderer, type Part, RigBuilder, rigTop } from '@/systems/figures/figure';

/** What a monster is doing this frame, for posing. */
export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Walk cycle phase, radians. */
  readonly walk: number;
  /** 0..1: how much of the walk cycle shows (its speed over its top speed). */
  readonly stride: number;
  /** 0..1 through an attack (melee swing or spit), or -1. */
  readonly attack: number;
  /** 0..1 flinch from a hit, or 0. */
  readonly hurt: number;
  readonly air: boolean;
  /** 0..1 through melting into a puddle, or -1 while alive. */
  readonly dying: number;
  /** Seconds, for idle breathing. */
  readonly t: number;
  /** Stolen colours, palette indices (one or two). */
  readonly colors: readonly number[];
  /** Just hit: for a blink the whole body shows the colour it stole. */
  readonly flash?: boolean;
}

/** ink = the body; a = first stolen colour; b = second (or the first again). */
type Paint = 'ink' | 'a' | 'b';

interface Rig {
  readonly root: THREE.Object3D;
  readonly hips: THREE.Object3D;
  /** The ink body; stretched and squashed as a whole. */
  readonly body: THREE.Object3D;
  /** Rides on top of the body without being squashed (eyes, arms, neck). */
  readonly top: THREE.Object3D;
  readonly legL: THREE.Object3D;
  readonly legR: THREE.Object3D;
  readonly shinL: THREE.Object3D;
  readonly shinR: THREE.Object3D;
  /** Where the colour glows; swells during the wind-up. */
  readonly glow: THREE.Object3D;
  readonly eyes: readonly THREE.Object3D[];
  readonly drips: readonly THREE.Object3D[];
  readonly hipsY: number;
  /** How high `top` sits above the hips at rest. */
  readonly topY: number;
  readonly parts: Part[];
  readonly kind: Brute | Spitter;
  /** Scale from the drawing to the enemy's collision height. */
  fit: number;
}

interface Brute {
  readonly type: 'brute';
  readonly armL: THREE.Object3D;
  readonly armR: THREE.Object3D;
  readonly foreL: THREE.Object3D;
  readonly foreR: THREE.Object3D;
}

interface Spitter {
  readonly type: 'spitter';
  readonly neck: THREE.Object3D;
  readonly head: THREE.Object3D;
}

/** Neck angle at rest: leaning forward and up. Rotating a hanging limb by this about x points it
 * up (cos < 0) and forward (sin > 0 sends it to -z). */
const NECK = 2.55;

function legs(b: RigBuilder, hips: THREE.Object3D, apart: number, thigh: number, shin: number, r: number) {
  const leg = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const t = b.limb(hips, sx * apart, 0, 0, thigh, r, 'ink');
    const s = b.limb(t.joint, 0, t.end, 0, shin, r * 0.95, 'ink');
    b.blob(s.joint, 0, s.end + r * 0.6, -0.04, r * 1.25, r * 0.75, r * 1.7, 'ink');
    return [t.joint, s.joint];
  };
  const [legL, shinL] = leg(-1);
  const [legR, shinR] = leg(1);
  return { legL, legR, shinL, shinR };
}

/** Drops of ink hanging under the body; they fall and grow back. */
function drips(b: RigBuilder, body: THREE.Object3D, spots: readonly [number, number, number][]) {
  return spots.map(([x, y, z]) => {
    const j = b.joint(body, x, y, z);
    b.blob(j, 0, 0, 0, 0.045, 0.07, 0.045, 'ink');
    j.userData.base = y;
    return j;
  });
}

/** 墨团: a sack of ink on two stubby feet; arms grow out of its sides only to slam. */
function buildBrute(): Rig {
  const b = new RigBuilder();
  const root = new THREE.Object3D();
  const hipsY = 0.2;
  const hips = b.joint(root, 0, hipsY, 0);
  const { legL, legR, shinL, shinR } = legs(b, hips, 0.2, 0.12, 0.08, 0.1);
  const body = b.joint(hips, 0, 0, 0);
  b.blob(body, 0, 0.38, 0, 0.5, 0.42, 0.45, 'ink');
  b.blob(body, 0, 0.72, 0.02, 0.38, 0.34, 0.36, 'ink');
  // the stolen colour turning in its belly
  const glow = b.blob(body, 0, 0.38, -0.36, 0.22, 0.2, 0.11, 'a');
  const topY = 0.72;
  const top = b.joint(hips, 0, topY, 0);
  const eyes = [-1, 1].map((sx) => b.blob(top, sx * 0.13, 0.08, -0.31, 0.07, 0.09, 0.05, 'a'));
  const arm = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const up = b.limb(top, sx * 0.36, -0.1, 0, 0.36, 0.1, 'ink');
    const fore = b.limb(up.joint, 0, up.end, 0, 0.34, 0.09, 'ink');
    // fists stained with the colour they grabbed
    b.blob(fore.joint, 0, fore.end - 0.06, 0, 0.15, 0.16, 0.14, 'b');
    return [up.joint, fore.joint];
  };
  const [armL, foreL] = arm(-1);
  const [armR, foreR] = arm(1);
  const d = drips(b, body, [
    [-0.36, 0.06, -0.12],
    [0.3, 0.05, 0.2],
    [0.08, 0.02, -0.34],
  ]);
  return {
    root,
    hips,
    body,
    top,
    legL,
    legR,
    shinL,
    shinR,
    glow,
    eyes,
    drips: d,
    hipsY,
    topY,
    parts: b.parts,
    kind: { type: 'brute', armL, armR, foreL, foreR },
    fit: 1,
  };
}

/** 墨吐: a tall teardrop of ink with a long neck; the colour pools in its throat. */
function buildSpitter(): Rig {
  const b = new RigBuilder();
  const root = new THREE.Object3D();
  const hipsY = 0.46;
  const hips = b.joint(root, 0, hipsY, 0);
  const { legL, legR, shinL, shinR } = legs(b, hips, 0.12, 0.25, 0.19, 0.072);
  const body = b.joint(hips, 0, 0, 0);
  b.blob(body, 0, 0.32, 0, 0.3, 0.42, 0.28, 'ink');
  b.blob(body, 0, 0.72, 0.03, 0.2, 0.28, 0.19, 'ink');
  // a drip of a tail behind
  const tail = b.joint(body, 0, 0.05, 0.25);
  tail.rotation.x = 0.6;
  b.blob(tail, 0, -0.06, 0, 0.07, 0.13, 0.07, 'ink');
  const topY = 0.86;
  const top = b.joint(hips, 0, topY, -0.02);
  const neckLimb = b.limb(top, 0, 0, 0, 0.36, 0.075, 'ink');
  const neck = neckLimb.joint;
  neck.rotation.x = NECK;
  // the throat sack hangs under the neck (local +z is its underside at this angle)
  const glow = b.blob(neck, 0, -0.16, 0.06, 0.11, 0.12, 0.11, 'a');
  const head = b.joint(neck, 0, neckLimb.end, 0);
  b.blob(head, 0, 0.04, -0.05, 0.17, 0.15, 0.18, 'ink');
  const eyes = [-1, 1].map((sx) => b.blob(head, sx * 0.075, 0.08, -0.2, 0.045, 0.06, 0.03, 'a'));
  // a colour-stained mouth
  b.blob(head, 0, -0.03, -0.21, 0.055, 0.03, 0.03, 'b');
  const d = drips(b, body, [
    [-0.2, -0.04, -0.08],
    [0.18, -0.03, 0.12],
  ]);
  return {
    root,
    hips,
    body,
    top,
    legL,
    legR,
    shinL,
    shinR,
    glow,
    eyes,
    drips: d,
    hipsY,
    topY,
    parts: b.parts,
    kind: { type: 'spitter', neck, head },
    fit: 1,
  };
}

/** Eases 0..1 in and out. */
const ease = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function pose(r: Rig, p: Pose): void {
  const s = Math.sin(p.walk);
  const w = p.stride;
  const brute = r.kind.type === 'brute';
  for (const j of [r.legL, r.legR, r.shinL, r.shinR, r.body, r.top]) j.rotation.set(0, 0, 0);
  // walking: stubby legs swing, the body rolls side to side and bobs each step
  r.legL.rotation.x = s * (brute ? 0.6 : 0.75) * w;
  r.legR.rotation.x = -s * (brute ? 0.6 : 0.75) * w;
  r.shinL.rotation.x = -(0.1 + 0.7 * Math.max(0, -s)) * w;
  r.shinR.rotation.x = -(0.1 + 0.7 * Math.max(0, s)) * w;
  r.hips.position.y = r.hipsY + Math.abs(Math.cos(p.walk)) * 0.04 * w;
  r.body.rotation.z = s * (brute ? 0.12 : 0.08) * w;
  r.body.rotation.x = -(brute ? 0.08 : 0.14) * w;
  // at rest it slumps and breathes
  const breath = Math.sin(p.t * 2.2 + p.x);
  let sy = (brute ? 0.96 : 1) + 0.035 * breath;
  let sxz = (brute ? 1.03 : 1) - 0.02 * breath;
  let glow = 1;
  let eyes = 1;

  if (r.kind.type === 'brute') {
    const k = r.kind;
    // arms only exist to strike: they grow out of the sides, go up, slam down and sink back
    let up = 0;
    let slam = 0;
    if (p.attack >= 0) {
      const a = p.attack;
      up = a < 0.55 ? ease(a / 0.55) : Math.max(0, 1 - (a - 0.55) / 0.15);
      slam = a < 0.55 ? 0 : Math.max(0, 1 - (a - 0.7) / 0.3);
    }
    const grow = p.air ? 0.5 : Math.max(up, slam);
    sy *= 1 + 0.32 * up - 0.15 * slam;
    sxz *= 1 - 0.13 * up + 0.12 * slam;
    glow = 1 + 0.6 * up;
    eyes = 1 + 0.4 * up;
    for (const [arm, fore, side] of [
      [k.armL, k.foreL, -1],
      [k.armR, k.foreR, 1],
    ] as const) {
      arm.scale.setScalar(Math.max(0.001, grow));
      arm.rotation.set(up * 2.8 + slam * 1.1 + (p.air ? 2.2 : 0), 0, side * (0.3 + 0.2 * up));
      fore.rotation.set(up * 0.5 - slam * 0.2, 0, 0);
    }
    r.body.rotation.x += -slam * 0.3;
  } else {
    const k = r.kind;
    // rear back, the throat swelling and brightening, then throw the head forward to spit
    let back = 0;
    let fling = 0;
    if (p.attack >= 0) {
      const a = p.attack;
      back = a < 0.45 ? ease(a / 0.45) : Math.max(0, 1 - (a - 0.45) / 0.12);
      fling = a < 0.45 ? 0 : Math.max(0, 1 - (a - 0.55) / 0.45);
    }
    const neck = NECK + 0.05 * Math.sin(p.t * 1.7 + p.z) + back * 0.55 - fling * 0.6;
    k.neck.rotation.set(neck, 0, 0);
    // keep the head upright on the neck, tipped back while it winds up
    k.head.rotation.set(-neck + back * 0.5 - fling * 0.35, 0, 0);
    r.body.rotation.x += back * 0.22 - fling * 0.28;
    glow = 1 + 0.9 * back + 0.3 * fling;
    eyes = 1 + 0.3 * back;
  }

  if (p.hurt > 0) {
    // the side that was hit dents in and springs back
    r.body.rotation.x += p.hurt * 0.3;
    r.body.rotation.z += p.hurt * (brute ? 0.1 : 0.3);
    sy *= 1 - 0.1 * p.hurt;
    sxz *= 1 + 0.08 * p.hurt;
  }
  if (p.air) {
    r.legL.rotation.x = r.legR.rotation.x = 0.9;
    r.shinL.rotation.x = r.shinR.rotation.x = -1.3;
    sy *= 1.08;
    sxz *= 0.94;
  }

  r.body.scale.set(sxz, sy, sxz);
  // what rides on top follows the body's height and roll without being squashed
  r.top.position.y = r.topY * sy;
  r.top.rotation.copy(r.body.rotation);
  // the colour swells; eyes stay on the surface as the body narrows (sizes as built, first call)
  r.glow.userData.base ??= r.glow.scale.clone();
  r.glow.scale.copy(r.glow.userData.base as THREE.Vector3).multiplyScalar(glow);
  for (const e of r.eyes) {
    e.userData.base ??= e.scale.clone();
    e.userData.z ??= e.position.z;
    e.scale.copy(e.userData.base as THREE.Vector3).multiplyScalar(eyes);
    if (brute) e.position.z = (e.userData.z as number) * sxz;
  }
  // drips slide down, fall away and grow back
  r.drips.forEach((d, i) => {
    const f = (p.t * 0.7 + i * 0.37 + p.x * 0.1) % 1;
    d.position.y = (d.userData.base as number) - f * 0.14;
    d.scale.setScalar(f < 0.85 ? 0.6 + 0.5 * f : Math.max(0.001, (1 - f) * 6));
  });

  r.root.position.set(p.x, p.y, p.z);
  r.root.rotation.set(0, p.yaw, 0);
  if (p.dying >= 0) {
    // melt into a puddle: sink and spread
    const d = Math.min(1, p.dying);
    r.root.scale.set(1 + 0.8 * d, Math.max(0.05, 1 - 0.95 * d), 1 + 0.8 * d);
  } else r.root.scale.set(1, 1, 1);
  r.root.scale.multiplyScalar(r.fit);
}

const INK = color('ink');

/** Every monster of a group, drawn as two instanced meshes. */
export class MonsterFigures {
  private readonly rigs = new Map<string, Rig>();
  private readonly figures: FigureRenderer;

  constructor(parent: THREE.Object3D, material: THREE.Material) {
    this.figures = new FigureRenderer(parent, material);
  }

  private rig(def: EnemyDef): Rig {
    let r = this.rigs.get(def.key);
    if (!r) {
      r = monsterRig(def);
      this.rigs.set(def.key, r);
    }
    return r;
  }

  begin(): void {
    this.figures.begin();
  }

  draw(def: EnemyDef, p: Pose): void {
    const r = this.rig(def);
    pose(r, p);
    r.root.updateMatrixWorld(true);
    const a = p.colors[0] ?? INK;
    const b = p.colors[1] ?? a;
    this.figures.add(r.parts, (part) => {
      const paint = part.paint as Paint;
      return paint === 'ink' ? (p.flash ? a : INK) : paint === 'a' ? a : b;
    });
  }

  end(): void {
    this.figures.end();
  }

  dispose(): void {
    this.figures.dispose();
  }
}

/** A monster's rig, fitted to its collision height. Exported for tests. */
export function monsterRig(def: EnemyDef): Rig {
  const r = def.attack.kind === 'melee' ? buildBrute() : buildSpitter();
  r.fit = def.height / rigTop(r.root, r.parts);
  return r;
}

/** Pose a rig and measure its top, for tests: how tall the drawing stands in this pose. */
export function posedTop(r: Rig, p: Pose): number {
  pose(r, p);
  const fit = r.fit;
  r.root.position.set(0, 0, 0);
  return rigTop(r.root, r.parts) * fit;
}
