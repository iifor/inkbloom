import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const upperLength = 0.305,
  lowerLength = 0.27;
const downArm = v(0, 0, -1);
/** One breaststroke of the right hand, seen from the chest: a long glide, a sweep out to the
 * catch, a quick hard pull in under the chin, then the reach forward. `t` is when each pose is
 * reached, `turn` the hand's (pitch, yaw, roll), `elbow` the way the elbow points and `grip`
 * the fingers' (curl, spread, thumb out), 0..1. The poses stay inside the view at a level
 * gaze, the hands just under the water (about y = -0.19). */
const KEYS = [
  {
    t: 0,
    wrist: v(0.075, -0.235, -0.56),
    turn: v(-0.06, 0.06, 0.1),
    elbow: v(1, -0.8, 0.15),
    grip: v(0.1, 0.15, 0.3),
  },
  {
    t: 0.2,
    wrist: v(0.09, -0.24, -0.55),
    turn: v(-0.1, 0, 0.3),
    elbow: v(1, -0.8, 0.15),
    grip: v(0.12, 0.12, 0.3),
  },
  {
    t: 0.36,
    wrist: v(0.24, -0.25, -0.5),
    turn: v(-0.3, -0.3, 0.8),
    elbow: v(1, -0.5, 0.2),
    grip: v(0.22, 0.3, 0.5),
  },
  {
    t: 0.5,
    wrist: v(0.28, -0.25, -0.47),
    turn: v(-0.75, -0.15, 0.95),
    elbow: v(1, 0.05, 0.3),
    grip: v(0.35, 0.2, 0.55),
  },
  {
    t: 0.62,
    wrist: v(0.18, -0.218, -0.39),
    turn: v(-0.55, 0.55, -0.2),
    elbow: v(1, -0.2, 0.3),
    grip: v(0.42, 0.08, 0.35),
  },
  {
    t: 0.72,
    wrist: v(0.078, -0.205, -0.36),
    turn: v(-0.1, 0.1, -0.95),
    elbow: v(1, -0.9, 0.1),
    grip: v(0.28, 0, 0.15),
  },
  {
    t: 0.85,
    wrist: v(0.06, -0.225, -0.47),
    turn: v(0, 0.1, -0.35),
    elbow: v(1, -0.85, 0.15),
    grip: v(0.06, 0.05, 0.25),
  },
];
/** Where in the stroke the hands shoot forward and the legs kick: the splash. */
const KICK = 0.8;
/** Where a stroke comes to rest while the swimmer treads water, so moving off starts with the
 * sweep. A stroke under way finishes its way round to here instead of jumping. */
const REST = 0.2;
/** How quickly the hand turns and the fingers settle towards the pose (per second): a little
 * behind the arm, as if the water held them back. */
const HAND_FOLLOW = 16;
const loop = (points: THREE.Vector3[]) => new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
const wristPath = loop(KEYS.map((k) => k.wrist)),
  turnPath = loop(KEYS.map((k) => k.turn)),
  elbowPath = loop(KEYS.map((k) => k.elbow)),
  gripPath = loop(KEYS.map((k) => k.grip));
const knots = [...KEYS.map((k) => k.t), 1];
// The path's speed at each pose: the mean of the segments either side, so the hands ease
// between poses instead of jolting at each one.
const rates = KEYS.map((_, i) => {
  const before = i ? knots[i]! - knots[i - 1]! : 1 - knots[KEYS.length - 1]!;
  return (1 / before + 1 / (knots[i + 1]! - knots[i]!)) / (2 * KEYS.length);
});

/** Stroke time (0..1) to a point on the pose paths: a cubic Hermite through the key times. */
function strokeParam(t: number): number {
  let i = 0;
  while (t >= knots[i + 1]!) i++;
  const h = knots[i + 1]! - knots[i]!,
    s = (t - knots[i]!) / h,
    s2 = s * s,
    s3 = s2 * s;
  const u =
    (i + 3 * s2 - 2 * s3) / KEYS.length +
    (s3 - 2 * s2 + s) * rates[i]! * h +
    (s3 - s2) * rates[(i + 1) % KEYS.length]! * h;
  return THREE.MathUtils.clamp(u, 0, 1);
}

