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
import { WEAPONS } from '@/content/weapons';
import { FigureRenderer } from './figure';
import { heldIn } from './player-hold';
import { type PlayerPose, posePlayer } from './player-pose';
import { type Rig, characterRig } from './player-rig';

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

/** Every player figure in a scene, drawn as two instanced meshes. */
export class PlayerFigures {
  private readonly rigs = new Map<CharacterKey, Rig>();
  private readonly fixed = new Map<CharacterKey, Map<string, number>>();
  private readonly figures: FigureRenderer;
  private readonly at = new THREE.Vector3();

  constructor(parent: THREE.Object3D, material: THREE.Material) {
    this.figures = new FigureRenderer(parent, material);
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
  }

  draw(look: Look, p: PlayerPose): void {
    const r = this.rig(look.character);
    posePlayer(r, p);
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
  }

  dispose(): void {
    this.figures.dispose();
  }
}
