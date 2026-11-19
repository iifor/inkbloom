// What a player can hold, the brush or a weapon: a few soft parts on a joint of the torso, posed
// by player-hold.ts and gripped by the hands (arm-ik.ts). design: docs/game-design.md section 11.4
import * as THREE from 'three';
import { WEAPONS, type WeaponKey } from '@/content/weapons';
import { heldModel } from '@/systems/tools/viewmodels';
import type { HeldItem } from '@/world/net/protocol';
import { type Part, RigBuilder } from './figure';

/** Something held: a few soft parts on a joint whose origin is where the main hand grips it.
 * It points along -z (barrel, blade, bristles, the staff's orb). */
export interface Prop {
  /** Forearm pronation for a cut, independent of wrist flexion. */
  gripRoll?: number;
  readonly node: THREE.Object3D;
  readonly parts: Part[];
  /** Where the other hand holds it, in its own space; null when held in one hand. */
  readonly off: THREE.Vector3 | null;
  /** The far end (muzzle, blade tip, bristles, orb), in its own space. */
  readonly tip: THREE.Vector3;
}

/** How far each weapon's far end lies from the main hand, as the holds (player-hold.ts) were
 * laid out for: the models are scaled to it. */
const REACH: Readonly<Record<WeaponKey, number>> = {
  rifle: 0.58,
  sniper: 0.77,
  launcher: 0.56,
  katana: 0.8,
  staff: 0.78,
};

const models = new Map<WeaponKey, ReturnType<typeof heldModel>>();

/** A weapon as carried: its model (grip at the origin, pointing along -z), the other hand's
 * place and its far end. Built once and shared by every figure. */
export function weaponModel(key: WeaponKey): ReturnType<typeof heldModel> {
  let m = models.get(key);
  if (!m)
    models.set(
      key,
      (m = heldModel(
        WEAPONS.find((w) => w.key === key)!,
        REACH[key],
      )),
    );
  return m;
}

/** A weapon's joint: no soft parts (the model is drawn there), the hands from the model. */
function weapon(torso: THREE.Object3D, key: WeaponKey): Prop {
  const node = new THREE.Object3D();
  torso.add(node);
  const m = weaponModel(key);
  return { node, parts: [], off: m.off?.clone() ?? null, tip: m.tip.clone() };
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
    // the weapons are the first-person models themselves (systems/tools/viewmodels.ts, without
    // the hands), drawn by player-figure.ts at the prop's joint; here only where the hands go
    rifle: weapon(torso, 'rifle'),
    sniper: weapon(torso, 'sniper'),
    launcher: weapon(torso, 'launcher'),
    katana: weapon(torso, 'katana'),
    staff: weapon(torso, 'staff'),
  };
}