const wrap = (t: number) => ((t % 1) + 1) % 1;
/** Whether moving `step` round the stroke from `from` reaches `mark`. */
function passes(from: number, step: number, mark: number): boolean {
  const gap = step >= 0 ? wrap(mark - from) : wrap(from - mark);
  return gap > 0 && gap <= Math.abs(step);
}

/** A tapered limb from the origin down -z, with a round joint at the base (and at the tip if
 * `capped`). */
function limb(length: number, base: number, tip: number, paint: number, sides: number, capped = false) {
  const g = new GeometryBuilder(),
    m = new THREE.Matrix4();
  const shape = new THREE.CylinderGeometry(tip, base, length, sides);
  g.mesh(shape, m.makeRotationX(-Math.PI / 2).setPosition(0, 0, -length / 2), paint, ALWAYS_COLOR);
  const joint = new THREE.SphereGeometry(base, sides, Math.max(4, sides >> 1));
  g.mesh(joint, m.identity(), paint, ALWAYS_COLOR);
  if (capped)
    g.mesh(
      joint,
      m.makeScale(tip / base, tip / base, tip / base).setPosition(0, 0, -length),
      paint,
      ALWAYS_COLOR,
    );
  shape.dispose();
  joint.dispose();
  return g.build();
}

/** The right palm, palm down with the fingers along -z and the thumb towards -x: the wrist,
 * a flat slab widening to the knuckles, and the pad at the root of the thumb. */
function palm() {
  const g = new GeometryBuilder(),
    m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    skin = color('sand');
  const ball = new THREE.SphereGeometry(1, 10, 6),
    slab = new THREE.CylinderGeometry(1, 0.78, 1, 10);
  const put = (shape: THREE.BufferGeometry, at: THREE.Vector3, size: THREE.Vector3, tilt = 0) =>
    g.mesh(
      shape,
      m.compose(at, q.setFromEuler(new THREE.Euler(-Math.PI / 2, tilt, 0)), size),
      skin,
      ALWAYS_COLOR,
    );
  put(ball, v(0, 0, 0), v(0.034, 0.03, 0.026));
  put(slab, v(0, 0.002, -0.05), v(0.042, 0.072, 0.017));
  put(ball, v(0, 0.002, -0.084), v(0.041, 0.013, 0.016));
  put(ball, v(-0.024, -0.006, -0.032), v(0.018, 0.026, 0.013), 0.3);
  ball.dispose();
  slab.dispose();
  return g.build();
}

/** Fingers from the index (nearest the thumb) out: knuckle x, the two segments' lengths and
 * their thickness. */
const FINGERS = [
  { x: -0.0305, lengths: [0.04, 0.042], thick: 0.0095 },
  { x: -0.01, lengths: [0.044, 0.046], thick: 0.0098 },
  { x: 0.0105, lengths: [0.042, 0.043], thick: 0.0093 },
  { x: 0.03, lengths: [0.032, 0.034], thick: 0.0082 },
];
const THUMB = { at: v(-0.034, -0.006, -0.026), lengths: [0.036, 0.032], thick: 0.011 };

interface Digit {
  readonly base: THREE.Object3D;
  readonly middle: THREE.Object3D;
}

function digit(parent: THREE.Object3D, lengths: number[], thick: number, material: THREE.Material): Digit {
  const skin = color('sand');
  const base = new THREE.Object3D(),
    middle = new THREE.Object3D();
  base.add(new THREE.Mesh(limb(lengths[0]!, thick, thick * 0.92, skin, 7), material), middle);
  middle.position.z = -lengths[0]!;
  middle.add(new THREE.Mesh(limb(lengths[1]!, thick * 0.92, thick * 0.8, skin, 7, true), material));
  parent.add(base);
  return { base, middle };
}

export class SwimArms {
  /** How the stroke moves the head (applied by the player to the camera, scaled by how far in
   * the water it is): `lift` metres up, `surge` metres along the swim, `nod` and `roll` radians. */
  readonly head = { lift: 0, surge: 0, nod: 0, roll: 0 };
  private readonly root = new THREE.Group();
  private readonly limbs;
  private phase = REST;
  /** The stroke has come to rest at REST and waits for the swimmer to move off. */
  private parked = true;
  /** Which way round the stroke runs, easing between 1 (forwards) and -1 (backing up). */
  private drive = 1;
  private scull = 0;
  private effort = 0;
  private lean = 0;
  private backward = false;
  /** The hands snap to their pose on the first frame in the water, then follow it. */
  private settled = false;
  private readonly wrist = new THREE.Vector3();
  private readonly turn = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly grip = new THREE.Vector3();
  private readonly tread = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly aim = new THREE.Quaternion();

