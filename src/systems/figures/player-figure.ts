// Player characters as soft figures: a shared body (about 1.8 m, head centred at 1.62 m to match
// the shared hit box) dressed per character. Faces are two dark eyes and a blush, read only up
// close; from afar a character is its hat and hair. Scarves, capes, ponytails and hood tips
// trail behind as the figure moves. Colours come from content/characters.ts and the player's
// own picks. design: docs/game-design.md section 8.3
//
// What a player holds (the brush or a weapon) is a small soft prop on the torso; the hands reach
// for it (two-bone arm IK), so one way of moving a prop serves every character. Attacks and
// skills move the prop along a few keyed poses (the katana's arc, a gun's kick, a staff's cast)
// while the legs keep walking. design: docs/game-design.md section 11.4
//
// The pieces: player-rig.ts builds the bodies and outfits, player-props.ts what is held,
// arm-ik.ts the hands' reach, player-hold.ts the stances and actions, player-pose.ts the whole
// pose for a frame. This file draws them.
import * as THREE from 'three';
import {
  type CharacterKey,
  FACE_COLORS,
  HAIR_COLORS,
  type Look,
  SKIN_TONES,
  characterDef,
} from '@/content/characters';
import { type ColorKey, color } from '@/content/palette';
import { WEAPONS, type WeaponKey } from '@/content/weapons';
import { FigureRenderer } from './figure';
import { weaponModel } from './player-props';
import { heldIn } from './player-hold';
import { type PlayerPose, posePlayer } from './player-pose';
import { type Rig, characterRig } from './player-rig';
import { CourierFigures } from './quaternius-courier';

export { ACTION_SECONDS } from './player-hold';
export type { PlayerPose } from './player-pose';
export { posePlayer } from './player-pose';
export type { Prop } from './player-props';
export { characterRig } from './player-rig';

const INK = color('ink');
const FACE = { eye: color(FACE_COLORS.eye), blush: color(FACE_COLORS.blush) };
const SKIN = SKIN_TONES.map((k) => color(k));
const HAIR = HAIR_COLORS.map((k) => color(k));
/** A weapon prop wears the weapon's own colours, as in the hand of the one holding it. */
const WEAPON_LOOK = new Map<string, readonly [number, number]>(WEAPONS.map((w) => [w.key, w.look]));
const PROP_PAINT: Readonly<Record<string, number>> = { wood: color('brown'), metal: color('charcoal') };

const IS_WEAPON = new Set<string>(WEAPONS.map((w) => w.key));

/** Every player figure in a scene: two instanced meshes for the bodies, one per weapon carried. */
export class PlayerFigures {
  private readonly rigs = new Map<CharacterKey, Rig>();
  private readonly fixed = new Map<CharacterKey, Map<string, number>>();
  private readonly figures: FigureRenderer;
  private readonly couriers: CourierFigures;
  private readonly at = new THREE.Vector3();
  /** The weapons in hand, each its model instanced (colours are in the model). */
  private readonly weapons = new Map<WeaponKey, { mesh: THREE.InstancedMesh; used: number }>();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly material: THREE.Material,
  ) {
    this.figures = new FigureRenderer(parent, material);
    this.couriers = new CourierFigures(parent, material);
  }

  /** One more of this weapon this frame, at a prop's joint. */
  private carry(key: WeaponKey, at: THREE.Matrix4): void {
    let w = this.weapons.get(key);
    if (!w || w.used >= w.mesh.instanceMatrix.count) {
      const mesh = new THREE.InstancedMesh(
        weaponModel(key).geometry,
        this.material,
        (w?.mesh.instanceMatrix.count ?? 4) * 2,
      );
      mesh.frustumCulled = false;
      if (w) {
        mesh.instanceMatrix.array.set(w.mesh.instanceMatrix.array.subarray(0, w.used * 16));
        w.mesh.removeFromParent();
        w.mesh.dispose();
      }
      this.parent.add(mesh);
      w = { mesh, used: w?.used ?? 0 };
      this.weapons.set(key, w);
    }
    w.mesh.setMatrixAt(w.used++, at);
  }

  private rig(key: CharacterKey): Rig {
    let r = this.rigs.get(key);
    if (!r) {
      r = characterRig(key);
      this.rigs.set(key, r);
      const colors = characterDef(key).colors as Record<string, ColorKey>;
      this.fixed.set(key, new Map(Object.entries(colors).map(([slot, c]) => [slot, color(c)])));
    }
    return r;
  }

  begin(): void {
    this.figures.begin();
    this.couriers.begin();
    for (const w of this.weapons.values()) w.used = 0;
  }

  draw(look: Look, p: PlayerPose): void {
    const imported = this.couriers.draw(look, p);
    const r = imported ?? this.rig(look.character);
    if (!imported) posePlayer(r, p);
    r.root.updateMatrixWorld(true);
    const fixed = this.fixed.get(look.character)!;
    const skin = SKIN[look.skin] ?? SKIN[0]!;
    const hair = HAIR[look.hair] ?? HAIR[0]!;
    // being swallowed: ink climbs from the feet to the head
    const inkTo = p.dying >= 0 ? p.y + Math.min(1, p.dying / 0.6) * 1.9 : -Infinity;
    this.figures.add(r.parts, (part) => {
      if (inkTo > -Infinity && this.at.setFromMatrixPosition(part.node.matrixWorld).y < inkTo) return INK;
      switch (part.paint) {
        case 'skin':
          return skin;
        case 'hair':
          return hair;
        case 'accent':
          return look.accent;
        case 'eye':
          return FACE.eye;
        case 'blush':
          return FACE.blush;
        default:
          return fixed.get(part.paint) ?? INK;
      }
    });
    const item = heldIn(p);
    if (!item) return;
    if (IS_WEAPON.has(item)) {
      // dropped as the ink takes them
      if (p.dying < 0.3) this.carry(item as WeaponKey, r.props[item].node.matrixWorld);
      return;
    }
    const own = WEAPON_LOOK.get(item);
    this.figures.add(r.props[item].parts, (part) => {
      if (inkTo > -Infinity && this.at.setFromMatrixPosition(part.node.matrixWorld).y < inkTo) return INK;
      switch (part.paint) {
        case 'main':
          return own?.[0] ?? INK;
        case 'trim':
          return own?.[1] ?? INK;
        case 'bristle':
          return look.accent;
        default:
          return PROP_PAINT[part.paint] ?? INK;
      }
    });
  }

  end(): void {
    this.figures.end();
    this.couriers.end();
    for (const w of this.weapons.values()) {
      w.mesh.count = w.used;
      w.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.figures.dispose();
    this.couriers.dispose();
    // the models are shared (player-props.ts); only the meshes are this renderer's
    for (const w of this.weapons.values()) {
      w.mesh.removeFromParent();
      w.mesh.dispose();
    }
  }
}
