import * as THREE from 'three';
import { color } from '@/content/palette';
import { ALWAYS_COLOR, GeometryBuilder } from '@/engine/render/geometry-builder';
import { makeInkMaterial } from '@/engine/render/ink-material';
import { disposeTree } from '@/engine/resources';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const upperLength = 0.305,
  lowerLength = 0.27;
const downArm = v(0, 0, -1);
// One breaststroke seen from the chest: glide, sweep out, catch, pull in, then reach forward.
const stroke = new THREE.CatmullRomCurve3(
  [
    v(0.105, -0.18, -0.52),
    v(0.115, -0.18, -0.53),
    v(0.22, -0.21, -0.48),
    v(0.38, -0.26, -0.36),
    v(0.4, -0.32, -0.23),
    v(0.29, -0.35, -0.17),
    v(0.12, -0.3, -0.22),
    v(0.078, -0.22, -0.39),
  ],
  true,
  'catmullrom',
  0.42,
);

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
  private readonly root = new THREE.Group();
  private readonly limbs;
  private phase = 0;
  private effort = 0;
  private readonly wrist = new THREE.Vector3();
  private readonly shoulder = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly outward = new THREE.Vector3();

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

  update(dt: number, blend: number, speed: number, pitch = 0): void {
    this.root.visible = blend > 0.025;
    if (!this.root.visible) {
      this.effort = 0;
      return;
    }
    this.effort = THREE.MathUtils.damp(this.effort, Math.min(1, speed / 2.6), 5, dt);
    this.phase = (this.phase + dt * (0.32 + 0.38 * this.effort + 0.12 * Math.max(0, speed - 2.6))) % 1;
    const beat = this.phase * Math.PI * 2;
    this.root.position.y = -(1 - blend) * 0.38 + 0.008 * Math.sin(beat - 0.8) * this.effort;
    this.root.rotation.x = -THREE.MathUtils.clamp(pitch, -0.75, 0.75) * 0.45;
    for (const { side, arm, forearm, hand } of this.limbs) {
      const p = (this.phase + (side === 1 ? 0.012 : 0)) % 1;
      stroke.getPoint(p, this.wrist);
      // At rest the hands scull in small ovals instead of repeating a full power stroke.
      this.wrist.lerp(
        this.outward.set(
          0.255 + 0.07 * Math.cos(beat),
          -0.29 + 0.025 * Math.sin(beat),
          -0.32 + 0.04 * Math.sin(beat),
        ),
        1 - this.effort,
      );
      this.wrist.x *= side;
      this.shoulder.set(side * 0.19, -0.225, 0.035);
      this.axis.subVectors(this.wrist, this.shoulder);
      const d = Math.min(this.axis.length(), upperLength + lowerLength - 0.001);
      this.axis.normalize();
      this.wrist.copy(this.shoulder).addScaledVector(this.axis, d);
      const along = (upperLength ** 2 - lowerLength ** 2 + d * d) / (2 * d);
      this.outward.set(side, -0.66, 0.22);
      this.outward.addScaledVector(this.axis, -this.outward.dot(this.axis)).normalize();
      this.elbow
        .copy(this.shoulder)
        .addScaledVector(this.axis, along)
        .addScaledVector(this.outward, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
      arm.position.copy(this.shoulder);
      arm.quaternion.setFromUnitVectors(downArm, this.axis.subVectors(this.elbow, this.shoulder).normalize());
      forearm.position.copy(this.elbow);
      forearm.quaternion.setFromUnitVectors(
        downArm,
        this.axis.subVectors(this.wrist, this.elbow).normalize(),
      );
      hand.position.copy(this.wrist);
      const catchWater = (1 - Math.cos(beat)) * 0.5;
      hand.rotation.set(
        -0.12 - 0.48 * catchWater,
        side * (0.02 + 0.47 * Math.sin(beat - 0.3)),
        side * (0.14 + 0.9 * catchWater),
        'YXZ',
      );
    }
  }

  dispose(): void {
    disposeTree(this.root);
  }
}
