// Ink monsters drawn as doodle figures, after doodle-game's enemies: a squat long-armed brute
// (墨团) and a tall stick figure (墨吐), with bowed limbs, mitten hands and round heads. The body
// is solid ink; the colours the monster stole show in its eyes, its hands and a blot in its
// chest. Every monster of a group shares two instanced meshes (round parts and limbs), so a
// city full of monsters is two draw calls. A rig per enemy type is posed for one monster at a
// time and its part matrices copied out.
//
// Figures stand on y = 0 and face -z, like the rest of the game's models.
import * as THREE from 'three';
import { color } from '@/content/palette';
import type { EnemyDef } from '@/content/enemies';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';

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
}

type Shape = 'blob' | 'limb';
/** ink = the body; a = first stolen colour; b = second (or the first again). */
type Paint = 'ink' | 'a' | 'b';

interface Part {
  readonly node: THREE.Object3D;
  readonly shape: Shape;
  readonly paint: Paint;
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
  readonly hipsY: number;
  readonly parts: Part[];
  /** Brute (long heavy arms, slams) or stick figure (thin, spits). */
  readonly brute: boolean;
}

class RigBuilder {
  readonly parts: Part[] = [];

  joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
    const j = new THREE.Object3D();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  }

  blob(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    paint: Paint = 'ink',
  ): void {
    const n = new THREE.Object3D();
    n.position.set(x, y, z);
    n.scale.set(rx, ry, rz);
    parent.add(n);
    this.parts.push({ node: n, shape: 'blob', paint });
  }

  /** A limb hanging down from a new joint; returns the joint and where its far end is. */
  limb(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    len: number,
    r: number,
    paint: Paint = 'ink',
  ): { joint: THREE.Object3D; end: number } {
    const j = this.joint(parent, x, y, z);
    const n = new THREE.Object3D();
    n.scale.set(r, len, r);
    j.add(n);
    this.parts.push({ node: n, shape: 'limb', paint });
    return { joint: j, end: -len };
  }

  /** A limb standing up from its joint (the stick figure's spine). */
  post(parent: THREE.Object3D, x: number, y: number, z: number, len: number, r: number): void {
    const n = new THREE.Object3D();
    n.position.set(x, y + len, z);
    n.scale.set(r, len, r);
    parent.add(n);
    this.parts.push({ node: n, shape: 'limb', paint: 'ink' });
  }
}

/** 墨团: a hunched brute with a big body, short legs, long arms and colour-stained hands. */
function buildBrute(): Rig {
  const b = new RigBuilder();
  const root = new THREE.Object3D();
  const hipsY = 0.5;
  const hips = b.joint(root, 0, hipsY, 0);
  const torso = b.joint(hips, 0, 0, 0);
  b.blob(torso, 0, 0.27, 0, 0.42, 0.33, 0.34);
  // the stolen colour sloshing in its belly
  b.blob(torso, 0, 0.24, -0.27, 0.2, 0.16, 0.09, 'a');
  const head = b.joint(torso, 0, 0.47, -0.08);
  b.blob(head, 0, 0.09, 0, 0.23, 0.19, 0.21);
  for (const sx of [-1, 1]) b.blob(head, sx * 0.1, 0.12, -0.18, 0.06, 0.075, 0.04, 'a');
  const arm = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const up = b.limb(torso, sx * 0.4, 0.46, 0, 0.34, 0.075);
    const fore = b.limb(up.joint, 0, up.end, 0, 0.34, 0.065);
    // hands that grabbed the colour are stained with it
    b.blob(fore.joint, 0, fore.end - 0.04, 0, 0.13, 0.14, 0.12, 'b');
    return [up.joint, fore.joint];
  };
  const [armL, foreL] = arm(-1);
  const [armR, foreR] = arm(1);
  const leg = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const thigh = b.limb(hips, sx * 0.17, 0, 0, 0.25, 0.09);
    const shin = b.limb(thigh.joint, 0, thigh.end, 0, 0.23, 0.08);
    b.blob(shin.joint, 0, shin.end, -0.06, 0.1, 0.06, 0.16);
    return [thigh.joint, shin.joint];
  };
  const [legL, shinL] = leg(-1);
  const [legR, shinR] = leg(1);
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    foreL,
    foreR,
    legL,
    legR,
    shinL,
    shinR,
    hipsY,
    parts: b.parts,
    brute: true,
  };
}

