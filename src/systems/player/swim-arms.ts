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
 * reached, `turn` the hand's (pitch, yaw, roll) and `elbow` the way the elbow points. The poses
 * stay inside the view at a level gaze, the hands just under the water (about y = -0.19). */
const KEYS = [
  { t: 0, wrist: v(0.075, -0.235, -0.56), turn: v(-0.06, 0.06, 0.1), elbow: v(1, -0.8, 0.15) },
  { t: 0.2, wrist: v(0.09, -0.24, -0.55), turn: v(-0.1, 0, 0.3), elbow: v(1, -0.8, 0.15) },
  { t: 0.36, wrist: v(0.24, -0.25, -0.5), turn: v(-0.3, -0.3, 0.8), elbow: v(1, -0.5, 0.2) },
  { t: 0.5, wrist: v(0.3, -0.265, -0.46), turn: v(-0.75, -0.15, 0.95), elbow: v(1, 0.05, 0.3) },
  { t: 0.62, wrist: v(0.2, -0.235, -0.37), turn: v(-0.55, 0.55, -0.2), elbow: v(1, -0.2, 0.3) },
  { t: 0.72, wrist: v(0.065, -0.22, -0.33), turn: v(-0.1, 0.25, -0.95), elbow: v(1, -0.9, 0.1) },
  { t: 0.85, wrist: v(0.06, -0.225, -0.47), turn: v(0, 0.1, -0.35), elbow: v(1, -0.85, 0.15) },
];
/** Where in the stroke the hands shoot forward and the legs kick: the splash. */
const KICK = 0.8;
/** Where a stroke waits while the swimmer treads water, so moving off starts with the sweep. */
const REST = 0.2;
const loop = (points: THREE.Vector3[]) => new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
const wristPath = loop(KEYS.map((k) => k.wrist)),
  turnPath = loop(KEYS.map((k) => k.turn)),
  elbowPath = loop(KEYS.map((k) => k.elbow));
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

function sleeve(length: number, top: number, cuff: number) {
  const g = new GeometryBuilder(),
    m = new THREE.Matrix4();
  const shape = new THREE.CylinderGeometry(cuff, top, length, 12);
  g.mesh(shape, m.makeRotationX(-Math.PI / 2).setPosition(0, 0, -length / 2), color('teal'), ALWAYS_COLOR);
  const joint = new THREE.SphereGeometry(top, 10, 6);
  g.mesh(joint, m.identity(), color('teal'), ALWAYS_COLOR);
  shape.dispose();
  joint.dispose();
  return g.build();
}

function hand() {
  const g = new GeometryBuilder(),
    shape = new THREE.SphereGeometry(1, 10, 7),
    m = new THREE.Matrix4();
  const skin = color('sand');
  const oval = (x: number, y: number, z: number, w: number, h: number, l: number, tilt = 0) => {
    m.makeRotationY(tilt)
      .scale(v(w, h, l))
      .setPosition(x, y, z);
    g.mesh(shape, m, skin, ALWAYS_COLOR);
  };
  oval(0, 0, -0.045, 0.047, 0.023, 0.068);
  for (let i = 0; i < 4; i++) {
    const len = [0.043, 0.052, 0.049, 0.037][i]!;
    oval((i - 1.5) * 0.02, -0.005, -0.097 - len * 0.54, 0.011, 0.011, len, (i - 1.5) * -0.06);
  }
  oval(-0.043, -0.007, -0.059, 0.016, 0.015, 0.039, 0.48);
  shape.dispose();
  return g.build();
}

export class SwimArms {
  /** How the stroke moves the head (applied by the player to the camera, scaled by how far in
   * the water it is): `lift` metres up, `surge` metres along the swim, `nod` and `roll` radians. */
  readonly head = { lift: 0, surge: 0, nod: 0, roll: 0 };
  private readonly root = new THREE.Group();
  private readonly limbs;
  private phase = REST;
  private scull = 0;
  private effort = 0;
  private lean = 0;
  private backward = false;
  private readonly wrist = new THREE.Vector3();
  private readonly turn = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly tread = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    const material = makeInkMaterial();
    const upper = sleeve(upperLength, 0.074, 0.055),
      lower = sleeve(lowerLength, 0.057, 0.038),
      palm = hand();
    this.limbs = [-1, 1].map((side) => {
      const arm = new THREE.Mesh(upper, material),
        forearm = new THREE.Mesh(lower, material),
        handMesh = new THREE.Mesh(palm, material);
      handMesh.scale.x = side;
      this.root.add(arm, forearm, handMesh);
      return { side, arm, forearm, hand: handMesh };
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
    const was = this.phase;
    if (this.effort < 0.06) this.phase = REST;
    else {
      const tempo = 0.3 + 0.5 * this.effort + 0.2 * Math.max(0, speed - 2.6);
      // swimming backwards runs the stroke in reverse: the hands push the water ahead
      this.phase = (this.phase + dt * tempo * (this.backward ? -1 : 1) + 1) % 1;
    }
    const kicked =
      this.effort > 0.3 &&
      (this.backward ? was >= KICK && this.phase < KICK : was < KICK && this.phase >= KICK) &&
      Math.abs(this.phase - was) < 0.5;
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
    // the arms stay in the water while the head rises out of it
    this.root.position.y = -(1 - blend) * 0.38 - head.lift * blend * 0.7;
    this.root.rotation.set(-THREE.MathUtils.clamp(pitch, -0.75, 0.75) * 0.45, 0, -this.lean * 0.08);

    const u = strokeParam(this.phase);
    for (const { side, arm, forearm, hand } of this.limbs) {
      // the arm on the outside of a turn sweeps wider
      const reach = 1 + 0.18 * this.lean * side;
      wristPath.getPoint(u, this.wrist);
      this.wrist.x *= reach;
      turnPath.getPoint(u, this.turn);
      elbowPath.getPoint(u, this.pole);
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
      hand.rotation.set(this.turn.x, side * this.turn.y, side * this.turn.z, 'YXZ');
    }
    return kicked;
  }

  /** The hands' world positions (after the camera's matrices are up to date). */
  hands(): THREE.Vector3[] {
    return this.limbs.map(({ hand }) => hand.getWorldPosition(new THREE.Vector3()));
  }

  dispose(): void {
    disposeTree(this.root);
  }
}