  constructor(camera: THREE.Camera) {
    const material = makeInkMaterial(),
      teal = color('teal');
    const upper = limb(upperLength, 0.062, 0.047, teal, 12),
      lower = limb(lowerLength, 0.047, 0.034, teal, 12),
      hand = palm();
    this.limbs = [-1, 1].map((side) => {
      const arm = new THREE.Mesh(upper, material),
        forearm = new THREE.Mesh(lower, material),
        wrist = new THREE.Group();
      wrist.add(new THREE.Mesh(hand, material));
      // mirrored for the left hand (three.js turns the faces round for a negative scale)
      wrist.scale.x = side;
      const fingers = FINGERS.map((f) => {
        const d = digit(wrist, f.lengths, f.thick, material);
        d.base.position.set(f.x, 0.001, -0.088);
        return d;
      });
      const thumb = digit(wrist, THUMB.lengths, THUMB.thick, material);
      thumb.base.position.copy(THUMB.at);
      this.root.add(arm, forearm, wrist);
      return { side, arm, forearm, hand: wrist, fingers, thumb, grip: new THREE.Vector3() };
    });
    this.root.visible = false;
    camera.add(this.root);
  }

  /** Pose the arms for this frame from the body's velocity and the view. Returns true on the
   * frame a stroke kicks (hands shooting forward), for the splash. */
  update(dt: number, blend: number, vel: THREE.Vector3, yaw: number, pitch = 0): boolean {
    this.root.visible = blend > 0.025;
    const head = this.head;
    if (!this.root.visible) {
      this.effort = this.lean = 0;
      this.phase = REST;
      this.parked = true;
      this.drive = 1;
      this.settled = false;
      head.lift = head.surge = head.nod = head.roll = 0;
      return false;
    }
    const speed = Math.hypot(vel.x, vel.z);
    // along the view and across it, -1..1
    const ahead = speed > 0.3 ? (-Math.sin(yaw) * vel.x - Math.cos(yaw) * vel.z) / speed : 1;
    const across = speed > 0.3 ? (Math.cos(yaw) * vel.x - Math.sin(yaw) * vel.z) / speed : 0;
    if (ahead < -0.4) this.backward = true;
    else if (ahead > 0.1) this.backward = false;
    this.effort = THREE.MathUtils.damp(this.effort, Math.min(1, speed / 2.6), 5, dt);
    this.lean = THREE.MathUtils.damp(this.lean, across * this.effort, 4, dt);
    // swimming backwards runs the stroke in reverse (the hands push the water ahead); turning
    // round slows the stroke to a stop and starts it the other way
    this.drive = THREE.MathUtils.damp(this.drive, this.backward ? -1 : 1, 6, dt);
    const swimming = this.effort >= 0.06;
    if (swimming) this.parked = false;
    let kicked = false;
    if (!this.parked) {
      const tempo = swimming ? 0.3 + 0.5 * this.effort + 0.2 * Math.max(0, speed - 2.6) : 0.55;
      const step = dt * tempo * this.drive;
      kicked = this.effort > 0.3 && passes(this.phase, step, KICK);
      if (!swimming && passes(this.phase, step, REST)) {
        this.phase = REST;
        this.parked = true;
      } else this.phase = wrap(this.phase + step);
    }
    this.scull = (this.scull + dt * 0.9) % 1;
    const beat = this.scull * Math.PI * 2,
      stroke = (this.phase - 0.7) * Math.PI * 2;
    const calm = 1 - this.effort;
    // treading water bobs with each sweep; a stroke lifts the head to breathe as the hands pull
    // in, and the kick carries the body on through the glide
    head.lift = 0.034 * this.effort * Math.cos(stroke) + 0.014 * calm * Math.sin(beat * 2);
    head.nod = 0.018 * this.effort * Math.cos(stroke - 0.12);
    head.surge = 0.05 * this.effort * Math.cos((this.phase - 0.1) * Math.PI * 2);
    head.roll = -0.03 * this.lean;
    // the arms stay low in the water while the head rises out of it
    this.root.position.y = -(1 - blend) * 0.38 - head.lift * blend * 0.4;
    this.root.rotation.set(-THREE.MathUtils.clamp(pitch, -0.75, 0.75) * 0.45, 0, -this.lean * 0.08);

    const u = strokeParam(this.phase);
    const follow = this.settled ? 1 - Math.exp(-HAND_FOLLOW * dt) : 1;
    this.settled = true;
    for (const part of this.limbs) {
      const { side, arm, forearm, hand } = part;
      // the arm on the outside of a turn sweeps wider
      const reach = 1 + 0.18 * this.lean * side;
      wristPath.getPoint(u, this.wrist);
      this.wrist.x *= reach;
      turnPath.getPoint(u, this.turn);
      elbowPath.getPoint(u, this.pole);
      gripPath.getPoint(u, this.grip);
      // at rest the hands scull in small ovals, palms tipped into each sweep
      this.wrist.lerp(
        this.tread.set(
          0.25 + 0.06 * Math.cos(beat),
          -0.28 + 0.015 * Math.sin(beat * 2),
          -0.37 + 0.03 * Math.sin(beat),
        ),
        calm,
      );
      this.turn.lerp(this.tread.set(-0.15, -0.1 * Math.cos(beat), -0.6 * Math.sin(beat)), calm);
      this.pole.lerp(this.tread.set(1, -0.75, 0.2), calm);
      this.grip.lerp(this.tread.set(0.22 + 0.06 * Math.cos(beat), 0.15, 0.4), calm);
      this.wrist.x *= side;
      this.pole.x *= side;
      this.shoulder.set(side * 0.19, -0.225, 0.035);
      this.axis.subVectors(this.wrist, this.shoulder);
      const d = Math.min(this.axis.length(), upperLength + lowerLength - 0.001);
      this.axis.normalize();
      this.wrist.copy(this.shoulder).addScaledVector(this.axis, d);
      const along = (upperLength ** 2 - lowerLength ** 2 + d * d) / (2 * d);
      this.pole.addScaledVector(this.axis, -this.pole.dot(this.axis)).normalize();
      this.elbow
        .copy(this.shoulder)
        .addScaledVector(this.axis, along)
        .addScaledVector(this.pole, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
      arm.position.copy(this.shoulder);
      arm.quaternion.setFromUnitVectors(downArm, this.axis.subVectors(this.elbow, this.shoulder).normalize());
      forearm.position.copy(this.elbow);
      forearm.quaternion.setFromUnitVectors(
        downArm,
        this.axis.subVectors(this.wrist, this.elbow).normalize(),
      );
      hand.position.copy(this.wrist);
      this.aim.setFromEuler(this.euler.set(this.turn.x, side * this.turn.y, side * this.turn.z));
      hand.quaternion.slerp(this.aim, follow);
      part.grip.lerp(this.grip, follow);
      this.shapeFingers(part.fingers, part.thumb, part.grip);
    }
    return kicked;
  }

  /** Bend the fingers: `grip` is (curl, spread, thumb out). The little finger curls a touch
   * more than the index, and every finger keeps a slight natural bend. */
  private shapeFingers(fingers: Digit[], thumb: Digit, grip: THREE.Vector3): void {
    const [curl, spread, open] = [grip.x, grip.y, grip.z];
    fingers.forEach(({ base, middle }, i) => {
      const bend = curl * (1 + 0.12 * i);
      base.rotation.set(-0.06 - 0.75 * bend, (1.5 - i) * (0.03 + 0.09 * spread), 0, 'YXZ');
      middle.rotation.x = -0.12 - 1.0 * bend;
    });
    thumb.base.rotation.set(-0.25 - 0.3 * curl, 0.35 + 0.45 * open, -0.5, 'YXZ');
    thumb.middle.rotation.x = -0.1 - 0.5 * curl;
  }

  /** The hands' world positions (after the camera's matrices are up to date). */
  hands(): THREE.Vector3[] {
    return this.limbs.map(({ hand }) => hand.getWorldPosition(new THREE.Vector3()));
  }

  dispose(): void {
    disposeTree(this.root);
  }
}