/** 墨吐: a tall stick figure with a round head, a colour heart and a colour-stained mouth. */
function buildStick(): Rig {
  const b = new RigBuilder();
  const root = new THREE.Object3D();
  const hipsY = 0.86;
  const hips = b.joint(root, 0, hipsY, 0);
  const torso = b.joint(hips, 0, 0, 0);
  b.post(torso, 0, 0, 0, 0.5, 0.05);
  // the stolen colour caught in its chest, seen between the strokes
  b.blob(torso, 0, 0.32, -0.05, 0.09, 0.1, 0.07, 'a');
  const head = b.joint(torso, 0, 0.5, 0);
  b.blob(head, 0, 0.2, 0, 0.23, 0.24, 0.22);
  for (const sx of [-1, 1]) b.blob(head, sx * 0.09, 0.25, -0.19, 0.055, 0.07, 0.04, 'a');
  b.blob(head, 0, 0.1, -0.2, 0.07, 0.055, 0.04, 'b');
  const arm = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const up = b.limb(torso, sx * 0.06, 0.45, 0, 0.32, 0.04);
    const fore = b.limb(up.joint, 0, up.end, 0, 0.3, 0.035);
    b.blob(fore.joint, 0, fore.end - 0.03, 0, 0.06, 0.07, 0.06, 'b');
    return [up.joint, fore.joint];
  };
  const [armL, foreL] = arm(-1);
  const [armR, foreR] = arm(1);
  const leg = (sx: number): [THREE.Object3D, THREE.Object3D] => {
    const thigh = b.limb(hips, sx * 0.08, 0, 0, 0.43, 0.045);
    const shin = b.limb(thigh.joint, 0, thigh.end, 0, 0.41, 0.04);
    b.blob(shin.joint, 0, shin.end, -0.05, 0.07, 0.045, 0.12);
    return [thigh.joint, shin.joint];
  };
  const [legL, shinL] = leg(-1);
  const [legR, shinR] = leg(1);
  return {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    foreL,
    foreR,
    legL,
    legR,
    shinL,
    shinR,
    hipsY,
    parts: b.parts,
    brute: false,
  };
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

function pose(r: Rig, p: Pose): void {
  for (const k of JOINTS) r[k].rotation.set(0, 0, 0);
  r.hips.position.y = r.hipsY;
  r.torso.scale.set(1, 1, 1);
  r.head.scale.setScalar(1);
  const s = Math.sin(p.walk);
  const w = p.stride;
  const heavy = r.brute ? 1.15 : 0.9;
  // walking: legs and arms swing opposite, knees bend on the back swing, a bob each step
  r.legL.rotation.x = s * 0.75 * w;
  r.legR.rotation.x = -s * 0.75 * w;
  r.shinL.rotation.x = -(0.1 + 0.8 * Math.max(0, -s)) * w;
  r.shinR.rotation.x = -(0.1 + 0.8 * Math.max(0, s)) * w;
  r.armL.rotation.x = -s * 0.7 * w * heavy;
  r.armR.rotation.x = s * 0.7 * w * heavy;
  r.foreL.rotation.x = r.foreR.rotation.x = (r.brute ? 0.5 : 0.3) * w + 0.15;
  r.armL.rotation.z = r.brute ? -0.25 : -0.12;
  r.armR.rotation.z = r.brute ? 0.25 : 0.12;
  r.hips.position.y += Math.abs(Math.cos(p.walk)) * 0.05 * w;
  r.torso.rotation.x = -(r.brute ? 0.25 : 0.08) * w;
  // idle: breathe
  r.torso.scale.y = 1 + 0.03 * Math.sin(p.t * 2.2 + p.x);
  r.head.rotation.z = Math.sin(p.t * 1.3 + p.z) * 0.06;

  if (p.attack >= 0) {
    const a = p.attack;
    if (r.brute) {
      // wind up overhead, slam down at 0.55, recover
      const up = a < 0.55 ? a / 0.55 : Math.max(0, 1 - (a - 0.55) / 0.15);
      const slam = a < 0.55 ? 0 : Math.max(0, 1 - (a - 0.7) / 0.3);
      const arms = up * 2.7 + slam * 0.9;
      r.armL.rotation.x = r.armR.rotation.x = arms;
      r.foreL.rotation.x = r.foreR.rotation.x = up * 0.6;
      r.torso.rotation.x = up * 0.25 - slam * 0.55;
      r.head.rotation.x = -slam * 0.3;
    } else {
      // rear back, then throw the head forward to spit at 0.45
      const back = a < 0.45 ? a / 0.45 : Math.max(0, 1 - (a - 0.45) / 0.12);
      const fling = a < 0.45 ? 0 : Math.max(0, 1 - (a - 0.55) / 0.45);
      r.torso.rotation.x = back * 0.4 - fling * 0.45;
      r.head.rotation.x = back * 0.45 - fling * 0.5;
      r.armL.rotation.x = r.armR.rotation.x = back * 0.6 + fling * 1.4;
      r.armL.rotation.z = -0.12 - back * 0.9;
      r.armR.rotation.z = 0.12 + back * 0.9;
      // cheeks puff before the spit
      r.head.scale.setScalar(1 + back * 0.12);
    }
  }
  if (p.hurt > 0) {
    r.torso.rotation.x += p.hurt * 0.45;
    r.head.rotation.x += p.hurt * 0.35;
    r.head.rotation.z += p.hurt * 0.2;
  }
  if (p.air) {
    r.legL.rotation.x = r.legR.rotation.x = 0.9;
    r.shinL.rotation.x = r.shinR.rotation.x = -1.4;
    r.armL.rotation.x = r.armR.rotation.x = 2.3;
    r.armL.rotation.z = -0.5;
    r.armR.rotation.z = 0.5;
  }

  r.root.position.set(p.x, p.y, p.z);
  r.root.rotation.set(0, p.yaw, 0);
  if (p.dying >= 0) {
    // melt into a puddle: sink and spread, limbs splayed
    const d = Math.min(1, p.dying);
    r.root.scale.set(1 + 0.7 * d, Math.max(0.05, 1 - 0.95 * d), 1 + 0.7 * d);
    r.armL.rotation.z = -0.3 - 1.2 * d;
    r.armR.rotation.z = 0.3 + 1.2 * d;
    r.legL.rotation.z = -0.8 * d;
    r.legR.rotation.z = 0.8 * d;
  } else r.root.scale.set(1, 1, 1);
}

