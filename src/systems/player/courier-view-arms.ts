import * as THREE from 'three';
import type { Look } from '@/content/characters';
import { CourierActor } from '@/systems/figures/quaternius-courier';
import { reach } from '@/systems/figures/arm-ik';
import { modelBrush } from '@/systems/tools/viewmodels';
import type { WeaponKey } from '@/content/weapons';

type Grip = { at: readonly [number, number, number]; turn: readonly [number, number, number] };
/** Palm contact points in the actual first-person weapon geometry, clear of receivers/guards. */
const WEAPON_GRIPS: Record<WeaponKey, readonly [Grip, Grip]> = {
  katana: [
    { at: [0.005, 0.012, 0.09], turn: [-1.3, 0, Math.PI] },
    { at: [-0.005, 0.012, 0.22], turn: [-1.3, 0, Math.PI] },
  ],
  rifle: [
    { at: [0.005, -0.105, 0.08], turn: [1.6, 0, 0] },
    { at: [-0.015, -0.095, -0.17], turn: [0, 1.05, Math.PI / 2] },
  ],
  sniper: [
    { at: [0.005, -0.105, 0.09], turn: [1.6, 0, 0] },
    { at: [-0.015, -0.095, -0.17], turn: [0, 1.05, Math.PI / 2] },
  ],
  launcher: [
    { at: [0.005, -0.14, -0.01], turn: [1.9, 0, 0] },
    { at: [-0.015, -0.14, -0.2], turn: [0, 1.05, Math.PI / 2] },
  ],
  staff: [
    { at: [0, -0.285, 0.12], turn: [-2.2, 0, Math.PI] },
    { at: [0, -0.285, 0.32], turn: [-2.2, 0, Math.PI] },
  ],
};

/** Original character vertices and weights, cropped at the shoulders for the camera. */
export class CourierViewArms {
  readonly root = new THREE.Group();
  readonly actor: CourierActor;
  private readonly brush: THREE.Mesh;
  private readonly target = new THREE.Vector3();
  private readonly contact = new THREE.Vector3();
  private readonly foreQ = new THREE.Quaternion();
  private readonly handQ = new THREE.Quaternion();
  private readonly turn = new THREE.Euler();
  private readonly wristTargets = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly handTurns = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly correction = new THREE.Vector3();
  private readonly twist = new THREE.Quaternion();
  private readonly pole = new THREE.Vector3();
  private grip = 0;

  constructor(source: THREE.Object3D, material: THREE.ShaderMaterial) {
    this.actor = new CourierActor(source, material);
    const { model, rig } = this.actor;
    // Retain the skeleton and the author's topology. Only the triangle index is cropped;
    // shared source geometry and the full third-person character remain untouched.
    this.actor.retainTriangles(
      /^(upperarm|lowerarm|hand|index_\d+|middle_\d+|ring_\d+|pinky_\d+|thumb_\d+)_[lr]$/,
      (weight) => weight > 0.65,
    );
    rig.hips.position.set(0, 0, 0);
    rig.torso.position.set(0, 0, 0);
    rig.armL.position.set(-0.34, -0.36, 0);
    rig.armR.position.set(0.34, -0.36, 0);
    this.brush = new THREE.Mesh(modelBrush(), material);
    this.brush.scale.setScalar(0.68);
    this.brush.frustumCulled = false;
    rig.props.brush.node.add(this.brush);
    this.root.name = 'courier-model-arms';
    this.root.add(rig.root, model);
  }

  /** Solve the wrist separately from the long palm so the fingers stay on their grip. */
  private wrist(side: 'L' | 'R', target: THREE.Vector3, orientation: THREE.Quaternion): void {
    const r = this.actor.rig;
    const sign = side === 'R' ? 1 : -1;
    const arm = r[`arm${side}`],
      fore = r[`fore${side}`],
      palm = r[`palm${side}`];
    this.pole
      .set(0, -1, 0)
      .applyQuaternion(orientation)
      .multiplyScalar(-r.armLengths![1])
      .add(target)
      .sub(arm.position);
    reach(arm, fore, sign, this.target.copy(target), r.armLengths, this.pole);
    this.foreQ.copy(arm.quaternion).multiply(fore.quaternion).invert();
    palm.quaternion.copy(this.foreQ).multiply(orientation);
    // Pronation belongs to the forearm; leaving all of it in the wrist visibly corkscrews
    // the hand even though its grip position is correct. Swing/twist decomposition about Y.
    this.twist.set(0, palm.quaternion.y, 0, palm.quaternion.w).normalize();
    fore.quaternion.multiply(this.twist);
    this.foreQ.copy(arm.quaternion).multiply(fore.quaternion).invert();
    palm.quaternion.copy(this.foreQ).multiply(orientation);
    palm.position.copy(r.gripOffset!);
    palm.position.x *= sign;
    palm.position.applyQuaternion(palm.quaternion);
    palm.position.y -= r.armLengths![1];
  }

