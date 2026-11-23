// Resting hands reach the ground in body space, so short and long armed characters
// can lean back on their palms without inheriting a tool-holding wrist.
import * as THREE from 'three';
import { reach } from './arm-ik';
import { PALM, UPPER_ARM, type Rig } from './player-rig';

const shoulder = new THREE.Vector3();
const target = new THREE.Vector3();
const contact = new THREE.Vector3();
const pole = new THREE.Vector3();
const torsoQ = new THREE.Quaternion();
const rootQ = new THREE.Quaternion();
const handQ = new THREE.Quaternion();
const foreQ = new THREE.Quaternion();
const oldArm = new THREE.Quaternion();
const oldFore = new THREE.Quaternion();
const identity = new THREE.Quaternion();
const rotation = new THREE.Euler();

export function restHands(r: Rig, sitting: number, lying: number): void {
  const weight = sitting + lying;
  if (weight < 0.0001) return;
  const flat = lying / weight;
  const lengths = r.armLengths ?? ([UPPER_ARM, PALM] as const);
  const spread = Math.min(1, (lengths[0] + lengths[1]) / 0.42);
  r.root.updateMatrixWorld(true);
  r.root.getWorldQuaternion(rootQ);
  r.torso.getWorldQuaternion(torsoQ).invert().multiply(rootQ);
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? -1 : 1;
    const arm = r[`arm${side}`],
      fore = r[`fore${side}`],
      palm = r[`palm${side}`];
    oldArm.copy(arm.quaternion);
    oldFore.copy(fore.quaternion);
    r.root.worldToLocal(arm.getWorldPosition(shoulder));
    // Palms behind the seated shoulders; arms loosely open beside the supine body.
    target.set(
      shoulder.x + sign * (0.09 * (1 - flat) + flat * 0.22 * spread),
      0.045,
      shoulder.z + 0.14 * (1 - flat) - (side === 'L' ? 0.36 : 0.31) * flat * spread,
    );
    r.torso.worldToLocal(r.root.localToWorld(target));
    handQ
      .setFromEuler(rotation.set(-Math.PI / 2 + Math.PI * flat, 0, sign * (0.12 + flat * 0.12)))
      .premultiply(torsoQ);
    if (r.gripOffset) {
      contact.copy(r.gripOffset);
      contact.x *= sign;
      contact.applyQuaternion(handQ);
      target.sub(contact);
    }
    pole.set(sign * 0.8, 0.25, 0.25).applyQuaternion(torsoQ);
    reach(arm, fore, sign, target, lengths, pole);
    arm.quaternion.slerp(oldArm, 1 - weight);
    fore.quaternion.slerp(oldFore, 1 - weight);
    if (r.gripOffset) {
      foreQ.copy(arm.quaternion).multiply(fore.quaternion).invert();
      palm.quaternion.copy(foreQ).multiply(handQ);
      palm.quaternion.slerp(identity, 1 - weight);
      palm.position.copy(r.gripOffset);
      palm.position.x *= sign;
      palm.position.applyQuaternion(palm.quaternion);
      palm.position.y -= r.armLengths![1];
    }
  }
}
