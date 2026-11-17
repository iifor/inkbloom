// What a player can hold, the brush or a weapon: a few soft parts on a joint of the torso, posed
// by player-hold.ts and gripped by the hands (arm-ik.ts). design: docs/game-design.md section 11.4
import * as THREE from 'three';
import type { HeldItem } from '@/world/net/protocol';
import { type Part, RigBuilder } from './figure';

/** Something held: a few soft parts on a joint whose origin is where the main hand grips it.
 * It points along -z (barrel, blade, bristles, the staff's orb). */
export interface Prop {
  readonly node: THREE.Object3D;
  readonly parts: Part[];
  /** Where the other hand holds it, in its own space; null when held in one hand. */
  readonly off: THREE.Vector3 | null;
  /** The far end (muzzle, blade tip, bristles, orb), in its own space. */
  readonly tip: THREE.Vector3;
}

/** A limb lying along -z from z (at height y): a barrel, a blade, a shaft. */
function bar(
  b: RigBuilder,
  parent: THREE.Object3D,
  z: number,
  y: number,
  len: number,
  r: number,
  paint: string,
  ry = r,
): void {
  const l = b.limb(parent, 0, y, z, len, r, paint, ry);
  l.joint.rotation.x = Math.PI / 2;
}

/** The things a player can hold, each on its own joint on the torso. Paint slots: `main` and
 * `trim` are the weapon's own colours (content/weapons.ts `look`), `bristle` the player's
 * accent; `wood` and `metal` are fixed. */
export function buildProps(torso: THREE.Object3D): Record<HeldItem, Prop> {
  const prop = (
    off: [number, number, number] | null,
    tip: [number, number, number],
    make: (b: RigBuilder, n: THREE.Object3D) => void,
  ): Prop => {
    const b = new RigBuilder();
    const node = b.joint(torso, 0, 0, 0);
    make(b, node);
    return {
      node,
      parts: b.parts,
      off: off ? new THREE.Vector3(...off) : null,
      tip: new THREE.Vector3(...tip),
    };
  };
  return {
    // a painter's brush, bigger than life so it reads from across a street
    brush: prop(null, [0, 0, -0.5], (b, n) => {
      bar(b, n, 0.1, 0, 0.42, 0.016, 'wood');
      b.blob(n, 0, 0, -0.33, 0.024, 0.024, 0.03, 'metal');
      b.blob(n, 0, 0, -0.42, 0.036, 0.034, 0.085, 'bristle');
    }),
    rifle: prop([0, 0, -0.26], [0, 0.06, -0.58], (b, n) => {
      b.blob(n, 0, 0.05, -0.1, 0.04, 0.05, 0.17, 'main');
      bar(b, n, -0.25, 0.06, 0.33, 0.018, 'main');
      b.blob(n, 0, 0.03, -0.27, 0.032, 0.035, 0.08, 'trim');
      b.blob(n, 0, -0.03, -0.13, 0.025, 0.06, 0.035, 'trim');
      b.blob(n, 0, -0.02, 0.01, 0.025, 0.055, 0.03, 'trim');
      b.blob(n, 0, 0.02, 0.14, 0.035, 0.06, 0.12, 'trim');
    }),
    sniper: prop([0, 0, -0.24], [0, 0.06, -0.77], (b, n) => {
      b.blob(n, 0, 0.05, -0.08, 0.038, 0.05, 0.16, 'main');
      bar(b, n, -0.22, 0.06, 0.55, 0.015, 'main');
      b.blob(n, 0, 0.035, -0.26, 0.03, 0.032, 0.09, 'main');
      b.blob(n, 0, 0.13, -0.1, 0.026, 0.026, 0.11, 'trim');
      b.blob(n, 0, -0.02, 0.01, 0.025, 0.055, 0.03, 'trim');
      b.blob(n, 0, 0.02, 0.15, 0.035, 0.065, 0.13, 'trim');
    }),
    // carried on the shoulder: the tube sits above the grip
    launcher: prop([0, 0.02, -0.22], [0, 0.14, -0.54], (b, n) => {
      b.blob(n, 0, 0.14, -0.1, 0.085, 0.085, 0.42, 'main');
      b.blob(n, 0, 0.14, -0.5, 0.095, 0.095, 0.045, 'trim');
      b.blob(n, 0, 0.14, 0.3, 0.09, 0.09, 0.05, 'trim');
      b.blob(n, 0, 0.02, 0, 0.025, 0.06, 0.03, 'trim');
      b.blob(n, 0, 0.04, -0.22, 0.025, 0.05, 0.03, 'trim');
    }),
    // one hand: a wrapped grip, a round guard, a long flat blade
    katana: prop(null, [0, 0, -0.8], (b, n) => {
      bar(b, n, 0.11, 0, 0.17, 0.021, 'trim');
      b.blob(n, 0, 0, -0.07, 0.05, 0.05, 0.014, 'trim');
      bar(b, n, -0.08, 0, 0.72, 0.014, 'main', 0.034);
    }),
    staff: prop([0, 0, -0.18], [0, 0, -0.78], (b, n) => {
      bar(b, n, 0.55, 0, 1.25, 0.022, 'wood');
      b.blob(n, 0, 0, -0.78, 0.085, 0.085, 0.085, 'main');
      for (const sx of [-1, 1]) b.blob(n, sx * 0.06, 0, -0.71, 0.02, 0.02, 0.05, 'trim');
    }),
  };
}