  /** Both grips follow the same weapon transform, including recoil and the forward cut. */
  holdWeapon(look: Look, weapon: THREE.Object3D, key: WeaponKey): void {
    this.brush.visible = false;
    const r = this.actor.rig;
    const grips = WEAPON_GRIPS[key];
    // Match the character's one-handed sword/staff stance. Long firearms use a support hand.
    const count = key === 'rifle' || key === 'sniper' || key === 'launcher' ? 2 : 1;
    r.armL.position.set(-0.26, -0.36, -0.04);
    r.armR.position.set(0.26, -0.36, -0.04);
    for (let i = 0; i < count; i++) {
      const sign = i === 0 ? 1 : -1;
      const grip = grips[i]!;
      const q = this.handTurns[i]!.setFromEuler(this.turn.set(...grip.turn)).premultiply(weapon.quaternion);
      this.contact.copy(r.gripOffset!);
      this.contact.x *= sign;
      this.contact.applyQuaternion(q);
      this.wristTargets[i]!.set(...grip.at)
        .multiply(weapon.scale)
        .applyQuaternion(weapon.quaternion)
        .sub(this.contact);
    }
    // Move the entire weapon into the intersection of both arms' reach, rather than
    // stretching an arm or leaving a floating hand during the extreme cut/reload poses.
    const reachLength = r.armLengths![0] + r.armLengths![1] - 0.012;
    for (let pass = 0; pass < 12; pass++)
      for (let i = 0; i < count; i++) {
        const arm = i === 0 ? r.armR : r.armL;
        this.correction.copy(weapon.position).add(this.wristTargets[i]!).sub(arm.position);
        const distance = this.correction.length();
        if (distance > reachLength)
          weapon.position.addScaledVector(this.correction, (reachLength - distance) / distance);
      }
    for (let i = 0; i < count; i++) {
      this.wristTargets[i]!.add(weapon.position);
      this.wrist(i === 0 ? 'R' : 'L', this.wristTargets[i]!, this.handTurns[i]!);
    }
    if (count === 1) {
      this.contact.set(-0.3, -0.45, -0.29);
      this.handQ.setFromEuler(this.turn.set(1.4, 0, -0.1));
      this.wrist('L', this.contact, this.handQ);
    }
    this.actor.applyRig(
      look,
      key === 'katana' || key === 'staff' ? 1 : 0.9,
      count === 1 ? 0.2 : key === 'katana' || key === 'staff' ? 1 : 0.65,
    );
  }

  /** Preserve the swimming rhythm but fit it to the original character's arm lengths. */
  swim(look: Look, hands: readonly { side: number; hand: THREE.Object3D; grip: THREE.Vector3 }[]): void {
    this.brush.visible = false;
    const r = this.actor.rig;
    for (const { side, hand } of hands) {
      const arm = side === 1 ? r.armR : r.armL;
      arm.position.set(side * 0.22, -0.24, -0.04);
      this.contact.set(
        side * (0.11 + Math.abs(hand.position.x) * 0.72),
        hand.position.y,
        hand.position.z * 0.7,
      );
      // The imported palm runs down -Y with its palm normal inward. Convert to fingers
      // forward, palm down, then follow the catch/pull/recovery orientation.
      this.handQ
        .setFromEuler(this.turn.set(0, (side * Math.PI) / 2, (side * Math.PI) / 2))
        .premultiply(hand.quaternion);
      this.wrist(side === 1 ? 'R' : 'L', this.contact, this.handQ);
    }
    this.actor.applyRig(
      look,
      hands.find((h) => h.side === 1)!.grip.x * 0.65,
      hands.find((h) => h.side === -1)!.grip.x * 0.65,
    );
  }

  update(
    dt: number,
    look: Look,
    left: THREE.Object3D,
    right: THREE.Object3D,
    brush: boolean,
    open: boolean,
  ): void {
    this.grip = THREE.MathUtils.damp(this.grip, brush && !open ? 1 : 0, 18, dt);
    const r = this.actor.rig;
    const [upper, lower] = r.armLengths!;
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'R' ? 1 : -1;
      const anchor = side === 'R' ? right : left;
      const arm = r[`arm${side}`],
        fore = r[`fore${side}`],
        palm = r[`palm${side}`];
      // Grip targets use the existing gait and painting motion; the elbow and wrist now
      // articulate on the real model instead of rotating a single merged hand shape.
      const desired = anchor.position;
      this.foreQ.copy(arm.quaternion).multiply(fore.quaternion);
      for (let i = 0; i < 4; i++) {
        this.contact.set(r.gripOffset!.x * sign, 0, 0).applyQuaternion(this.foreQ);
        this.target.set(desired.x * 0.88, desired.y - 0.07, desired.z).sub(this.contact);
        reach(arm, fore, sign, this.target, [upper, lower - r.gripOffset!.y]);
        this.foreQ.copy(arm.quaternion).multiply(fore.quaternion);
      }
      palm.quaternion.identity();
      palm.position.set(r.gripOffset!.x * sign, -lower + r.gripOffset!.y, 0);
      if (side === 'R') {
        const prop = r.props.brush.node;
        prop.position.set(0, -upper, 0).applyQuaternion(arm.quaternion).add(arm.position);
        prop.position.add(this.contact.copy(palm.position).applyQuaternion(this.foreQ));
        prop.quaternion.copy(this.foreQ);
      }
    }
    this.brush.visible = brush && !open;
    this.actor.applyRig(look, open ? 0.04 : THREE.MathUtils.lerp(0.2, 1, this.grip), open ? 0.04 : 0.2);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.brush.geometry.dispose();
    this.actor.dispose();
  }
}