function unitGeometry(shape: Shape): THREE.BufferGeometry {
  const g = new GeometryBuilder();
  const ink = color('ink');
  if (shape === 'blob') g.mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.Matrix4(), ink, ALWAYS_COLOR);
  // a slightly tapered stroke hanging from its joint (y 0 to -1)
  else
    g.mesh(
      new THREE.CylinderGeometry(1, 0.8, 1, 6),
      new THREE.Matrix4().makeTranslation(0, -0.5, 0),
      ink,
      ALWAYS_COLOR,
    );
  return g.build();
}

const INK = color('ink');

export class FigureRenderer {
  private readonly rigs = new Map<string, Rig>();
  private readonly meshes: Record<Shape, THREE.InstancedMesh>;
  private readonly used: Record<Shape, number> = { blob: 0, limb: 0 };
  private readonly c = new THREE.Color();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {
    this.meshes = { blob: this.make('blob', 256), limb: this.make('limb', 256) };
  }

  private make(shape: Shape, capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(unitGeometry(shape), this.material, capacity);
    m.frustumCulled = false;
    m.count = 0;
    // instance colours carry the palette index of each part
    m.setColorAt(0, this.c.setRGB(INK, 0, 0));
    this.parent.add(m);
    return m;
  }

  /** Double a mesh's capacity, keeping what has been written this frame. */
  private grow(shape: Shape): void {
    const old = this.meshes[shape];
    const m = this.make(shape, old.instanceMatrix.count * 2);
    const n = this.used[shape];
    m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, n * 16));
    m.instanceColor!.array.set(old.instanceColor!.array.subarray(0, n * 3));
    old.geometry.dispose();
    old.removeFromParent();
    old.dispose();
    this.meshes[shape] = m;
  }

  private rig(def: EnemyDef): Rig {
    let r = this.rigs.get(def.key);
    if (!r) {
      r = def.attack.kind === 'melee' ? buildBrute() : buildStick();
      // fit the drawing to the enemy's collision height
      const top = r.brute ? 1.24 : 1.79;
      r.root.userData.fit = def.height / top;
      this.rigs.set(def.key, r);
    }
    return r;
  }

  begin(): void {
    this.used.blob = 0;
    this.used.limb = 0;
  }

  draw(def: EnemyDef, p: Pose): void {
    const r = this.rig(def);
    pose(r, p);
    const fit = r.root.userData.fit as number;
    r.root.scale.multiplyScalar(fit);
    r.root.updateMatrixWorld(true);
    const a = p.colors[0] ?? INK;
    const b = p.colors[1] ?? a;
    for (const part of r.parts) {
      const shape = part.shape;
      if (this.used[shape] >= this.meshes[shape].instanceMatrix.count) this.grow(shape);
      const m = this.meshes[shape];
      const i = this.used[shape]++;
      m.setMatrixAt(i, part.node.matrixWorld);
      m.setColorAt(i, this.c.setRGB(part.paint === 'ink' ? INK : part.paint === 'a' ? a : b, 0, 0));
    }
  }

  end(): void {
    for (const shape of ['blob', 'limb'] as const) {
      const m = this.meshes[shape];
      m.count = this.used[shape];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of Object.values(this.meshes)) {
      m.geometry.dispose();
      m.removeFromParent();
      m.dispose();
    }
  }
}
