// The character on the character select screen: the chosen look standing in the real world a
// few metres in front of the camera, right of the menu card, in the same light and brush pass
// as the game. It turns slowly to show its silhouette and hops when the look changes. Runs on
// its own animation frame while shown, since the menu is up and nothing else drives it.
import * as THREE from 'three';
import type { Look } from '@/content/characters';
import { makeInkMaterial } from '@/engine/render/ink-material';
import type { GameContext } from '@/game/types';
import { PlayerFigures } from './player-figure';

const DISTANCE = 3.4;
/** How far right of the view's centre it stands, so the menu card on the left leaves it clear. */
const SIDE = 1.15;
const HOP = 0.4;

export class CharacterPreview {
  private readonly group = new THREE.Group();
  private readonly material = makeInkMaterial({ cloth: true });
  private readonly figures = new PlayerFigures(this.group, this.material);
  private look: Look | null = null;
  private readonly at = new THREE.Vector3();
  private facing = 0;
  private t = 0;
  private hopT = 0;
  private frame = 0;

  constructor(private readonly ctx: GameContext) {}

  /** Show `look`, or hide the preview with null. */
  show(look: Look | null): void {
    if (!look) {
      this.hide();
      return;
    }
    if (!this.look) this.place();
    else if (look.character !== this.look.character || look.accent !== this.look.accent) this.hopT = HOP;
    this.look = look;
    if (!this.frame) {
      let last = performance.now();
      const tick = (now: number): void => {
        this.update(Math.min(0.1, (now - last) / 1000));
        last = now;
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    }
  }

  private place(): void {
    const cam = this.ctx.renderer.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.at.copy(cam.position).addScaledVector(fwd, DISTANCE).addScaledVector(right, SIDE);
    this.at.y = this.groundAt(this.at.x, this.at.z);
    // face the camera
    this.facing = Math.atan2(-(cam.position.x - this.at.x), -(cam.position.z - this.at.z));
  }

  /** Whatever it would stand on: the ground, a street, a step; looked for from above. */
  private groundAt(x: number, z: number): number {
    const top = this.ctx.renderer.camera.position.y + 4;
    const hit = this.ctx.scenes.active.physics.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, 30);
    return hit ? hit.point.y : this.ctx.player.position.y;
  }

  private update(dt: number): void {
    if (!this.look) return;
    const root = this.ctx.scenes.active.root;
    if (this.group.parent !== root) root.add(this.group);
    this.t += dt;
    this.hopT = Math.max(0, this.hopT - dt);
    const hop = this.hopT > 0 ? Math.sin((1 - this.hopT / HOP) * Math.PI) : 0;
    this.figures.begin();
    this.figures.draw(this.look, {
      x: this.at.x,
      y: this.at.y + hop * 0.35,
      z: this.at.z,
      // turn slowly to each side and back, so the hat and hair read from more than the front
      yaw: this.facing + Math.sin(this.t * 0.6) * 0.7,
      pitch: Math.sin(this.t * 0.9) * 0.15,
      walk: 0,
      stride: 0,
      air: hop > 0,
      glide: false,
      hurt: 0,
      dying: -1,
      t: this.t,
    });
    this.figures.end();
  }

  private hide(): void {
    this.look = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.group.removeFromParent();
  }

  dispose(): void {
    this.hide();
    this.figures.dispose();
    this.material.dispose();
  }
}
