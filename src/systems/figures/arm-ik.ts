// Two-bone arm IK: a hand reaches for a point and the elbow bends to get it there, so a held
// prop stays in the hand however it moves. design: docs/game-design.md section 11.4
import * as THREE from 'three';
import { PALM, UPPER_ARM } from './player-rig';

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
export function reach(
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
