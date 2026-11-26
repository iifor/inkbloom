import * as THREE from 'three';
import { reach } from './arm-ik';
import type { Rig } from './player-rig';

const target = new THREE.Vector3();
const oldArm = new THREE.Quaternion();
const oldFore = new THREE.Quaternion();
const hand = new THREE.Quaternion();
const torso = new THREE.Quaternion();
const root = new THREE.Quaternion();
const contact = new THREE.Vector3();
const identity = new THREE.Quaternion();
const barGrips = [-1, 1].map((sign) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (sign * Math.PI) / 2)),
);

/** Grip the shared control bar, compensating for each imported outfit's wrist offset. */
export function flightHands(r: Rig, blend: number): void {
  r.root.updateMatrixWorld(true);
  r.root.getWorldQuaternion(root);
  r.torso.getWorldQuaternion(torso).invert().multiply(root);
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? -1 : 1;
    hand.copy(torso).multiply(barGrips[side === 'L' ? 0 : 1]!);
    const arm = r[`arm${side}`],
      fore = r[`fore${side}`],
      palm = r[`palm${side}`];
    oldArm.copy(arm.quaternion);
    oldFore.copy(fore.quaternion);
    target.set(sign * 0.36, 1.25, -0.78);
    r.torso.worldToLocal(r.root.localToWorld(target));
    if (r.gripOffset) {
      contact.copy(r.gripOffset);
      contact.x *= sign;
      target.sub(contact.applyQuaternion(hand));
    }
    reach(arm, fore, sign, target, r.armLengths);
    arm.quaternion.slerp(oldArm, 1 - blend);
    fore.quaternion.slerp(oldFore, 1 - blend);
    if (r.gripOffset) {
      palm.quaternion.copy(arm.quaternion).multiply(fore.quaternion).invert().multiply(hand);
      palm.quaternion.slerp(identity, 1 - blend);
      palm.position.copy(r.gripOffset);
      palm.position.x *= sign;
      palm.position.applyQuaternion(palm.quaternion);
      palm.position.y -= r.armLengths![1];
    }
  }
}
